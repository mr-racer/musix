package ru.musixai.app.feature.player

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import ru.musixai.app.core.data.PlayerRepository
import ru.musixai.app.core.data.AssistantRepository
import ru.musixai.app.core.data.PlaylistRepository
import ru.musixai.app.core.model.Playlist
import kotlinx.coroutines.launch
import androidx.lifecycle.viewModelScope
import ru.musixai.app.core.model.PlayerContext
import ru.musixai.app.core.player.Handoff
import ru.musixai.app.core.player.PlayerController
import ru.musixai.app.core.player.PlayerState
import javax.inject.Inject

data class PlayerUi(
    val player: PlayerState = PlayerState(),
    val context: PlayerContext? = null,
    val envelope: ByteArray? = null,
    val sound: ru.musixai.app.core.model.TrackSound? = null,   // the form, the moments and the parts of the mix
    val stage: ru.musixai.app.core.model.StageFrames? = null,  // the live frames of the «Звук» side
    val lyricsOpen: Boolean = false,
    val queueOpen: Boolean = false,
    val burst: Pair<String, Long>? = null,  // (fire|water, nonce): the combustion replays per tap
    val addOpen: Boolean = false,
    val chatOpen: Boolean = false,
    val chat: List<Pair<Boolean, String>> = emptyList(),  // (mine, text)
    val chatStage: String? = null,
    val chatStream: String? = null,               // the reply so far, while the model writes it
    val chatFor: String? = null,                  // the chat belongs to this track (v1 useTrackChat(trackId))
    val devicesOpen: Boolean = false,              // «Слушать на…»
    val devices: List<Handoff.Device>? = null,     // null: loading
    val remote: Handoff.Remote? = null,            // the account plays on another device
)

@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class PlayerViewModel @Inject constructor(
    private val player: PlayerController,
    private val repo: PlayerRepository,
    private val playlists: PlaylistRepository,
    private val assistant: AssistantRepository,
    private val handoff: Handoff,
    private val sounds: ru.musixai.app.core.data.SoundRepository,
) : ViewModel() {
    val allPlaylists = playlists.playlists

    private val local = MutableStateFlow(PlayerUi())
    private val current = player.state.map { it.trackId }.distinctUntilChanged()

    private val context = current.flatMapLatest { id ->
        flow { emit(id?.let(repo::cached)); if (id != null) emit(runCatching { repo.context(id) }.getOrNull()) }
    }
    // The prefetcher has usually fetched it before the track starts, so the scrubber's wave
    // comes with the song. A 404 means "computing now" (the server queues it): ask again soon.
    private val envelope = current.flatMapLatest { id ->
        flow {
            val hit = id?.let(repo::cachedEnvelope)
            emit(hit)
            if (id != null && hit == null) for (attempt in 0 until 8) {
                val e = repo.envelope(id)
                if (e != null) { emit(e); break }
                kotlinx.coroutines.delay(if (attempt < 3) 1_200L else 4_000L)
            }
        }
    }

    private val sound = current.flatMapLatest { id ->
        flow { emit(id?.let(sounds::cached)); if (id != null) emit(sounds.sound(id)) }
    }
    // the live stage frames, only for a track whose profile has them (the «Звук» side moves with them)
    private val stage = current.flatMapLatest { id ->
        flow {
            emit(null)
            if (id != null && sounds.sound(id)?.hasStage == true) emit(sounds.stage(id))
        }
    }
    private val about = combine(context, sound, stage) { c, s, st -> Triple(c, s, st) }

    val ui: StateFlow<PlayerUi> = combine(player.state, about, envelope, local, handoff.remote) { p, cs, env, l, remote ->
        val (ctx, snd, st) = cs
        l.copy(player = p, context = ctx?.takeIf { it.track.id == p.trackId }, envelope = env, sound = snd, stage = st,
            remote = remote?.takeIf { it.playing },
            // the conversation is about one song: another song shows none of it, nor its «Думаю…»
            chat = if (l.chatFor == p.trackId) l.chat else emptyList(),
            chatStage = l.chatStage.takeIf { l.chatFor == p.trackId },
            chatStream = l.chatStream.takeIf { l.chatFor == p.trackId })
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), PlayerUi())

    /** The stage's sharp cover (the 1024 px variant the prefetcher warms); the media item's art is 256 px. */
    fun stageArt(trackId: String): String? = repo.cached(trackId)?.image?.url(PlayerPrefetch.STAGE_PX)

    fun toggle() = player.toggle()
    fun next() = player.next()
    fun previous() = player.previous()
    fun seek(ms: Long) = player.seek(ms)
    fun jump(index: Int) = player.jump(index)
    fun move(from: Int, to: Int) = player.move(from, to)
    fun remove(index: Int) = player.remove(index)
    fun toggleLyrics() = local.update { it.copy(lyricsOpen = !it.lyricsOpen) }
    fun toggleQueue() = local.update { it.copy(queueOpen = !it.queueOpen) }

    fun openAdd(open: Boolean) = local.update { it.copy(addOpen = open) }

    /** «Слушать на…»: who is online now. */
    fun openDevices(open: Boolean) {
        local.update { it.copy(devicesOpen = open, devices = null) }
        if (open) viewModelScope.launch { local.update { u -> u.copy(devices = runCatching { handoff.devices() }.getOrDefault(emptyList())) } }
    }

    /** The music goes to [id] (or comes here, when [id] is this phone). */
    fun transferTo(id: java.util.UUID) = viewModelScope.launch {
        runCatching { handoff.transfer(id) }
        local.update { it.copy(devicesOpen = false) }
    }

    /** «Слушать здесь»: this phone takes the music back from the device playing it. */
    fun bringHere() = viewModelScope.launch {
        val me = runCatching { handoff.devices() }.getOrNull()?.firstOrNull { it.current } ?: return@launch
        runCatching { handoff.transfer(me.id) }
    }
    fun toggleChat() = local.update { it.copy(chatOpen = !it.chatOpen) }
    /** ↺ in the track chat: a fresh conversation about the same song. */
    fun clearChat() = local.update { if (it.chatStage != null) it else it.copy(chat = emptyList()) }

    /** The track chat (v1 AIChatDrawer): about this song; with [line], lyric explain. */
    fun shuffle() = player.toggleShuffle()

    private var askJob: kotlinx.coroutines.Job? = null

    /** The listener stops the answer: what came so far is dropped, the turn says it was stopped. */
    fun stopAsk() {
        val job = askJob ?: return
        if (local.value.chatStage == null) return
        job.cancel()
        local.update { u -> u.copy(chatStage = null, chatStream = null, chat = u.chat + (false to STOPPED)) }
    }

    /** «Вернуть»: a removed song goes back where it stood (after the current one, then moved). */
    fun restore(trackId: String, at: Int) = viewModelScope.launch {
        player.playNext(trackId)
        kotlinx.coroutines.delay(250)
        val now = player.state.value.index + 1
        if (at != now) player.move(now, at.coerceAtMost(player.state.value.queue.lastIndex))
    }

    fun ask(message: String, line: String? = null) {
        val id = player.state.value.trackId ?: return
        if (local.value.chatStage != null) {
            if (local.value.chatFor == id) return
            // the song changed while the answer about the last one was on its way: that one is dropped
            askJob?.cancel()
            local.update { it.copy(chatStage = null, chatStream = null) }
        }
        if (local.value.chatFor != id) local.update { it.copy(chat = emptyList(), chatFor = id) }
        val history = local.value.chat.takeLast(6).map { (mine, text) -> (if (mine) "user" else "assistant") to text }
        local.update { it.copy(chatOpen = true, chat = it.chat + (true to message), chatStage = "Думаю…") }
        askJob = viewModelScope.launch {
            val r = runCatching {
                assistant.trackChat(id, message, line, history, onStage = { s -> local.update { it.copy(chatStage = s) } },
                    onText = { t -> local.update { it.copy(chatStream = t.ifEmpty { null }) } })
            }
            if (r.exceptionOrNull() is kotlinx.coroutines.CancellationException) return@launch
            local.update { u -> u.copy(chatStage = null, chatStream = null, chat = u.chat + (false to (r.getOrNull()?.text ?: "Не получилось ответить"))) }
        }
    }

    /** «+»: the current track into a playlist (offline-first, through the outbox). */
    fun addTo(p: Playlist?, newName: String? = null, close: Boolean = true) = viewModelScope.launch {
        val id = player.state.value.trackId ?: return@launch
        val pid = p?.id ?: playlists.create(newName ?: return@launch)
        playlists.add(pid, listOf(id))
        if (close) local.update { it.copy(addOpen = false) }
    }

    fun react(kind: String) {
        val p = player.state.value
        if (p.taste == kind && p.tasteLocked) return
        local.update { it.copy(burst = kind to System.nanoTime()) }
        player.react(kind)
    }
}
