package ru.musixai.app.feature.player

import androidx.compose.animation.core.Animatable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.geometry.Rect
import ru.musixai.app.core.designsystem.gesture.rubberBand
import kotlin.math.abs

/**
 * The player folding into the mini player (round 2, «обложка прилетает в мини-плеер»): 0 open,
 * 1 folded. The cover travels into the bar's cover, the rest of the player goes down and out of
 * focus, the page behind comes forward. A finger on the stage, the top bar or the bar drives it
 * 1:1; let go, it lands by place and speed (the projection), with the finger's velocity.
 */
@Stable
class PlayerFold {
    val p = Animatable(1f)
    /** Root px: where the bar's cover stands, and where the player's stage stands open. */
    var mini by mutableStateOf(Rect.Zero)
    var stage by mutableStateOf(Rect.Zero)
    /** The screen height the gesture is measured against (a full fold is ~52 % of it). */
    var height = 1f
    private var base = 0f
    var past = false
        private set

    /** Is any of the player on screen. */
    val shown: Boolean get() = p.value < 0.999f || p.targetValue < 1f

    fun grab() { base = p.value; past = base > 0.5f }

    /** [dy] px of the finger since [grab]; returns true when the halfway mark is crossed (a haptic). */
    suspend fun drag(dy: Float): Boolean {
        var v = base + dy / (height * 0.52f)
        if (v < 0f) v = -rubberBand(-v * 100f, 100f) / 100f * 0.5f
        if (v > 1f) v = 1f
        p.snapTo(v)
        val now = v > 0.5f
        if (now != past) { past = now; return true }
        return false
    }

    suspend fun release(vy: Float, cancel: Boolean) {
        val land = p.value + project(vy, 0.99f) / (height * 0.52f)
        to(if (cancel) base > 0.5f else land > 0.5f, vy / (height * 0.52f))
    }

    suspend fun to(shut: Boolean, velocity: Float = 0f) {
        p.animateTo(if (shut) 1f else 0f, Spec, initialVelocity = velocity)
    }

    suspend fun snap(shut: Boolean) = p.snapTo(if (shut) 1f else 0f)

    companion object {
        internal val Spec = springKcm<Float>(190f, 25f)
        fun eased(v: Float) = v.coerceIn(0f, 1f)
        @Suppress("unused") private fun near(a: Float, b: Float) = abs(a - b) < 0.001f
    }
}

val LocalPlayerFold = staticCompositionLocalOf<PlayerFold?> { null }
