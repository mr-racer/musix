package ru.musixai.app.core.designsystem.motion

import android.provider.Settings
import androidx.compose.animation.core.SpringSpec
import androidx.compose.animation.core.spring
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.platform.LocalContext
import kotlin.math.PI
import kotlin.math.sqrt

/** Physical equivalents of the accepted tactile gallery's spring and snap curves.
 * Values describe a unit mass: stiffness = (2π / duration)², dampingRatio = 1 - bounce.
 * Gesture springs retain Animatable's velocity when their target changes. */
object MusixSprings {
    fun <T> settle(): SpringSpec<T> = spring(dampingRatio = .7f, stiffness = ((2 * PI / .35) * (2 * PI / .35)).toFloat())
    fun <T> snap(): SpringSpec<T> = spring(dampingRatio = .85f, stiffness = ((2 * PI / .22) * (2 * PI / .22)).toFloat())
    fun <T> gesture(): SpringSpec<T> = spring(dampingRatio = 34f / (2f * sqrt(380f)), stiffness = 380f)
    fun <T> playIcon(): SpringSpec<T> = spring(dampingRatio = 26f / (2f * sqrt(520f)), stiffness = 520f)
    /** The morph menu's one spring (morph-menu.js: stiffness 320, damping 32). */
    fun <T> menu(): SpringSpec<T> = spring(dampingRatio = 32f / (2f * sqrt(320f)), stiffness = 320f)
    /** A page coming into focus: critically damped over ≈ 560 ms — it arrives, it never bounces. */
    fun <T> page(): SpringSpec<T> = spring(dampingRatio = 1f, stiffness = ((2 * PI / .56) * (2 * PI / .56)).toFloat())
    /** A pop (a cover caught, a check landing): one clear overshoot and done. */
    fun <T> pop(): SpringSpec<T> = spring(dampingRatio = .5f, stiffness = 600f)
}

/** A screen may hold motion still for what it shows (the catalog's «Без анимаций»); null = the system's. */
val LocalReducedMotionOverride = staticCompositionLocalOf<Boolean?> { null }

/** The system's «remove animations» (animator scale 0): decorative motion stays still. */
@Composable
fun rememberReducedMotion(): Boolean {
    val ctx = LocalContext.current
    val system = remember { Settings.Global.getFloat(ctx.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f }
    return LocalReducedMotionOverride.current ?: system
}
