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
import ru.musixai.app.core.player.PlayerController
import ru.musixai.app.core.player.PlayerState
import javax.inject.Inject

data class PlayerUi(
    val player: PlayerState = PlayerState(),
    val context: PlayerContext? = null,
    val envelope: ByteArray? = null,
    val lyricsOpen: Boolean = false,
    val queueOpen: Boolean = false,
    val burst: Pair<String, Long>? = null,  // (fire|water, nonce): the combustion replays per tap
    val addOpen: Boolean = false,
    val chatOpen: Boolean = false,
    val chat: List<Pair<Boolean, String>> = emptyList(),  // (mine, text)
    val chatStage: String? = null,
    val explain: Map<Int, Explain> = emptyMap(),  // lyric line → the guru's answer (v1 InlineLyricExplain)
    val explainFor: String? = null,               // … for this track only
)

@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class PlayerViewModel @Inject constructor(
    private val player: PlayerController,
    private val repo: PlayerRepository,
    private val playlists: PlaylistRepository,
    private val assistant: AssistantRepository,
) : ViewModel() {
    val allPlaylists = playlists.playlists

    private val local = MutableStateFlow(PlayerUi())
    private val current = player.state.map { it.trackId }.distinctUntilChanged()

    private val context = current.flatMapLatest { id ->
        flow { emit(id?.let(repo::cached)); if (id != null) emit(runCatching { repo.context(id) }.getOrNull()) }
    }
    private val envelope = current.flatMapLatest { id ->
        flow {
            emit(null)
            if (id != null) for (attempt in 0 until 4) {  // the server computes it on the first ask
                val e = repo.envelope(id)
                if (e != null) { emit(e); break }
                kotlinx.coroutines.delay(2_500L * (attempt + 1))
            }
        }
    }

    val ui: StateFlow<PlayerUi> = combine(player.state, context, envelope, local) { p, ctx, env, l ->
        l.copy(player = p, context = ctx?.takeIf { it.track.id == p.trackId }, envelope = env,
            explain = if (l.explainFor == p.trackId) l.explain else emptyMap())
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), PlayerUi())

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
    fun toggleChat() = local.update { it.copy(chatOpen = !it.chatOpen) }

    /** The track chat (v1 AIChatDrawer): about this song; with [line], lyric explain. */
    fun shuffle() = player.toggleShuffle()

    fun ask(message: String, line: String? = null) {
        val id = player.state.value.trackId ?: return
        if (local.value.chatStage != null) return
        val history = local.value.chat.takeLast(6).map { (mine, text) -> (if (mine) "user" else "assistant") to text }
        local.update { it.copy(chatOpen = true, chat = it.chat + (true to (line?.let { l -> "«$l»" } ?: message)), chatStage = "Думаю…") }
        viewModelScope.launch {
            val r = runCatching { assistant.trackChat(id, message, line, history) { s -> local.update { it.copy(chatStage = s) } } }
            local.update { u -> u.copy(chatStage = null, chat = u.chat + (false to (r.getOrNull()?.text ?: "Не получилось ответить"))) }
        }
    }

    /** A tap on a lyric line: open (asking the guru once) or close its explanation. */
    fun explainLine(i: Int, line: String) {
        val id = player.state.value.trackId ?: return
        val now = local.value.takeIf { it.explainFor == id }?.explain.orEmpty()
        if (i in now) { local.update { it.copy(explain = now - i, explainFor = id) }; return }
        local.update { it.copy(explain = now + (i to Explain.Loading), explainFor = id) }
        viewModelScope.launch {
            val r = runCatching { assistant.trackChat(id, "Объясни строчку", line, emptyList()) { } }
            val text = r.getOrNull()?.text ?: "Гуру сейчас не ответил — попробуй ещё раз"
            local.update { u -> if (u.explainFor != id) u else u.copy(explain = u.explain + (i to Explain.Done(text))) }
        }
    }

    /** «+»: the current track into a playlist (offline-first, through the outbox). */
    fun addTo(p: Playlist?, newName: String? = null) = viewModelScope.launch {
        val id = player.state.value.trackId ?: return@launch
        val pid = p?.id ?: playlists.create(newName ?: return@launch)
        playlists.add(pid, listOf(id))
        local.update { it.copy(addOpen = false) }
    }

    fun react(kind: String) {
        val p = player.state.value
        if (p.taste == kind && p.tasteLocked) return
        local.update { it.copy(burst = kind to System.nanoTime()) }
        player.react(kind)
    }
}
