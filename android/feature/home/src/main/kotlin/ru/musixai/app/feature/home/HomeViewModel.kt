package ru.musixai.app.feature.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import ru.musixai.app.core.data.HomeRepository
import ru.musixai.app.core.data.LibraryRepository
import ru.musixai.app.core.model.Home
import ru.musixai.app.core.model.Vibe
import ru.musixai.app.core.player.PlayerController
import ru.musixai.app.core.player.PlayerState
import ru.musixai.app.core.player.QueueMode
import javax.inject.Inject

data class HomeUi(val home: Home? = null, val refreshing: Boolean = false, val tracks: Int = 0, val player: PlayerState = PlayerState())

@HiltViewModel
class HomeViewModel @Inject constructor(
    private val repo: HomeRepository,
    library: LibraryRepository,
    private val player: PlayerController,
) : ViewModel() {
    private val refreshing = MutableStateFlow(false)
    val ui: StateFlow<HomeUi> = combine(repo.home, refreshing, library.trackCount, player.state) { h, r, n, p -> HomeUi(h, r, n, p) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), HomeUi())

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

    /** A вайбик plays its tracks as a queue (autoplay continues it, like the web). */
    fun playVibe(v: Vibe) = player.playTracks(v.tracks.map { it.id }, 0, context = "queue")
}
