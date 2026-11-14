package ru.musixai.app.core.designsystem.gesture

import android.os.SystemClock
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState

/**
 * One action per tap, however fast the fingers: the first call runs, the next ones inside
 * [windowMs] are swallowed (a sheet opened twice, a screen pushed twice, a message sent twice).
 */
class Debouncer(private val windowMs: Long = 500, private val clock: () -> Long = SystemClock::uptimeMillis) {
    private var last = Long.MIN_VALUE

    /** True when the action may run now; the window starts again from here. */
    fun tryRun(): Boolean {
        val now = clock()
        if (last != Long.MIN_VALUE && now - last < windowMs) return false
        last = now
        return true
    }
}

/** [action] guarded by a [Debouncer]: hand the result to any `onClick`. */
@Composable
fun rememberDebounced(windowMs: Long = 500, action: () -> Unit): () -> Unit {
    val gate = remember(windowMs) { Debouncer(windowMs) }
    val current by rememberUpdatedState(action)
    return remember(gate) { { if (gate.tryRun()) current() } }
}
