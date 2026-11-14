package ru.musixai.app.feature.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import ru.musixai.app.core.data.HomeRepository
import ru.musixai.app.core.data.LibraryRepository
import ru.musixai.app.core.model.Home
import ru.musixai.app.core.model.Vibe
import ru.musixai.app.core.model.WavePreset
import ru.musixai.app.core.player.PlayerController
import ru.musixai.app.core.player.PlayerState
import ru.musixai.app.core.player.QueueMode
import javax.inject.Inject

/** [heard]: songs of the album of the day heard on this phone since the home came (the
 *  server's `heard` catches up on the next fetch). */
data class HomeUi(val home: Home? = null, val refreshing: Boolean = false, val tracks: Int = 0, val player: PlayerState = PlayerState(), val tune: Tune = Tune(),
                  val heard: Set<String> = emptySet())

/** «Настроить волну»: open or not, the presets (null: loading), the choice, a failed save.
 *  [shown] is the choice just tapped: it holds until the save lands, so a tap never flickers
 *  back to the old chip for the half second of the round trip (the owner, 2026-10-02). */
data class Tune(
    val open: Boolean = false, val presets: List<WavePreset>? = null, val familiarity: String = "mix", val sound: String? = null,
    val error: String? = null, val shown: Pair<String, String?>? = null, val saved: Boolean = false,
)

@HiltViewModel
class HomeViewModel @Inject constructor(
    private val repo: HomeRepository,
    library: LibraryRepository,
    private val player: PlayerController,
) : ViewModel() {
    private val refreshing = MutableStateFlow(false)
    private val tune = MutableStateFlow(Tune())
    private val heard = MutableStateFlow<Pair<String, Set<String>>>("" to emptySet())  // (album·day, ids)
    val ui: StateFlow<HomeUi> = combine(
        repo.home, combine(refreshing, library.trackCount, ::Pair), player.state,
        combine(tune, repo.wave) { t, w -> val v = t.shown ?: w; t.copy(familiarity = v.first, sound = v.second) }, heard,
    ) { h, (r, n), p, t, s ->
        val key = h.dayAlbum?.let { "${it.albumId}·${it.day}" }
        HomeUi(h, r, n, p, t, if (s.first == key) s.second else emptySet())
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), HomeUi())

    init {
        refresh()
        // a song of the album of the day is heard here once half of it (or four minutes) has
        // played: the server's own rule, so the beads fill while the song is still on
        viewModelScope.launch {
            combine(repo.home, player.state, ::Pair).collect { (h, p) ->
                val d = h.dayAlbum ?: return@collect
                val id = p.trackId ?: return@collect
                if (p.durationMs <= 0 || p.positionMs < minOf(HEARD_MS, p.durationMs / 2) || d.tracks.none { it.id == id }) return@collect
                val key = "${d.albumId}·${d.day}"
                heard.update { (k, ids) -> key to (if (k == key) ids else emptySet()) + id }
            }
        }
    }

    /** «Слушать» on the album of the day: from the first song not heard yet (from the top when
     *  it is played through); when this album is the queue already, pause / resume it. */
    fun albumDay() {
        val d = ui.value.home?.dayAlbum ?: return
        val p = player.state.value
        val ids = d.tracks.map { it.id }
        if (p.mode == QueueMode.LIST && p.trackId in ids) return player.toggle()
        val here = ui.value.heard
        val first = d.tracks.indexOfFirst { it.durationMs > AlbumDayText.SKIT_MS && !it.heard && it.id !in here }
        player.playTracks(ids, if (first < 0 || AlbumDayText.progress(d.tracks, here).done) 0 else first, "album")
    }

    fun closeTune() = tune.update { it.copy(open = false, error = null) }

    fun refresh() = viewModelScope.launch {
        refreshing.value = true
        runCatching { repo.refresh() }
        refreshing.value = false
    }

    /** The orb: start «Поток», or pause/resume it when it is the queue already. */
    fun orb() {
        val p = player.state.value
        if (p.mode == QueueMode.STREAM && p.trackId != null) player.toggle() else player.startStream()
    }

    /** «Настроить волну» opens and closes; the presets come once, on the first open. */
    fun toggleTune() {
        tune.update { it.copy(open = !it.open, error = null, saved = false, shown = if (restart?.isActive == true) it.shown else null) }
        if (tune.value.open && tune.value.presets.isNullOrEmpty()) viewModelScope.launch {
            val list = runCatching { repo.presets() }.getOrNull()
            tune.update { it.copy(presets = list ?: emptyList(), error = if (list == null) "Сервер не ответил — попробуйте ещё раз" else null) }
        }
    }

    private var restart: kotlinx.coroutines.Job? = null

    /**
     * A tap on a chip. «Что» picks one; a tap on the picked one goes back to «Микс» (the
     * default). «Звук» is optional; a tap on the picked one drops it. The panel shows the
     * new choice at once, and only a failed save takes it back. A playing «Поток» restarts
     * once the taps settle (600 ms), not once per tap.
     */
    fun pick(p: WavePreset) {
        val now = ui.value.tune
        val fam = if (p.row == "familiarity") (if (now.familiarity == p.id) DEFAULT else p.id) else now.familiarity
        val sound = if (p.row == "sound") (if (now.sound == p.id) null else p.id) else now.sound
        choose(fam, sound)
    }

    /** «Сбросить»: back to the plain wave (Микс, any sound). */
    fun resetTune() = choose(DEFAULT, null)

    private fun choose(fam: String, sound: String?) {
        tune.update { it.copy(shown = fam to sound, error = null, saved = false) }
        restart?.cancel()
        restart = viewModelScope.launch {
            val ok = runCatching { repo.setWave(fam, sound) }.isSuccess
            tune.update { if (it.shown != fam to sound) it else if (ok) it.copy(saved = true) else it.copy(shown = null, error = "Не сохранилось — нет связи с сервером") }
            if (!ok) return@launch
            kotlinx.coroutines.delay(600)
            val s = player.state.value
            if (s.mode == QueueMode.STREAM && s.trackId != null) player.startStream()
        }
    }

    private companion object {
        const val DEFAULT = "mix"
        const val HEARD_MS = 240_000L
    }

    /** A вайбик plays its tracks as a queue (autoplay continues it, like the web). */
    fun playVibe(v: Vibe) = player.playTracks(v.tracks.map { it.id }, 0, context = "queue")
}
