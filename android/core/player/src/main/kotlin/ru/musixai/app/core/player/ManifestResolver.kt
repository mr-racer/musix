package ru.musixai.app.core.player

import java.util.concurrent.ConcurrentHashMap

enum class Network(val wire: String) { WIFI("wifi"), CELLULAR("cellular") }

/** One playable source of a track: the tier the server chose and its fallbacks. */
data class ManifestEntry(
    val trackId: String,
    val sources: List<Pair<String, String>>,  // (tier, signed url), best first
    val gainDb: Double?,
    val expiresAtSec: Long,
)

data class Resolved(val url: String, val tier: String, val cacheKey: String)

/**
 * Signed URLs from `POST /playback/manifest` (spec §3), fetched for the current track and
 * the next five in one call and cached per (track, network).
 *
 * A track is pinned to the network of its first resolve, so a network change applies from
 * the next track, never mid-song. ExoPlayer reopens the source inside one track (a read
 * error resumes the same load at its byte offset with the same extractor, and the cache
 * hands off to the network), and an unpinned resolve could then return another tier's file
 * at that offset. That was the «the song plays but there is no sound» bug (2026-10-01): a
 * Wi-Fi hiccup or a VPN reconnect reads as metered for a moment, and lossless turned into
 * high AAC mid-file.
 *
 * - an expired entry (60 s margin) or a 403/410 on its URL → fetched again;
 * - a 404 on a source → the next fallback (`lossless` → `high` → …);
 * - the cache key is track + tier: the tiers are different bytes.
 */
class ManifestResolver(
    private val fetch: (trackIds: List<String>, network: Network) -> List<ManifestEntry>,
    private val network: () -> Network,
    private val lookahead: (trackId: String) -> List<String>,
    private val now: () -> Long = { System.currentTimeMillis() / 1000 },
) {
    private val cache = ConcurrentHashMap<Pair<String, Network>, ManifestEntry>()
    private val fallback = ConcurrentHashMap<String, Int>()
    private val pins = ConcurrentHashMap<String, Network>()

    fun entry(trackId: String): ManifestEntry? = cache[trackId to (pins[trackId] ?: network())]

    @Synchronized
    fun resolve(trackId: String): Resolved {
        val net = pins.getOrPut(trackId) { network() }
        val e = cache[trackId to net]?.takeIf { it.expiresAtSec - 60 > now() } ?: run {
            val ids = (listOf(trackId) + lookahead(trackId)).distinct().take(6)
            fetch(ids, net).forEach { cache[it.trackId to net] = it }
            cache[trackId to net] ?: throw IllegalStateException("no manifest for $trackId")
        }
        val i = (fallback[trackId] ?: 0).coerceAtMost(e.sources.lastIndex)
        val (tier, url) = e.sources[i]
        return Resolved(url, tier, "$trackId:$tier")
    }

    /** Tracks that left the play window lose their pin; a later replay follows the network of then. */
    fun unpinExcept(keep: Set<String>) {
        pins.keys.retainAll(keep)
    }

    /** The signature expired or was refused: the next resolve fetches fresh URLs (same tier: the pin stays). */
    fun invalidate(trackId: String) {
        cache.keys.filter { it.first == trackId }.forEach { cache.remove(it) }
    }

    /** This source is missing on the server: move to the next one. False when none is left. */
    fun fallBack(trackId: String): Boolean {
        val e = entry(trackId) ?: return false
        val i = (fallback[trackId] ?: 0) + 1
        if (i > e.sources.lastIndex) return false
        fallback[trackId] = i
        return true
    }

    /** Warms the cache for tracks about to play (the prefetch calls it off the main thread). */
    fun prefetch(trackIds: List<String>) {
        val net = network()
        val missing = trackIds.filter { cache[it to net]?.let { e -> e.expiresAtSec - 60 > now() } != true }
        if (missing.isNotEmpty()) fetch(missing.take(6), net).forEach { cache[it.trackId to net] = it }
    }

    companion object {
        const val SCHEME = "musix"

        fun uri(trackId: String) = "$SCHEME://track/$trackId"

        fun trackIdOf(uri: String?): String? = uri?.takeIf { it.startsWith("$SCHEME://track/") }?.substringAfterLast('/')
    }
}
