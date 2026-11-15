package ru.musixai.app.core.designsystem.control

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameMillis
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.PathMeasure
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.core.designsystem.motion.rememberReducedMotion
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

/** What a [Richbox] says. */
enum class RichboxState { Dashed, Waiting, Empty, Progress25, Progress50, Progress75, Done, Cancelled, Error, Warning }

/**
 * «Richbox» — github.com/mishanaer/richbox (MIT © 2026 mishanaer), ported from the vendored
 * `tactile-lib.js` (2026-11-13) without changing its motion: a rounded square whose outline is
 * dashed while it waits (a quarter-turn every 1.3 s, asleep in between — no frames while it rests),
 * fills by quarters, and draws its symbol stroke by stroke: ✓ done (green), ✕ cancelled, ✕ error
 * (red), ! warning. Every change goes through a little press (to 0.9 and back) and a spring.
 * Colours are MusiX's: progress light, the rest as in the original. On light surfaces pass [ink].
 */
@Composable
fun Richbox(state: RichboxState, modifier: Modifier = Modifier, size: Dp = 24.dp, ink: Color? = null) {
    val reduced = rememberReducedMotion()
    var frame by remember { mutableStateOf(rbFrame(state)) }
    LaunchedEffect(state, reduced) {
        if (reduced) { frame = rbFrame(state); return@LaunchedEffect }
        val source = frame
        val target = rbFrame(state)
        val settled = source.sameAs(target)
        val t = RbTransition(source, state)
        val start = withFrameMillis { it }
        if (!settled) while (true) {
            val e = withFrameMillis { it } - start
            if (e >= t.duration) break
            frame = t.sample(e.toFloat())
        }
        frame = target.copy(offset = if (state == RichboxState.Waiting) 0f else source.offset)
        if (state != RichboxState.Waiting) return@LaunchedEffect
        // waiting: a pause, then a quarter-turn on a spring; asleep between the turns
        delay(WAIT_PAUSE.toLong())
        var turn = 0
        while (true) {
            val t0 = withFrameMillis { it }
            while (true) {
                val e = withFrameMillis { it } - t0
                if (e >= WAIT_TURN) break
                frame = frame.copy(offset = -25f * (turn % 4 + rbSpring(e / WAIT_TURN)))
            }
            turn++
            frame = frame.copy(offset = -25f * (turn % 4))
            delay((WAIT_CYCLE - WAIT_TURN).toLong())
        }
    }
    val outline = remember { PathParser().parsePathString(RB_OUTLINE).toPath() }
    val inner = remember { PathParser().parsePathString(RB_INNER).toPath() }
    val length = remember { PathMeasure().apply { setPath(outline, false) }.length }
    val dark = MusixTheme.isDark
    Canvas(modifier.size(size)) {
        val f = frame
        val color = blend(f.colors, ink, dark)
        val k = this.size.minDimension / 100f
        scale(k * f.scale, pivot = Offset(this.size.width / 2, this.size.height / 2)) {
            translate100 {
                val dash = if (f.gap <= 0.001f) null else PathEffect.dashPathEffect(floatArrayOf(f.dash / 100f * length, f.gap / 100f * length), -f.offset / 100f * length)
                drawPath(outline, color, style = Stroke(8.5f, cap = StrokeCap.Round, pathEffect = dash))
                if (f.fill > 0f) clipPath(inner) { drawPath(wedge(f.fill), color) }
                for (s in 0..1) {
                    val r = f.reveal[s]
                    if (r <= 0f) continue
                    val i = s * 4
                    val a = Offset(f.points[i], f.points[i + 1])
                    val b = Offset(f.points[i + 2], f.points[i + 3])
                    drawLine(color, a, a + (b - a) * r, strokeWidth = f.stroke, cap = StrokeCap.Round)
                }
            }
        }
    }
}

/** The drawing is in the original's 100-unit box, centred in the canvas. */
private inline fun androidx.compose.ui.graphics.drawscope.DrawScope.translate100(block: androidx.compose.ui.graphics.drawscope.DrawScope.() -> Unit) {
    val dx = (size.width - 100f) / 2f; val dy = (size.height - 100f) / 2f
    drawContext.transform.translate(dx, dy); block(); drawContext.transform.translate(-dx, -dy)
}

private const val RB_OUTLINE = "M50 5 C85 5 95 15 95 50 C95 85 85 95 50 95 C15 95 5 85 5 50 C5 15 15 5 50 5Z"
private const val RB_INNER = "M50 17 C77 17 83 23 83 50 C83 77 77 83 50 83 C23 83 17 77 17 50 C17 23 23 17 50 17Z"
private const val WAIT_TURN = 300f
private const val WAIT_PAUSE = 1000f
private const val WAIT_CYCLE = WAIT_TURN + WAIT_PAUSE

private val P30 = Color(238, 238, 243).copy(alpha = 0.38f)
private val P60 = Color(238, 238, 243).copy(alpha = 0.6f)
private val PL = Color(238, 238, 243).copy(alpha = 0.86f)
private val RB_COLORS = listOf(P30, P60, P60, PL, PL, PL, Color(0xFF5EC257), P60, Color(0xFFE36C5A), Color(0xFFE6BD1F))
private val RB_SHAPES = listOf(
    floatArrayOf(33f, 51f, 44f, 62f, 44f, 62f, 68f, 38f), floatArrayOf(38f, 38f, 62f, 62f, 38f, 62f, 62f, 38f),
    floatArrayOf(82f, 18f, 50f, 50f, 50f, 50f, 18f, 82f), floatArrayOf(50f, 29f, 50f, 52f, 50f, 70f, 50f, 71f),
)

private fun blend(w: FloatArray, ink: Color?, dark: Boolean): Color {
    var r = 0f; var g = 0f; var b = 0f; var a = 0f; var sum = 0f
    for (i in w.indices) {
        val k = w[i]; if (k <= 0f) continue
        // the light greys are for dark surfaces; on light ones they take the given ink (or near-black)
        val c0 = RB_COLORS[i]
        val c = if (i in setOf(0, 1, 2, 3, 4, 5, 7) && (ink != null || !dark)) (ink ?: Color(0xFF161620)).copy(alpha = c0.alpha) else c0
        r += c.red * k; g += c.green * k; b += c.blue * k; a += c.alpha * k; sum += k
    }
    if (sum <= 0f) return P30
    return Color(r / sum, g / sum, b / sum, a / sum)
}

private fun wedge(fill: Float): Path {
    val p = min(0.99999f, fill)
    return Path().apply {
        moveTo(50f, 50f); lineTo(50f, -50f)
        // the arc of the original (radius 100 round the centre), as a polyline: the clip makes it round
        val steps = 48
        for (i in 1..steps) {
            val a = p * 2 * PI.toFloat() * i / steps
            lineTo(50f + 100f * sin(a), 50f - 100f * cos(a))
        }
        close()
    }
}

private class RbFrame(
    val points: FloatArray, val reveal: FloatArray, val colors: FloatArray, val fill: Float,
    val dash: Float, val gap: Float, val offset: Float, val scale: Float, val stroke: Float,
) {
    fun copy(points: FloatArray = this.points, reveal: FloatArray = this.reveal, colors: FloatArray = this.colors, fill: Float = this.fill,
             dash: Float = this.dash, gap: Float = this.gap, offset: Float = this.offset, scale: Float = this.scale, stroke: Float = this.stroke) =
        RbFrame(points, reveal, colors, fill, dash, gap, offset, scale, stroke)

    fun sameAs(o: RbFrame) = points.contentEquals(o.points) && reveal.contentEquals(o.reveal) && colors.contentEquals(o.colors) &&
        fill == o.fill && dash == o.dash && gap == o.gap && offset == o.offset && scale == o.scale && stroke == o.stroke
}

private fun rbFrame(state: RichboxState): RbFrame {
    val i = state.ordinal
    return RbFrame(
        points = RB_SHAPES[max(0, i - 6)].copyOf(),
        reveal = if (i >= 6) floatArrayOf(1f, 1f) else floatArrayOf(0f, 0f),
        colors = FloatArray(10) { if (it == i) 1f else 0f },
        fill = if (i in 3..5) (i - 2) / 4f else 0f,
        dash = when (i) { 0 -> 8f; 1 -> 21f; else -> 100f },
        gap = when (i) { 0 -> 4.5f; 1 -> 4f; else -> 0f },
        offset = 0f, scale = 1f, stroke = if (i == 8) 8.5f else 9f,
    )
}

private fun c01(x: Float) = x.coerceIn(0f, 1f)
private fun mix(a: Float, b: Float, t: Float) = a + (b - a) * t
private fun mixA(a: FloatArray, b: FloatArray, t: Float) = FloatArray(a.size) { mix(a[it], b[it], t) }
private fun rbSpring(n: Float): Float { val t = c01(n); return ((1 - (1 + 8 * t) * exp(-8 * t)) / (1 - 9 * exp(-8f))) }
private fun easeInOut(t: Float): Float {
    // cubic-bezier(.42, 0, .58, 1)
    if (t <= 0f) return 0f; if (t >= 1f) return 1f
    fun bz(u: Float, a: Float, c: Float) = 3 * a * u * (1 - u) * (1 - u) + 3 * c * u * u * (1 - u) + u * u * u
    var lo = 0f; var hi = 1f; var u = t
    repeat(24) { u = (lo + hi) / 2; if (bz(u, .42f, .58f) < t) lo = u else hi = u }
    return bz(u, 0f, 1f)
}
private fun scaleAt(e: Float, initial: Float): Float {
    if (e < 150) return mix(initial, .9f, easeInOut(c01(e / 150)))
    val t = c01((e - 150) / 150); val clock = t * t * (3 - 2 * t)
    return .9f + .1f * (1 - (1 + 3 * clock) * exp(-3 * clock)) / (1 - 4 * exp(-3f))
}
private fun interp(a: RbFrame, b: RbFrame, t: Float) = RbFrame(
    mixA(a.points, b.points, t), mixA(a.reveal, b.reveal, t), mixA(a.colors, b.colors, t), mix(a.fill, b.fill, t),
    mix(if (a.gap == 0f && b.gap > 0f) b.dash + b.gap else a.dash, if (b.gap == 0f && a.gap > 0f) a.dash + a.gap else b.dash, t),
    mix(a.gap, b.gap, t), a.offset, a.scale, mix(a.stroke, b.stroke, t),
)
private fun len(p: FloatArray, i: Int) = max(.00001f, hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]))
private fun erase(s: RbFrame, amount: Float): FloatArray {
    val l0 = len(s.points, 0); val l1 = len(s.points, 4)
    val removed = amount * (l0 * s.reveal[0] + l1 * s.reveal[1])
    return floatArrayOf(max(0f, s.reveal[0] - max(0f, removed - l1 * s.reveal[1]) / l0), max(0f, s.reveal[1] - removed / l1))
}
private fun draw(t: RbFrame, amount: Float): FloatArray {
    val l0 = len(t.points, 0); val l1 = len(t.points, 4)
    val split = l0 / (l0 + l1)
    return floatArrayOf(c01(amount / split), c01((amount - split) / (1 - split)))
}

private class RbTransition(private val source: RbFrame, private val state: RichboxState) {
    private val target = rbFrame(state)
    private val hasSymbol = source.reveal.any { it > 0f }
    private val toSymbol = target.reveal[0] == 1f
    private val filling = !hasSymbol && toSymbol && source.fill > 0f
    private val erasing = hasSymbol && !toSymbol
    val duration = if (filling || erasing) 550L else 350L

    fun sample(e: Float): RbFrame {
        if (e <= 0f) return source
        val p = rbSpring((e - 150) / 200)
        val scale = scaleAt(e, source.scale)
        if (e <= 150) return source.copy(scale = scale)
        if (filling && e < 350) return source.copy(fill = mix(source.fill, 1f, p), scale = scale)
        if (erasing && e < 350) return source.copy(reveal = erase(source, p), scale = scale)
        if (erasing) return interp(source.copy(reveal = floatArrayOf(0f, 0f)), target, rbSpring((e - 350) / 200)).copy(scale = scale)
        if (toSymbol && !hasSymbol) {
            val amount = rbSpring((e - (if (filling) 350 else 150)) / 200)
            return interp(source, target, amount).copy(points = target.points, fill = 0f, reveal = draw(target, amount), scale = scale)
        }
        return interp(source, target, p).copy(scale = scale)
    }
}
