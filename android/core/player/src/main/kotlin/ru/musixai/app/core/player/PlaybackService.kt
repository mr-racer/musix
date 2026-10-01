package ru.musixai.app.core.player

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import android.app.PendingIntent
import android.content.Intent
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.core.net.toUri
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.ForwardingPlayer
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.BitmapLoader
import androidx.media3.common.util.UnstableApi
import androidx.media3.database.StandaloneDatabaseProvider
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.DataSourceBitmapLoader
import androidx.media3.datasource.HttpDataSource
import androidx.media3.datasource.ResolvingDataSource
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.datasource.cache.CacheWriter
import androidx.media3.datasource.cache.LeastRecentlyUsedCacheEvictor
import androidx.media3.datasource.cache.SimpleCache
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.DefaultAudioSink
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.upstream.DefaultLoadErrorHandlingPolicy
import androidx.media3.exoplayer.upstream.LoadErrorHandlingPolicy
import androidx.media3.session.CacheBitmapLoader
import androidx.media3.session.CommandButton
import androidx.media3.session.LibraryResult
import androidx.media3.session.MediaLibraryService
import androidx.media3.session.MediaSession
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionError
import androidx.media3.session.SessionResult
import app.musix.api.models.AutoplayIn
import app.musix.api.models.ManifestIn
import app.musix.api.models.TrackOut
import com.google.common.collect.ImmutableList
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.OkHttpClient
import ru.musixai.app.core.data.LibraryRepository
import ru.musixai.app.core.data.Outbox
import ru.musixai.app.core.data.SettingsRepository
import ru.musixai.app.core.model.Track
import ru.musixai.app.core.network.MusixApi
import java.io.File
import java.util.UUID
import javax.inject.Inject

/**
 * The player (1.0.0's service, re-pointed at v2 — phase 4 spec §3). It OWNS what playback
 * needs while no screen is up: the queue, the advance, «Поток» refills, огонёк/вода and the
 * listen events. The UI is one more MediaController, like the notification, the lock
 * screen, Wear OS, Bluetooth and Auto, which all read this one session.
 */
@UnstableApi
@AndroidEntryPoint
class PlaybackService : MediaLibraryService() {
    @Inject lateinit var api: MusixApi
    @Inject lateinit var http: OkHttpClient
    @Inject lateinit var library: LibraryRepository
    @Inject lateinit var outbox: Outbox
    @Inject lateinit var settings: SettingsRepository
    @Inject lateinit var guard: ru.musixai.app.core.data.AccountGuard
    @Inject lateinit var realtime: ru.musixai.app.core.data.Realtime

    private lateinit var exo: ExoPlayer
    private lateinit var resolver: ManifestResolver
    private lateinit var dataFactory: ResolvingDataSource.Factory
    private lateinit var cacheFactory: CacheDataSource.Factory
    private val gain = GainProcessor()
    private var session: MediaLibrarySession? = null

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val main = Handler(Looper.getMainLooper())

    private val listen = ListenAccumulator()
    private var mode = QueueMode.LIST
    private var refillJob: Job? = null
    private var toppedUpFrom: String? = null
    private val playedIds = ArrayDeque<String>()
    private var taste: Taste? = null
    private var errorRetries = 0
    private var skipPending = false
    private val artBytes = object : LinkedHashMap<String, ByteArray>(64, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, ByteArray>?) = size > ART_CACHE_ITEMS
    }
    private val artInFlight = HashSet<String>()
    private var prefetchJob: Job? = null
    private var prefetchFor: List<String> = emptyList()
    private var snippetStop: Job? = null
    private var perfStart = 0L
    // handoff (phase 8 §1): this phone owns the account's playback while it plays here
    private var owner = false
    private var lastPublish = 0L
    private var publishSoon: Job? = null

    private data class Taste(val trackId: String, val kind: String, val locked: Boolean)

    // ─── Lifecycle ──────────────────────────────────────────────────────────

    override fun onCreate() {
        super.onCreate()
        scope.launch { realtime.events.collect(::onRealtime) }
        resolver = ManifestResolver(fetch = ::fetchManifest, network = ::network, lookahead = ::lookahead)
        // the cache is a process singleton that outlives this service: the hook stays for the process
        val app = applicationContext
        guard.clearMedia = { mediaCache(app).let { c -> c.keys.toList().forEach(c::removeResource) } }
        val cached = CacheDataSource.Factory()
            .setCache(mediaCache(this))
            .setUpstreamDataSourceFactory(OkHttpDataSource.Factory(http))
            .setFlags(CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR)
        cacheFactory = cached
        // musix://track/<id> → the signed URL of the tier for THIS network, cached as id:tier
        dataFactory = ResolvingDataSource.Factory(cached) { spec ->
            val id = ManifestResolver.trackIdOf(spec.uri.toString()) ?: return@Factory spec
            val r = resolver.resolve(id)
            spec.buildUpon().setUri(r.url.toUri()).setKey(r.cacheKey).build()
        }
        val renderers = object : DefaultRenderersFactory(this) {
            override fun buildAudioSink(ctx: android.content.Context, float: Boolean, params: Boolean): AudioSink =
                DefaultAudioSink.Builder(ctx).setAudioProcessors(arrayOf(gain)).build()
        }
        exo = ExoPlayer.Builder(this, renderers)
            .setMediaSourceFactory(DefaultMediaSourceFactory(dataFactory).setLoadErrorHandlingPolicy(ResolvePolicy()))
            // audio is small next to video: hold 1–3 min ahead (1.0.0), so a short dead zone
            // on mobile data is not a stop; whole-track prefetch to disk covers the rest
            .setLoadControl(DefaultLoadControl.Builder().setBufferDurationsMs(60_000, 180_000, 2_500, 5_000).build())
            .setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(), true)
            .setHandleAudioBecomingNoisy(true)
            .setWakeMode(C.WAKE_MODE_NETWORK)
            .build()
        exo.addListener(PlayerEvents())
        session = MediaLibrarySession.Builder(this, ListenerAwarePlayer(exo), SessionCallback())
            .setSessionActivity(launchIntent())
            .setMediaButtonPreferences(buttons())
            .setBitmapLoader(CoverFirstBitmapLoader(CacheBitmapLoader(DataSourceBitmapLoader.Builder(this).setMaximumOutputDimension(ARTWORK_MAX_PX).build())))
            .build()
        publishMode()
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaLibrarySession? = session

    override fun onDestroy() {
        realtime.keep(false)
        prefetchJob?.cancel()
        stopTicker()
        finishListen(atEnd = false, skipped = false)
        session?.run { player.release(); release() }
        session = null
        scope.cancel()
        super.onDestroy()
    }

    // ─── Manifest ───────────────────────────────────────────────────────────

    private fun network(): Network {
        val cm = getSystemService(ConnectivityManager::class.java)
        val caps = cm?.getNetworkCapabilities(cm.activeNetwork) ?: return Network.CELLULAR
        return if (caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)) Network.WIFI else Network.CELLULAR
    }

    /** The queue ids after [trackId] — read on a loader thread, so from a main-thread snapshot. */
    @Volatile private var queueSnapshot: List<String> = emptyList()

    private fun lookahead(trackId: String): List<String> {
        val q = queueSnapshot
        val i = q.indexOf(trackId)
        return if (i < 0) emptyList() else q.drop(i + 1).take(5)
    }

    private fun fetchManifest(ids: List<String>, net: Network): List<ManifestEntry> = runBlocking {
        api.call { media.manifestApiV2PlaybackManifestPost(ManifestIn(trackIds = ids.map(UUID::fromString), network = ManifestIn.Network.valueOf(net.wire))) }
            .items.map { m ->
                ManifestEntry(
                    trackId = m.trackId.toString(),
                    sources = listOf(m.tier.value to m.url) + m.fallbacks.map { it.tier.value to it.url },
                    gainDb = m.gain.trackDb?.toDouble(),
                    expiresAtSec = m.expiresAt.toLong(),
                )
            }
    }

    /** A 403/410 re-signs the URL, a 404 falls back to the next tier; each retry re-resolves. */
    private inner class ResolvePolicy : DefaultLoadErrorHandlingPolicy() {
        override fun getRetryDelayMsFor(info: LoadErrorHandlingPolicy.LoadErrorInfo): Long {
            val code = (info.exception as? HttpDataSource.InvalidResponseCodeException)?.responseCode
            val id = ManifestResolver.trackIdOf(info.loadEventInfo.dataSpec.uri.toString())
            if (id != null && code != null && info.errorCount <= 3) {
                when (code) {
                    403, 410 -> { resolver.invalidate(id); return 0 }
                    404 -> if (resolver.fallBack(id)) return 0
                }
            }
            return super.getRetryDelayMsFor(info)
        }
    }

    private fun applyGain(trackId: String) {
        val p = Normalization.plan(resolver.entry(trackId)?.gainDb, settings.normalization)
        exo.volume = p.volume
        gain.gainDb = p.boostDb
    }

    // ─── Commands ──────────────────────────────────────────────────────────

    private suspend fun items(ids: List<String>, source: String? = null, context: String? = null): List<MediaItem> {
        val tracks = library.tracks(ids)
        val images = library.images(tracks.mapNotNull { it.coverImageId })
        return tracks.map { t -> t.toMediaItem(images[t.coverImageId]?.url(256), source, context) }
    }

    private fun playTracks(ids: List<String>, index: Int, positionMs: Long, context: String?) {
        perfStart = android.os.SystemClock.elapsedRealtime()
        scope.launch {
            val list = items(ids, context = context)
            if (list.isEmpty()) return@launch
            mode = QueueMode.LIST
            toppedUpFrom = null
            publishMode()
            exo.setMediaItems(list, index.coerceIn(0, list.size - 1), positionMs)
            exo.prepare()
            exo.play()
        }
    }

    private fun startStream() {
        perfStart = android.os.SystemClock.elapsedRealtime()
        mode = QueueMode.STREAM
        publishMode()
        refillJob?.cancel()
        refillJob = scope.launch {
            val list = try { streamChunk() } catch (e: Exception) { broadcastError("stream_start", e); return@launch }
            if (list.isEmpty()) { broadcastError("stream_empty", IllegalStateException("library is empty")); return@launch }
            exo.setMediaItems(list)
            exo.prepare()
            exo.play()
        }
    }

    private suspend fun streamChunk(): List<MediaItem> {
        val out = api.call { stream.nextChunkApiV2StreamNextGet(settings.sessionId(), QueuePolicy.STREAM_CHUNK, tzOffsetMinutes = tzMinutes()) }
        library.remember(out.items.mapNotNull { it.track }, out.images)
        val pools = out.items.associate { it.trackId.toString() to it.pool }
        return items(out.items.map { it.trackId.toString() }, context = "stream").map { item ->
            item.withExtra(PlayerProtocol.EXTRA_SOURCE, pools[item.mediaId])
        }
    }

    private suspend fun autoplay(seed: String, exclude: List<String>): List<MediaItem> {
        val out = api.call {
            stream.autoplayApiV2StreamAutoplayPost(AutoplayIn(seedTrackId = UUID.fromString(seed), limit = QueuePolicy.AUTOPLAY_LIMIT,
                excludeIds = exclude.map(UUID::fromString)))
        }
        library.remember(out.tracks, out.images)
        return items(out.tracks.map(TrackOut::id).map(UUID::toString), source = "autoplay", context = "queue")
    }

    /** огонёк / вода — from the notification, the watch, the UI, anywhere. */
    private fun react(kind: String, trackId: String? = null) {
        val id = trackId ?: exo.currentMediaItem?.mediaId ?: return
        val cur = taste
        // the active kind stays locked until its charge decays (server rule); the opposite kind supersedes it
        if (cur != null && cur.trackId == id && cur.kind == kind && cur.locked) return
        listen.markInteracted()
        taste = Taste(id, kind, locked = true)
        refreshButtons()
        broadcastTaste()
        scope.launch {
            val eventId = UUID.randomUUID().toString()
            outbox.enqueue(Outbox.SIGNAL, "signal:$eventId", buildJsonObject {
                put("trackId", id); put("kind", kind); put("clientEventId", eventId); put("sessionId", settings.sessionId())
            })
            // only once the signal is recorded does the refill see it (1.0.0: the web raced here)
            if (outbox.flush() is Outbox.Flush.Done && mode == QueueMode.STREAM && exo.currentMediaItem?.mediaId == id) {
                dropTail(Signal.REACTION)
                maybeRefill()
            }
        }
    }

    private fun onListenerSkip() {
        listen.markInteracted()
        skipPending = true
        if (mode == QueueMode.STREAM) dropTail(Signal.SKIP)
    }

    private fun dropTail(signal: Signal, anchor: Int = exo.currentMediaItemIndex) {
        QueuePolicy.dropAfterSignal(signal, anchor, exo.mediaItemCount)?.let { exo.removeMediaItems(it.first, it.last + 1) }
    }

    private fun playNext(trackId: String) = scope.launch {
        val item = items(listOf(trackId), context = "queue").firstOrNull() ?: return@launch
        exo.addMediaItem((exo.currentMediaItemIndex + 1).coerceAtMost(exo.mediaItemCount), item)
        if (exo.mediaItemCount == 1) { exo.prepare(); exo.play() }
    }

    /** Quiz snippets (quiz invariant I-2): a signed URL of a server-cut snippet, played through
     *  the same player but never a listen, and with neutral metadata — the notification and
     *  the watch must not show the answer. */
    private fun playSnippet(url: String, durationMs: Long) {
        val md = MediaMetadata.Builder().setTitle(getString(R.string.quiz_title)).setArtist("MusiX").setIsPlayable(true)
            .setExtras(Bundle().apply { putString(PlayerProtocol.EXTRA_NO_LISTEN, "1") }).build()
        val item = MediaItem.Builder().setMediaId("quiz:${url.hashCode()}").setUri(url).setMediaMetadata(md).build()
        mode = QueueMode.LIST
        exo.setMediaItem(item)
        exo.prepare()
        exo.play()
        snippetStop?.cancel()
        snippetStop = scope.launch { delay(durationMs + 400); if (exo.currentMediaItem?.mediaId == item.mediaId) exo.pause() }
    }

    // ─── Queue upkeep ───────────────────────────────────────────────────────

    private fun maybeRefill() {
        if (refillJob?.isActive == true) return
        val count = exo.mediaItemCount
        val idx = exo.currentMediaItemIndex
        when (mode) {
            QueueMode.STREAM -> if (count > 0 && QueuePolicy.needsStreamRefill(count, idx)) {
                refillJob = scope.launch { runCatching { append(streamChunk()) }.onFailure { broadcastError("stream_refill", it) } }
            }
            // shuffled, the index says nothing about what is left: top up on the last track of the shuffle order
            QueueMode.LIST -> if (if (exo.shuffleModeEnabled) !exo.hasNextMediaItem() else QueuePolicy.needsListTopUp(count, idx)) {
                val seed = exo.currentMediaItem?.mediaId ?: return
                if (seed == toppedUpFrom || exo.currentMediaItem?.noListen() == true) return
                toppedUpFrom = seed
                val exclude = playedIds.toList().takeLast(QueuePolicy.PLAYED_EXCLUDE_MAX)
                refillJob = scope.launch { runCatching { append(autoplay(seed, exclude)) }.onFailure { broadcastError("autoplay_refill", it) } }
            }
        }
    }

    private fun append(list: List<MediaItem>) {
        if (list.isEmpty()) return
        val had = exo.mediaItemCount
        val known = queueIds().toSet()
        val fresh = list.filter { it.mediaId !in known }
        if (fresh.isEmpty()) return
        exo.addMediaItems(fresh)
        if (exo.playbackState == Player.STATE_ENDED) exo.seekTo(had, 0)  // the refill lost the race with the end
    }

    private fun trimHistory() {
        val overflow = QueuePolicy.historyOverflow(exo.currentMediaItemIndex)
        if (overflow > 0) exo.removeMediaItems(0, overflow)
    }

    private fun queueIds(): List<String> = (0 until exo.mediaItemCount).map { exo.getMediaItemAt(it).mediaId }

    // ─── Listens ────────────────────────────────────────────────────────────

    private fun beginListen(item: MediaItem) {
        if (item.noListen()) return
        val e = item.mediaMetadata.extras
        listen.begin(ListenAccumulator.Item(item.mediaId, item.mediaMetadata.durationMs, e?.getString(PlayerProtocol.EXTRA_SOURCE),
            e?.getString(PlayerProtocol.EXTRA_CONTEXT)), exo.currentPosition)
        playedIds.addLast(item.mediaId)
        while (playedIds.size > QueuePolicy.PLAYED_EXCLUDE_MAX) playedIds.removeFirst()
    }

    private fun finishListen(atEnd: Boolean, skipped: Boolean, error: Boolean = false) {
        if (atEnd) listen.completeToEnd()
        val l = listen.finish(skipped, error) ?: return
        scope.launch {
            outbox.enqueue(Outbox.LISTEN, "listen:${l.clientEventId}", l.json(settings.sessionId()))
            outbox.flush()
        }
    }

    private val ticker = object : Runnable {
        override fun run() { tick(); main.postDelayed(this, TICK_MS) }
    }

    private fun tick() {
        val dur = exo.duration.takeIf { it != C.TIME_UNSET && it > 0 }
        listen.tick(exo.currentPosition, exo.isPlaying, dur)
        if (owner && exo.isPlaying && android.os.SystemClock.elapsedRealtime() - lastPublish > PUBLISH_EVERY_MS) publish()
    }

    // ─── Handoff «Слушать на…» ──────────────────────────────────────────────

    /** The queue window, the index and the position, enough for another device to continue. */
    private fun publish() {
        val item = exo.currentMediaItem ?: return
        if (!owner || item.noListen()) return  // a quiz snippet is not a session
        val ids = queueIds()
        val from = (exo.currentMediaItemIndex - 50).coerceAtLeast(0)
        val window = ids.subList(from, (from + 500).coerceAtMost(ids.size))
        lastPublish = android.os.SystemClock.elapsedRealtime()
        realtime.send(buildJsonObject {
            put("type", "playback.state")
            putJsonObject("state") {
                putJsonArray("trackIds") { window.forEach { add(JsonPrimitive(it)) } }
                put("index", exo.currentMediaItemIndex - from)
                put("positionMs", exo.currentPosition.coerceAtLeast(0))
                put("playing", exo.isPlaying)
                put("mode", mode.wire)
                item.mediaMetadata.extras?.getString(PlayerProtocol.EXTRA_CONTEXT)?.let { put("contextType", it) }
            }
        })
    }

    private fun publishSoon() {
        publishSoon?.cancel()
        publishSoon = scope.launch { kotlinx.coroutines.delay(400); publish() }
    }

    private fun onRealtime(msg: JsonObject) {
        when (msg["type"]?.jsonPrimitive?.content) {
            "ready" -> publish()
            "playback.release" -> { owner = false; exo.pause() }
            // never echoed to its sender: another device plays the account now (one active player)
            "playback.state" -> if (msg["playing"]?.jsonPrimitive?.booleanOrNull == true && owner && exo.isPlaying) { owner = false; exo.pause() }
            "playback.command" -> if (owner) when (msg["command"]?.jsonPrimitive?.content) {
                "play" -> exo.play()
                "pause" -> exo.pause()
                "toggle" -> if (exo.isPlaying) exo.pause() else exo.play()
                "next" -> { onListenerSkip(); exo.seekToNextMediaItem() }
                "prev" -> exo.seekToPrevious()
                "seek" -> msg["positionMs"]?.jsonPrimitive?.longOrNull?.let { listen.markInteracted(); exo.seekTo(it) }
                "signal" -> msg["kind"]?.jsonPrimitive?.content?.let { react(it) }
            }
        }
    }

    /** The account's session continued here, from where it was (the state is up to 10 s old). */
    private fun take(play: Boolean) {
        perfStart = android.os.SystemClock.elapsedRealtime()
        scope.launch {
            val s = runCatching { api.call { handoff.playbackSessionApiV2PlaybackSessionGet() } }.getOrNull() ?: return@launch
            val ids = s.state.trackIds.map { it.toString() }
            val list = items(ids, context = s.state.contextType)
            if (list.isEmpty()) return@launch
            val want = ids.getOrNull(s.state.index)
            val at = list.indexOfFirst { it.mediaId == want }
            val lag = if (s.state.playing) (System.currentTimeMillis() - s.updatedAt.toInstant().toEpochMilli()).coerceAtLeast(0) else 0
            mode = if (s.state.mode?.value == "stream") QueueMode.STREAM else QueueMode.LIST
            toppedUpFrom = null
            publishMode()
            owner = true
            exo.setMediaItems(list, at.coerceAtLeast(0), if (at >= 0) s.state.positionMs + lag else 0)
            exo.prepare()
            if (play) exo.play()
        }
    }

    private fun startTicker() { main.removeCallbacks(ticker); main.postDelayed(ticker, TICK_MS) }
    private fun stopTicker() = main.removeCallbacks(ticker)

    // ─── Taste + buttons ────────────────────────────────────────────────────

    private fun refreshTaste(trackId: String) {
        if (taste?.trackId != trackId) { taste = null; refreshButtons() }
        scope.launch {
            val st = runCatching { api.call { listening.signalStateApiV2SignalsStateGet(trackId) } }.getOrNull() ?: return@launch
            val s = st.states[trackId]
            if (exo.currentMediaItem?.mediaId != trackId) return@launch
            taste = s?.let { Taste(trackId, it.kind.value, it.locked) }
            refreshButtons()
            broadcastTaste()
        }
    }

    private fun refreshButtons() { session?.setMediaButtonPreferences(buttons()) }

    /** play/pause · prev · next come from the player; огонёк and вода are overflow buttons
     *  (the expanded notification, the watch's extra page), as in 1.0.0 (its spec §4.6). */
    private fun buttons(): List<CommandButton> {
        val t = taste?.takeIf { it.trackId == exo.currentMediaItem?.mediaId }
        return listOf(
            CommandButton.Builder(CommandButton.ICON_UNDEFINED)
                .setCustomIconResId(if (t?.kind == "fire") R.drawable.ic_fire_filled else R.drawable.ic_fire)
                .setDisplayName(getString(R.string.player_fire))
                .setSessionCommand(SessionCommand(PlayerProtocol.CMD_FIRE, Bundle.EMPTY))
                .setSlots(CommandButton.SLOT_OVERFLOW).build(),
            CommandButton.Builder(CommandButton.ICON_UNDEFINED)
                .setCustomIconResId(if (t?.kind == "water") R.drawable.ic_water_filled else R.drawable.ic_water)
                .setDisplayName(getString(R.string.player_water))
                .setSessionCommand(SessionCommand(PlayerProtocol.CMD_WATER, Bundle.EMPTY))
                .setSlots(CommandButton.SLOT_OVERFLOW).build(),
        )
    }

    private fun publishMode() {
        session?.setSessionExtras(Bundle().apply { putString(PlayerProtocol.EXTRA_MODE, mode.wire) })
        // the queue's title reaches legacy controllers (the watch's Up Next) with the queue
        exo.playlistMetadata = MediaMetadata.Builder()
            .setTitle(getString(if (mode == QueueMode.STREAM) R.string.queue_stream else R.string.queue_list)).build()
    }

    private fun broadcastTaste() {
        val id = exo.currentMediaItem?.mediaId ?: return
        val t = taste?.takeIf { it.trackId == id }
        session?.broadcastCustomCommand(SessionCommand(PlayerProtocol.EVT_TASTE, Bundle.EMPTY), Bundle().apply {
            putString("trackId", id); putString("kind", t?.kind ?: ""); putBoolean("locked", t?.locked ?: false)
        })
    }

    private fun broadcastError(code: String, e: Throwable) {
        Log.w(TAG, "$code: ${e.message}")
        session?.broadcastCustomCommand(SessionCommand(PlayerProtocol.EVT_ERROR, Bundle.EMPTY), Bundle().apply {
            putString("code", code); putString("message", (e.message ?: e.toString()).take(200))
        })
    }

    // ─── Player listener ────────────────────────────────────────────────────

    private inner class PlayerEvents : Player.Listener {
        override fun onMediaItemTransition(item: MediaItem?, reason: Int) {
            finishListen(atEnd = reason == Player.MEDIA_ITEM_TRANSITION_REASON_AUTO, skipped = skipPending)
            skipPending = false
            errorRetries = 0
            queueSnapshot = queueIds()
            if (item == null) return
            if (item.noListen()) { exo.volume = 1f; gain.gainDb = 0f; return }  // a quiz snippet: no taste, no refill
            publishSoon()
            applyGain(item.mediaId)
            beginListen(item)
            refreshTaste(item.mediaId)
            trimHistory()
            maybeRefill()
            ensureArtwork()
            prefetchAhead()
        }

        override fun onTimelineChanged(timeline: androidx.media3.common.Timeline, reason: Int) {
            queueSnapshot = queueIds()
            maybeRefill()
            ensureArtwork()
        }

        override fun onIsPlayingChanged(isPlaying: Boolean) {
            if (isPlaying) owner = true  // playing here = this phone has the account's playback
            realtime.keep(isPlaying)
            publishSoon()
            if (isPlaying && perfStart > 0) {  // spec §8 «stream start»: command → audio playing
                Log.i(PERF, "stream start ${android.os.SystemClock.elapsedRealtime() - perfStart} ms (${network().wire})")
                perfStart = 0
            }
            tick()
            if (isPlaying) startTicker() else stopTicker()
        }

        override fun onPlaybackStateChanged(state: Int) {
            if (state == Player.STATE_ENDED) { finishListen(atEnd = true, skipped = false); maybeRefill() }
        }

        override fun onPositionDiscontinuity(old: Player.PositionInfo, new: Player.PositionInfo, reason: Int) {
            // a seek inside the same track is not listening — re-anchor, no credit
            if (reason == Player.DISCONTINUITY_REASON_SEEK && old.mediaItemIndex == new.mediaItemIndex) { listen.tick(new.positionMs, false, null); publishSoon() }
        }

        override fun onPlayerError(error: PlaybackException) {
            val trackId = exo.currentMediaItem?.mediaId
            broadcastError("player_${error.errorCodeName}", error)
            // retry the SAME track where it stopped (prepare() resumes at the position), bounded,
            // with backoff; then move on rather than fall silent (1.0.0, the web before it)
            if (errorRetries < RETRY_DELAYS_MS.size) {
                val wait = RETRY_DELAYS_MS[errorRetries++]
                scope.launch { delay(wait); if (exo.currentMediaItem?.mediaId == trackId) { trackId?.let(resolver::invalidate); exo.prepare() } }
            } else if (exo.hasNextMediaItem()) {
                finishListen(atEnd = false, skipped = false, error = true)
                errorRetries = 0
                exo.seekToNextMediaItem()
                exo.prepare()
            }
        }
    }

    /** Every command a controller issues passes here — how a listen learns it was touched,
     *  and how a skip in «Поток» drops the stale tail. The service drives [exo] directly. */
    private inner class ListenerAwarePlayer(player: Player) : ForwardingPlayer(player) {
        override fun seekToNext() { onListenerSkip(); super.seekToNext() }
        override fun seekToNextMediaItem() { onListenerSkip(); super.seekToNextMediaItem() }
        override fun seekToPrevious() { listen.markInteracted(); super.seekToPrevious() }
        override fun seekToPreviousMediaItem() { listen.markInteracted(); super.seekToPreviousMediaItem() }
        override fun seekTo(positionMs: Long) { listen.markInteracted(); super.seekTo(positionMs) }
        override fun seekTo(mediaItemIndex: Int, positionMs: Long) {
            if (mediaItemIndex != currentMediaItemIndex) skipPending = true
            listen.markInteracted(); super.seekTo(mediaItemIndex, positionMs)
        }
        override fun pause() { listen.markInteracted(); super.pause() }
    }

    private inner class SessionCallback : MediaLibrarySession.Callback {
        override fun onConnect(session: MediaSession, controller: MediaSession.ControllerInfo): MediaSession.ConnectionResult {
            val commands = MediaSession.ConnectionResult.DEFAULT_SESSION_AND_LIBRARY_COMMANDS.buildUpon()
                .add(SessionCommand(PlayerProtocol.CMD_FIRE, Bundle.EMPTY))
                .add(SessionCommand(PlayerProtocol.CMD_WATER, Bundle.EMPTY))
            if (controller.packageName == packageName) {  // replacing the queue is for our own UI only
                for (c in listOf(PlayerProtocol.CMD_PLAY_TRACKS, PlayerProtocol.CMD_START_STREAM, PlayerProtocol.CMD_PLAY_NEXT, PlayerProtocol.CMD_PLAY_SNIPPET, PlayerProtocol.CMD_TAKE)) {
                    commands.add(SessionCommand(c, Bundle.EMPTY))
                }
            }
            return MediaSession.ConnectionResult.AcceptedResultBuilder(session).setAvailableSessionCommands(commands.build()).build()
        }

        override fun onCustomCommand(session: MediaSession, controller: MediaSession.ControllerInfo, customCommand: SessionCommand, args: Bundle): ListenableFuture<SessionResult> {
            when (customCommand.customAction) {
                PlayerProtocol.CMD_FIRE -> react("fire", args.getString(PlayerProtocol.ARG_TRACK_ID))
                PlayerProtocol.CMD_WATER -> react("water", args.getString(PlayerProtocol.ARG_TRACK_ID))
                PlayerProtocol.CMD_START_STREAM -> startStream()
                PlayerProtocol.CMD_TAKE -> take(args.getBoolean(PlayerProtocol.ARG_PLAY, true))
                PlayerProtocol.CMD_PLAY_NEXT -> args.getString(PlayerProtocol.ARG_TRACK_ID)?.let(::playNext)
                PlayerProtocol.CMD_PLAY_SNIPPET -> playSnippet(args.getString(PlayerProtocol.ARG_URL) ?: return err(),
                    args.getLong(PlayerProtocol.ARG_DURATION_MS, 15_000))
                PlayerProtocol.CMD_PLAY_TRACKS -> {
                    val ids = args.getStringArrayList(PlayerProtocol.ARG_TRACK_IDS).orEmpty()
                    if (ids.isEmpty()) return err()
                    playTracks(ids, args.getInt(PlayerProtocol.ARG_INDEX, 0), args.getLong(PlayerProtocol.ARG_POSITION_MS, 0), args.getString(PlayerProtocol.ARG_CONTEXT))
                }
                else -> return Futures.immediateFuture(SessionResult(SessionError.ERROR_NOT_SUPPORTED))
            }
            return Futures.immediateFuture(SessionResult(SessionResult.RESULT_SUCCESS))
        }

        private fun err() = Futures.immediateFuture(SessionResult(SessionError.ERROR_BAD_VALUE))

        override fun onGetLibraryRoot(session: MediaLibrarySession, browser: MediaSession.ControllerInfo, params: LibraryParams?): ListenableFuture<LibraryResult<MediaItem>> {
            val root = MediaItem.Builder().setMediaId(ROOT_ID)
                .setMediaMetadata(MediaMetadata.Builder().setIsBrowsable(true).setIsPlayable(false).setTitle("MusiX").build()).build()
            return Futures.immediateFuture(LibraryResult.ofItem(root, params))
        }

        override fun onGetChildren(session: MediaLibrarySession, browser: MediaSession.ControllerInfo, parentId: String, page: Int, pageSize: Int,
                                   params: LibraryParams?): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> =
            Futures.immediateFuture(LibraryResult.ofItemList(ImmutableList.of(), params))
    }

    // ─── Whole-track prefetch ───────────────────────────────────────────────

    /** The current and the next track, whole, into the disk cache (1.0.0): a dead zone on
     *  mobile data costs nothing, and the next track needs no network to start. */
    private fun prefetchAhead() {
        val idx = exo.currentMediaItemIndex
        if (idx < 0) return
        val ids = (idx..minOf(idx + 1, exo.mediaItemCount - 1)).map { exo.getMediaItemAt(it).mediaId }.filter { exo.currentMediaItem?.noListen() != true }
        if (ids == prefetchFor && prefetchJob?.isActive == true) return
        prefetchJob?.cancel()
        prefetchFor = ids
        val ahead = lookahead(ids.firstOrNull() ?: return)
        prefetchJob = scope.launch(Dispatchers.IO) {
            runCatching { resolver.prefetch(ids + ahead) }
            for (id in ids) {
                val r = runCatching { resolver.resolve(id) }.getOrNull() ?: break
                val writer = CacheWriter(cacheFactory.createDataSource(), DataSpec.Builder().setUri(r.url.toUri()).setKey(r.cacheKey).build(), null, null)
                val cancel = coroutineContext[Job]?.invokeOnCompletion { writer.cancel() }
                try { writer.cache() } catch (e: Exception) { break } finally { cancel?.dispose() }
            }
        }
    }

    // ─── Artwork as bytes (the watch) ───────────────────────────────────────

    /** The cover INTO the metadata of the current and next few items: what reaches the watch
     *  is the metadata — an https URI it does not fetch — and Media3 builds the legacy
     *  queue's icons from artworkData only (1.0.0's watch fix). */
    private fun ensureArtwork() {
        val idx = exo.currentMediaItemIndex
        if (idx < 0) return
        for (i in idx..minOf(exo.mediaItemCount - 1, idx + ART_AHEAD)) {
            val item = exo.getMediaItemAt(i)
            if (item.mediaMetadata.artworkData != null) continue
            val uri = item.mediaMetadata.artworkUri ?: continue
            val id = item.mediaId
            artBytes[id]?.let { setArtwork(id, it); continue }
            if (!artInFlight.add(id)) continue
            scope.launch {
                val bytes = try {
                    withContext(Dispatchers.IO) {
                        http.newCall(okhttp3.Request.Builder().url(uri.toString()).build()).execute().use { r -> if (r.isSuccessful) r.body.bytes() else null }
                    }
                } catch (e: Exception) { null } finally { artInFlight.remove(id) }
                if (bytes != null && bytes.size <= ART_MAX_BYTES) { artBytes[id] = bytes; setArtwork(id, bytes) }
            }
        }
    }

    private fun setArtwork(trackId: String, bytes: ByteArray) {
        for (i in 0 until exo.mediaItemCount) {
            val item = exo.getMediaItemAt(i)
            if (item.mediaId != trackId || item.mediaMetadata.artworkData != null) continue
            val md = item.mediaMetadata.buildUpon().setArtworkData(bytes, MediaMetadata.PICTURE_TYPE_FRONT_COVER).build()
            exo.replaceMediaItem(i, item.buildUpon().setMediaMetadata(md).build())
        }
    }

    // ─── Helpers ────────────────────────────────────────────────────────────

    private fun tzMinutes(): Int = java.util.TimeZone.getDefault().getOffset(System.currentTimeMillis()) / 60_000

    private fun launchIntent(): PendingIntent {
        val intent = packageManager.getLaunchIntentForPackage(packageName) ?: Intent().setPackage(packageName)
        intent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
        return PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    private fun Track.toMediaItem(art: String?, source: String?, context: String?): MediaItem {
        val extras = Bundle().apply { source?.let { putString(PlayerProtocol.EXTRA_SOURCE, it) }; context?.let { putString(PlayerProtocol.EXTRA_CONTEXT, it) } }
        val md = MediaMetadata.Builder()
            .setArtworkData(artBytes[id], artBytes[id]?.let { MediaMetadata.PICTURE_TYPE_FRONT_COVER })
            .setTitle(title).setArtist(artist).setAlbumTitle(album)
            .setArtworkUri(art?.toUri())
            .setDurationMs(durationMs.takeIf { it > 0 })
            .setIsPlayable(true).setIsBrowsable(false)
            .setMediaType(MediaMetadata.MEDIA_TYPE_MUSIC)
            .setExtras(extras)
            .build()
        return MediaItem.Builder().setMediaId(id).setUri(ManifestResolver.uri(id)).setMediaMetadata(md).build()
    }

    private fun MediaItem.withExtra(key: String, value: String?): MediaItem {
        if (value == null) return this
        val e = Bundle(mediaMetadata.extras ?: Bundle()).apply { putString(key, value) }
        return buildUpon().setMediaMetadata(mediaMetadata.buildUpon().setExtras(e).build()).build()
    }

    private fun MediaItem.noListen() = mediaMetadata.extras?.getString(PlayerProtocol.EXTRA_NO_LISTEN) != null

    /** Our cover first (the 256 px variant via artworkUri), the file's embedded picture only
     *  as a fallback: an embedded FLAC cover is often a 3000 px scan (~36 MB decoded). */
    private class CoverFirstBitmapLoader(private val delegate: BitmapLoader) : BitmapLoader by delegate {
        override fun loadBitmapFromMetadata(metadata: MediaMetadata): ListenableFuture<android.graphics.Bitmap>? =
            metadata.artworkUri?.let { delegate.loadBitmap(it) } ?: metadata.artworkData?.let { delegate.decodeBitmap(it) }
    }

    companion object {
        private const val TAG = "MusixPlayback"
        private const val PERF = "MusixPerf"
        private const val ROOT_ID = "musix.root"
        private const val TICK_MS = 500L
        private const val PUBLISH_EVERY_MS = 10_000L
        private val RETRY_DELAYS_MS = longArrayOf(1000, 3000, 8000)
        private const val CACHE_BYTES = 1L shl 30
        private const val ARTWORK_MAX_PX = 640
        private const val ART_AHEAD = 5
        private const val ART_CACHE_ITEMS = 64
        private const val ART_MAX_BYTES = 200 * 1024

        @Volatile private var cache: SimpleCache? = null

        fun mediaCache(ctx: android.content.Context): SimpleCache = cache ?: synchronized(this) {
            cache ?: SimpleCache(File(ctx.cacheDir, "media"), LeastRecentlyUsedCacheEvictor(CACHE_BYTES), StandaloneDatabaseProvider(ctx)).also { cache = it }
        }
    }
}
