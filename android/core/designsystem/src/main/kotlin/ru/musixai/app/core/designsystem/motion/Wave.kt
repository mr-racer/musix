package ru.musixai.app.core.designsystem.motion

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.spring
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import kotlin.math.PI
import kotlin.math.ceil
import kotlin.math.sin

/**
 * «Волна» (the player's seek line, 2026-11-15; reusable — the mini-player's line, a playing row):
 * a line that ripples while something plays and lies flat when it stops. Its amplitude comes and
 * goes on a critically damped spring, its phase runs only while it [moving] — at rest no frames.
 * Read in the draw phase ([drawWave]); nothing recomposes.
 */
@Stable
class WaveState internal constructor() {
    internal val amp = Animatable(0f)
    internal var phase by mutableFloatStateOf(0f)
}

/** A wave that ripples while [moving] (and the system lets things move). */
@Composable
fun rememberWave(moving: Boolean, height: Float = 3.2f): WaveState {
    val wave = remember { WaveState() }
    val reduced = rememberReducedMotion()
    LaunchedEffect(moving, reduced) {
        val on = moving && !reduced
        val k = (2 * PI / 0.34).toFloat()
        launch { wave.amp.animateTo(if (on) height else 0f, spring(dampingRatio = 1f, stiffness = k * k)) }
        if (on) { var t0 = withFrameNanos { it }; while (true) withFrameNanos { wave.phase += (it - t0) / 1e9f * 5.2f; t0 = it } }
    }
    return wave
}

/**
 * The wave from x = 0 to [to] (px) around [cy]: it fades in from its start and out towards its end,
 * so it grows out of the line and into the thumb. Flat (one straight stroke) when the wave is still.
 */
fun DrawScope.drawWave(wave: WaveState, to: Float, cy: Float, color: Color, width: Dp = 3.dp) {
    if (to <= 0.5f) return
    val d = density
    val a = wave.amp.value * d
    val path = Path().apply {
        moveTo(0f, cy)
        if (a < 0.05f) lineTo(to, cy)
        else {
            val n = ceil(to / (2.5f * d)).toInt().coerceAtLeast(1)
            for (i in 1..n) {
                val xi = to * i / n
                val xd = xi / d
                val env = minOf(1f, xd / 12f, (to - xi) / d / 10f).coerceAtLeast(0f)
                lineTo(xi, cy + sin(xd * 0.3f - wave.phase) * a * env)
            }
        }
    }
    drawPath(path, color, style = Stroke(width.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
}
