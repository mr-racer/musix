package ru.musixai.app.core.player

import android.graphics.Bitmap
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * What the home screen widgets show (phase 8 §3). The playback service pushes it on every
 * change: a track change, play/pause, the art arriving, a reaction. The widgets render it
 * when it changes and never poll.
 */
object NowPlaying {
    data class Snapshot(
        val trackId: String? = null,
        val title: String = "",
        val artist: String = "",
        val playing: Boolean = false,
        val art: Bitmap? = null,
        val taste: String? = null,
        val stream: Boolean = false,
    )

    private val _state = MutableStateFlow(Snapshot())
    val state: StateFlow<Snapshot> = _state

    /** Called by the app: re-render the widgets (their sessions may have ended). */
    @Volatile var onChange: ((Snapshot) -> Unit)? = null

    fun publish(s: Snapshot) {
        if (s == _state.value) return
        _state.value = s
        onChange?.invoke(s)
    }
}
