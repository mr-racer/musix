package ru.musixai.app.feature.player

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.spring
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import ru.musixai.app.core.designsystem.gesture.rubberBand
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.acos
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

/** Apple's momentum projection: where a flick would come to rest (px, from px/s). */
internal fun project(v: Float, rate: Float = 0.998f): Float = (v / 1000f) * rate / (1f - rate)

/** A spring by its response (s) and damping ratio, the way the mock writes them. */
internal fun <T> springOf(response: Float, damping: Float = 1f) =
    spring<T>(dampingRatio = damping, stiffness = ((2 * PI / response) * (2 * PI / response)).toFloat())

/** k / c / m springs of the mock (`core.js`). */
internal fun <T> springKcm(k: Float, c: Float, m: Float = 1f) = spring<T>(dampingRatio = c / (2f * sqrt(k * m)), stiffness = k / m)

/** One card's pose: the page that turns, the one under it, the one at rest. */
internal data class CardPose(
    val rotationY: Float = 0f, val hinge: Boolean = false, val scale: Float = 1f,
    val alpha: Float = 1f, val shade: Float = 0f, val z: Float = 0f, val lift: Float = 0f, val tiltX: Float = 0f, val tiltY: Float = 0f,
)

/**
 * «Перелист» (round 3): the sleeve is hinged on its left edge and its free edge stays under the
 * finger — the angle is the arc cosine of what is left of the width, geometry, not a curve. The
 * next cover already lies beneath and comes up into the light; going back, the previous sleeve
 * unfolds from the hinge and closes over the current one. At the commit the roles change and the
 * picture does not: `sx += dir · W` is the same frame drawn by other cards.
 */
@Stable
internal class PageTurn(private val scope: CoroutineScope) {
    /** How far the change has gone, px of the finger (−: towards the next song). */
    val sx = Animatable(0f)
    val press = Animatable(1f)
    val pause = Animatable(1f)
    val tiltX = Animatable(0f)
    val tiltY = Animatable(0f)
    /** The queue index drawn in the middle (ahead of the player while a commit is on its way). */
    var shown by mutableIntStateOf(-1)
    /** The song the page turns away from, when it is not the neighbour of [shown] (a jump in the queue). */
    var away by mutableStateOf<Int?>(null)
    var width = 1f

    val commitAt get() = width * 0.3f   // a page is let go once it stands past ~45°

    fun pose(slot: Int): CardPose {
        val x = sx.value
        val d = min(width, abs(x))
        val p = d / width
        val moving = d > 0.05f
        val door = if (x < 0) 0 else -1
        val under = if (x < 0) 1 else 0
        return when {
            moving && slot == door -> {
                val th = (acos((if (x < 0) 1f - p else p).coerceIn(0f, 1f)) * 57.2958f)
                CardPose(rotationY = th, hinge = true, alpha = ((90f - th) / 8f).coerceIn(0f, 1f), shade = sin(th / 57.2958f) * 0.62f, z = 3f)
            }
            moving && slot == under -> {
                val open = if (x < 0) p else 1f - p        // how much of it is out from under the sleeve
                CardPose(scale = 0.93f + 0.07f * open, shade = (1f - open) * 0.58f, z = 1f)
            }
            slot == 0 -> CardPose(scale = press.value * pause.value, z = 2f, lift = (1f - press.value) * -60f, tiltX = tiltX.value, tiltY = tiltY.value)
            else -> CardPose(alpha = 0f)
        }
    }

    /** The finger drags to [x]; at an end of the queue the page gives, half as much as a carousel. */
    fun drag(x: Float, hasPrev: Boolean, hasNext: Boolean) {
        val shownAt = if ((x > 0 && !hasPrev) || (x < 0 && !hasNext)) {
            val r = rubberBand(abs(x), width) * 0.5f
            if (x < 0) -r else r
        } else x
        scope.launch { sx.snapTo(shownAt) }
    }

    /** The song changed by [dir]: the same picture, new roles, then the spring takes it home. */
    fun turn(dir: Int, velocity: Float) {
        scope.launch {
            sx.snapTo(sx.value + dir * width)
            sx.animateTo(0f, SettleSpec, initialVelocity = velocity)
            away = null
        }
    }

    fun back(velocity: Float = 0f) { scope.launch { sx.animateTo(0f, SettleSpec, initialVelocity = velocity) } }

    /** A nudge of the first visit: the neighbour shows its edge and goes back. */
    fun nudge(velocityPx: Float) { scope.launch { sx.animateTo(0f, SettleSpec, initialVelocity = velocityPx) } }

    fun down(fx: Float, fy: Float) {
        scope.launch { press.animateTo(0.97f, PressSpec) }
        scope.launch { tiltY.animateTo((fx - 0.5f) * 6f, TiltSpec) }
        scope.launch { tiltX.animateTo(-(fy - 0.5f) * 6f, TiltSpec) }
    }

    fun up() {
        scope.launch { press.animateTo(1f, PressSpec) }
        scope.launch { tiltX.animateTo(0f, TiltSpec) }
        scope.launch { tiltY.animateTo(0f, TiltSpec) }
    }

    /** Paused on the cover side, the cover stands a little forward (1.03). */
    fun paused(on: Boolean) { scope.launch { pause.animateTo(if (on) 1.03f else 1f, PauseSpec) } }

    companion object {
        val SettleSpec = springOf<Float>(0.42f)                 // a page settles without a wobble
        val PressSpec = springKcm<Float>(520f, 26f)
        val PauseSpec = springKcm<Float>(200f, 18f)
        val TiltSpec = springKcm<Float>(300f, 24f)
    }
}
