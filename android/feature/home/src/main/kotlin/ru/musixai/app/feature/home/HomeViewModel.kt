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

data class HomeUi(val home: Home? = null, val refreshing: Boolean = false, val tracks: Int = 0, val player: PlayerState = PlayerState(), val tune: Tune = Tune())

/** «Настроить волну»: open or not, the presets (null: loading), the choice, a failed save. */
data class Tune(val open: Boolean = false, val presets: List<WavePreset>? = null, val familiarity: String = "mix", val sound: String? = null, val error: String? = null)

@HiltViewModel
class HomeViewModel @Inject constructor(
    private val repo: HomeRepository,
    library: LibraryRepository,
    private val player: PlayerController,
) : ViewModel() {
    private val refreshing = MutableStateFlow(false)
    private val tune = MutableStateFlow(Tune())
    val ui: StateFlow<HomeUi> = combine(repo.home, refreshing, library.trackCount, player.state, combine(tune, repo.wave) { t, w -> t.copy(familiarity = w.first, sound = w.second) }) { h, r, n, p, t ->
        HomeUi(h, r, n, p, t)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), HomeUi())

    init { refresh() }

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
        tune.update { it.copy(open = !it.open, error = null) }
        if (tune.value.open && tune.value.presets.isNullOrEmpty()) viewModelScope.launch {
            val list = runCatching { repo.presets() }.getOrNull()
            tune.update { it.copy(presets = list ?: emptyList(), error = if (list == null) "Сервер не ответил — попробуйте ещё раз" else null) }
        }
    }

    /** A familiarity choice replaces the current one; a sound choice toggles. A playing «Поток» restarts with it (as on the web). */
    fun pick(p: WavePreset) = viewModelScope.launch {
        val now = ui.value.tune
        val fam = if (p.row == "familiarity") p.id else now.familiarity
        val sound = if (p.row == "sound") (if (now.sound == p.id) null else p.id) else now.sound
        val saved = runCatching { repo.setWave(fam, sound) }.isSuccess
        tune.update { it.copy(error = if (saved) null else "Не сохранилось — нет связи с сервером") }
        val s = player.state.value
        if (saved && s.mode == QueueMode.STREAM && s.trackId != null) player.startStream()
    }

    /** A вайбик plays its tracks as a queue (autoplay continues it, like the web). */
    fun playVibe(v: Vibe) = player.playTracks(v.tracks.map { it.id }, 0, context = "queue")
}
