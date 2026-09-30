package ru.musixai.app.core.data

import android.util.LruCache
import app.musix.api.models.RelationOut
import ru.musixai.app.core.model.Fact
import ru.musixai.app.core.model.LyricLine
import ru.musixai.app.core.model.PlayerContext
import ru.musixai.app.core.model.Relation
import ru.musixai.app.core.network.MusixApi
import ru.musixai.app.core.network.getBytes
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/** The player's BFF call, memoized per track (a queue revisits its tracks). */
@Singleton
class PlayerRepository @Inject constructor(private val api: MusixApi) {
    private val cache = LruCache<String, PlayerContext>(40)

    fun cached(trackId: String): PlayerContext? = cache.get(trackId)

    suspend fun context(trackId: String): PlayerContext {
        cache.get(trackId)?.let { return it }
        val out = api.call { screens.playerContextApiV2PlayerContextTrackIdGet(UUID.fromString(trackId)) }
        val k = out.knowledge
        val codec = out.audio.codec?.lowercase()
        val ctx = PlayerContext(
            track = out.track.model(),
            image = out.track.coverImageId?.let { out.images[it]?.model() },
            lyrics = out.lyrics?.text?.takeIf { it.isNotBlank() },
            synced = parseLrc(out.lyrics?.syncedLrc),
            songFacts = k?.songFacts.orEmpty().map { Fact(it.text, it.labels, it.confirmed) },
            artistFacts = k?.artistFacts.orEmpty().map { Fact(it.text, it.labels, it.confirmed) },
            producers = k?.producers.orEmpty().map { it.model() },
            samples = k?.samples.orEmpty().map { it.model() },
            sampledBy = k?.sampledBy.orEmpty().map { it.model() },
            vibe = k?.vibe,
            codec = codec,
            lossless = codec in LOSSLESS,
            plays = out.stats.plays,
        )
        cache.put(trackId, ctx)
        return ctx
    }

    private val envelopes = LruCache<String, ByteArray>(20)

    /** The energy envelope (uint8 frames × 4 bands, 10 fps), or null while the server has
     *  none yet (it computes it on the first ask). */
    suspend fun envelope(trackId: String): ByteArray? {
        envelopes.get(trackId)?.let { return it }
        val packed = runCatching { api.getBytes("/api/v2/tracks/$trackId/envelope") }.getOrNull() ?: return null
        val raw = java.util.zip.InflaterInputStream(packed.inputStream()).readBytes()
        envelopes.put(trackId, raw)
        return raw
    }

    private fun RelationOut.model() = Relation(text, kind, trackId?.toString(), artistId?.toString())

    companion object {
        private val LOSSLESS = setOf("flac", "alac", "wav", "aiff", "ape", "wavpack")
        private val TAG = Regex("""\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?]""")

        /** `[mm:ss.xx] line` → timed lines (a line may carry several stamps). */
        fun parseLrc(lrc: String?): List<LyricLine> {
            if (lrc.isNullOrBlank()) return emptyList()
            val out = mutableListOf<LyricLine>()
            for (raw in lrc.lines()) {
                val stamps = TAG.findAll(raw).toList()
                if (stamps.isEmpty()) continue
                val text = raw.substring(stamps.last().range.last + 1).trim()
                for (m in stamps) {
                    val (mm, ss, frac) = m.destructured
                    val ms = frac.padEnd(3, '0').take(3).ifEmpty { "0" }.toLong()
                    out += LyricLine(mm.toLong() * 60_000 + ss.toLong() * 1000 + ms, text)
                }
            }
            return out.sortedBy { it.atMs }
        }
    }
}
