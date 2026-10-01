package ru.musixai.app.core.player

import android.content.ComponentName
import android.content.Context
import android.os.Bundle
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionResult
import androidx.media3.session.SessionToken
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.MoreExecutors
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

data class QueueEntry(val index: Int, val trackId: String, val title: String, val artist: String, val artUri: String?)

data class PlayerState(
    val connected: Boolean = false,
    val trackId: String? = null,
    val title: String = "",
    val artist: String = "",
    val artUri: String? = null,
    val isPlaying: Boolean = false,
    val buffering: Boolean = false,
    val positionMs: Long = 0,
    val durationMs: Long = 0,
    val queue: List<QueueEntry> = emptyList(),
    val index: Int = -1,
    val mode: QueueMode = QueueMode.LIST,
    val taste: String? = null,
    val tasteLocked: Boolean = false,
    val shuffle: Boolean = false,
    val error: String? = null,
)

/** The UI's handle on [PlaybackService]: one MediaController in-process — the same channel
 *  the notification and the watch use (spec §1: no WebView bridge). */
@Singleton
class PlayerController @Inject constructor(@ApplicationContext private val ctx: Context) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val _state = MutableStateFlow(PlayerState())
    val state: StateFlow<PlayerState> = _state
    private var future: ListenableFuture<MediaController>? = null
    private var controller: MediaController? = null
    private var ticker: Job? = null

    fun connect() {
        if (future != null) return
        val token = SessionToken(ctx, ComponentName(ctx, PlaybackService::class.java))
        val f = MediaController.Builder(ctx, token).setListener(object : MediaController.Listener {
            override fun onCustomCommand(controller: MediaController, command: SessionCommand, args: Bundle): ListenableFuture<SessionResult> {
                when (command.customAction) {
                    PlayerProtocol.EVT_TASTE -> _state.update {
                        if (it.trackId == args.getString("trackId")) it.copy(taste = args.getString("kind")?.ifEmpty { null }, tasteLocked = args.getBoolean("locked")) else it
                    }
                    PlayerProtocol.EVT_ERROR -> _state.update { it.copy(error = args.getString("code")) }
                }
                return Futures.immediateFuture(SessionResult(SessionResult.RESULT_SUCCESS))
            }

            override fun onExtrasChanged(controller: MediaController, extras: Bundle) {
                val m = if (extras.getString(PlayerProtocol.EXTRA_MODE) == QueueMode.STREAM.wire) QueueMode.STREAM else QueueMode.LIST
                _state.update { it.copy(mode = m) }
            }
        }).buildAsync()
        future = f
        f.addListener({
            val c = runCatching { f.get() }.getOrNull() ?: return@addListener
            controller = c
            c.addListener(object : Player.Listener {
                override fun onEvents(player: Player, events: Player.Events) = refresh()
            })
            refresh()
        }, MoreExecutors.directExecutor())
    }

    private fun refresh() {
        val c = controller ?: return
        val item = c.currentMediaItem
        val queue = (0 until c.mediaItemCount).map { i -> c.getMediaItemAt(i).entry(i) }
        _state.update {
            val same = it.trackId == item?.mediaId
            it.copy(
                connected = true,
                trackId = item?.mediaId,
                title = item?.mediaMetadata?.title?.toString().orEmpty(),
                artist = item?.mediaMetadata?.artist?.toString().orEmpty(),
                artUri = item?.mediaMetadata?.artworkUri?.toString(),
                isPlaying = c.isPlaying,
                buffering = c.playbackState == Player.STATE_BUFFERING,
                positionMs = c.currentPosition,
                durationMs = c.duration.takeIf { d -> d > 0 } ?: (item?.mediaMetadata?.durationMs ?: 0),
                queue = queue,
                index = c.currentMediaItemIndex,
                shuffle = c.shuffleModeEnabled,
                taste = if (same) it.taste else null,
                tasteLocked = if (same) it.tasteLocked else false,
            )
        }
        if (c.isPlaying) startTicker() else ticker?.cancel()
    }

    private fun startTicker() {
        if (ticker?.isActive == true) return
        ticker = scope.launch {
            while (isActive) {
                controller?.let { c -> _state.update { it.copy(positionMs = c.currentPosition) } }
                delay(250)
            }
        }
    }

    private fun MediaItem.entry(i: Int) = QueueEntry(i, mediaId, mediaMetadata.title?.toString().orEmpty(),
        mediaMetadata.artist?.toString().orEmpty(), mediaMetadata.artworkUri?.toString())

    private fun send(action: String, args: Bundle = Bundle.EMPTY) {
        connect()
        val c = controller
        if (c != null) c.sendCustomCommand(SessionCommand(action, Bundle.EMPTY), args)
        else future?.addListener({ runCatching { future!!.get().sendCustomCommand(SessionCommand(action, Bundle.EMPTY), args) } }, MoreExecutors.directExecutor())
    }

    fun playTracks(ids: List<String>, index: Int = 0, context: String? = null) = send(PlayerProtocol.CMD_PLAY_TRACKS, Bundle().apply {
        putStringArrayList(PlayerProtocol.ARG_TRACK_IDS, ArrayList(ids)); putInt(PlayerProtocol.ARG_INDEX, index)
        context?.let { putString(PlayerProtocol.ARG_CONTEXT, it) }
    })

    fun startStream() = send(PlayerProtocol.CMD_START_STREAM)
    /** «Слушать на…» brought the music here: the service fetches the session and continues it. */
    fun take(play: Boolean) = send(PlayerProtocol.CMD_TAKE, Bundle().apply { putBoolean(PlayerProtocol.ARG_PLAY, play) })
    fun playNext(trackId: String) = send(PlayerProtocol.CMD_PLAY_NEXT, Bundle().apply { putString(PlayerProtocol.ARG_TRACK_ID, trackId) })
    fun snippet(url: String, durationMs: Long) = send(PlayerProtocol.CMD_PLAY_SNIPPET, Bundle().apply {
        putString(PlayerProtocol.ARG_URL, url); putLong(PlayerProtocol.ARG_DURATION_MS, durationMs)
    })
    /** A quiz snippet replaced the queue (no-listen): stopping it is a pause of that item. */
    fun stopSnippet() { controller?.pause() }
    fun react(kind: String) = send(if (kind == "fire") PlayerProtocol.CMD_FIRE else PlayerProtocol.CMD_WATER)

    fun toggle() { controller?.let { if (it.isPlaying) it.pause() else it.play() } }
    fun next() { controller?.seekToNextMediaItem() }
    fun previous() { controller?.seekToPrevious() }
    fun seek(ms: Long) { controller?.seekTo(ms) }
    fun jump(index: Int) { controller?.seekTo(index, 0) }
    fun move(from: Int, to: Int) { controller?.moveMediaItem(from, to) }
    fun remove(index: Int) { controller?.removeMediaItem(index) }
    fun stop() { controller?.run { stop(); clearMediaItems() } }
    fun toggleShuffle() { controller?.let { it.shuffleModeEnabled = !it.shuffleModeEnabled } }
}
