package ru.musixai.app.feature.assistant

import android.os.Build
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.BlurredEdgeTreatment
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.dropShadow
import androidx.compose.ui.draw.innerShadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.shadow.Shadow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.dp
import ru.musixai.app.core.designsystem.MusixTheme
import kotlin.math.PI
import kotlin.math.sin

enum class OrbState { Idle, Work, Done, Fail, Sleep }

/** v1 `.aio-*` + `.asn-hero` palettes: the state (and, while working, the intent) as colour. */
internal data class OrbPalette(val blobs: List<Color>, val ring: List<Color>, val shadow: Color, val dust: List<Color>, val glow: Pair<Color, Color>)

private fun c(hex: Long) = Color(0xFF000000 or hex)

internal fun orbPalette(state: OrbState, intent: String?, dark: Boolean): OrbPalette = when (state) {
    OrbState.Idle -> OrbPalette(listOf(c(0x7c5bff), c(0xff78c8), c(0xe0b341), c(0xb06bff)), listOf(c(0x7c5bff), c(0xff78c8), c(0xe0b341)),
        Color(0xA67C5BFF), emptyList(), c(0x7c5bff) to c(0xff78c8))
    OrbState.Work -> when (intent) {
        "playlist" -> OrbPalette(listOf(c(0xffb35c), c(0xff6fae), c(0xffd76a), c(0xc86bff)), listOf(c(0xffb35c), c(0xff6fae), c(0xffd76a)),
            Color(0x8CFF9650), List(6) { c(0xffcf94) }, c(0xffb35c) to c(0xff6fae))
        "general" -> OrbPalette(listOf(c(0x3ec9d6), c(0x5f7cff), c(0x5ee6c8), c(0x7b6bff)), listOf(c(0x3ec9d6), c(0x5f7cff), c(0x5ee6c8)),
            Color(0x8C3EC9D6), List(6) { c(0x8ef0e0) }, c(0x3ec9d6) to c(0x5ee6c8))
        "audio_search" -> OrbPalette(listOf(c(0xb48cff), c(0x7c5bff), c(0xd6a8ff), c(0x5f7cff)), listOf(c(0xb48cff), c(0x7c5bff), c(0xd6a8ff)),
            Color(0x8C966EFF), List(6) { c(0xcbb0ff) }, c(0xb48cff) to c(0x8f6bff))
        // the default work palette IS lyrics_search (blue)
        else -> OrbPalette(listOf(c(0x4d7dff), c(0x6ac8ff), c(0x8a5cff), c(0x4dd6c2)), listOf(c(0x4d7dff), c(0x6ac8ff), c(0x8a5cff)),
            Color(0x994D7DFF), listOf(c(0x9db8ff), c(0x6ac8ff), c(0x8a5cff), c(0x4dd6c2), c(0x9db8ff), c(0x6ac8ff)), c(0x4d7dff) to c(0x6ac8ff))
    }
    OrbState.Done -> OrbPalette(listOf(c(0x3ecf8e), c(0x6ee7b7), c(0x4dd6c2), c(0x34d399)), listOf(c(0x3ecf8e), c(0x6ee7b7), c(0x4dd6c2)),
        Color(0x803ECF8E), emptyList(), c(0x3ecf8e) to c(0x4dd6c2))
    OrbState.Fail -> OrbPalette(listOf(c(0xe0607e), c(0xc04b6b), c(0xf08a8a), c(0xa04057)), listOf(c(0xe0607e), c(0xc04b6b), c(0xf08a8a)),
        Color(0x73E0607E), emptyList(), c(0xe0607e) to c(0xa04057))
    OrbState.Sleep -> {
        val g = if (dark) c(0x4a4a58) else c(0xb9b6c6)
        OrbPalette(List(4) { g }, listOf(c(0x5a5a68), c(0x3f3f4c), c(0x5a5a68)), Color(0x80000000), emptyList(), c(0x5a5a68) to c(0x3f3f4c))
    }
}

/** Seconds per cycle: the ring, and the four blobs' drift (v1 durations per state). */
private fun ringPeriod(s: OrbState) = when (s) { OrbState.Idle -> 7f; OrbState.Work -> 2f; OrbState.Done -> 9f; OrbState.Fail -> 11f; OrbState.Sleep -> 24f }
private fun blobPeriods(s: OrbState) = if (s == OrbState.Work) floatArrayOf(3f, 3.6f, 4f, 3.2f) else floatArrayOf(8f, 10f, 12f, 9f)

/**
 * v1 `AiOrb` on the assistant page (`.asn-hero`): a conic ring spinning behind a dark
 * glass sphere, four blurred colour blobs drifting inside it, a lit cap, the bob. While
 * working the palette turns to the intent's, everything speeds up, the sphere breathes
 * and six motes are inhaled; asleep, it greys and holds still. Phases accumulate per
 * frame, so a change of speed never jumps.
 */
@Composable
fun AiOrb(state: OrbState, intent: String?, size: Dp, modifier: Modifier = Modifier) {
    val dark = MusixTheme.isDark
    val pal = orbPalette(state, intent, dark)
    val blobs = pal.blobs.map { animateColorAsState(it, tween(800), label = "blob").value }
    val ring = pal.ring.map { animateColorAsState(it, tween(800), label = "ring").value }
    val shadow by animateColorAsState(pal.shadow, tween(800), label = "shadow")
    val st by rememberUpdatedState(state)

    var ringA by remember { mutableFloatStateOf(0f) }
    val blobP = remember { FloatArray(4) }
    var tick by remember { mutableFloatStateOf(0f) }  // drives redraws of the blobs
    var bob by remember { mutableFloatStateOf(0f) }
    var dust by remember { mutableFloatStateOf(0f) }
    LaunchedEffect(Unit) {
        var last = 0L
        while (true) withFrameNanos { t ->
            // slow drifts (2–12 s cycles) read the same at 30 fps, and it halves the orb's drawing
            if (last != 0L && t - last < 33_000_000L) return@withFrameNanos
            val dt = if (last == 0L) 0f else (t - last) / 1e9f
            last = t
            if (st != OrbState.Sleep) {
                ringA = (ringA + 360f * dt / ringPeriod(st)) % 360f
                val per = blobPeriods(st)
                for (i in 0..3) blobP[i] = (blobP[i] + dt / per[i]) % 1f
                bob = (bob + dt / (if (st == OrbState.Work) 1.9f else 4.5f)) % 1f
                dust = if (st == OrbState.Work) dust + dt else 0f
                tick = t.toFloat()
            }
        }
    }
    val ringAlpha = when (state) { OrbState.Idle -> 0.72f; OrbState.Work -> 0.9f; OrbState.Done -> 0.6f; OrbState.Fail -> 0.4f; OrbState.Sleep -> 0.18f }
    // the bob (or, at work, the breath) rides each part's own layer: on a common parent it moved
    // the blurred ring's ancestor every frame, which crashed the emulator's renderer
    val sway: androidx.compose.ui.graphics.GraphicsLayerScope.() -> Unit = {
        run {
            if (st == OrbState.Work) {  // aioBreathe: a swell at 60 %
                val k = bob; val s = 1f + 0.045f * (if (k < 0.6f) sin(k / 0.6f * PI / 2).toFloat() else sin((1f - (k - 0.6f) / 0.4f) * PI / 2).toFloat())
                scaleX = s; scaleY = s
            } else translationY = -7.dp.toPx() * (0.5f - 0.5f * kotlin.math.cos(bob * 2 * PI).toFloat())  // aioBob
        }
    }
    Box(modifier.requiredSize(size + 40.dp), contentAlignment = Alignment.Center) {
        // .aio-ring: inset −6 px, conic, blurred
        Canvas(Modifier.requiredSize(size + 30.dp).graphicsLayer { sway(); rotationZ = ringA; alpha = ringAlpha }
            .then(if (Build.VERSION.SDK_INT >= 31) Modifier.blur(3.dp, BlurredEdgeTreatment.Unbounded) else Modifier)) {
            drawCircle(Brush.sweepGradient(ring + ring.first()), radius = (size / 2 + 6.dp).toPx())
        }
        // .aio-orb: the dark glass body and its coloured drop
        Box(Modifier.requiredSize(size).graphicsLayer { sway() }
            .dropShadow(CircleShape, Shadow(radius = 40.dp, spread = (-8).dp, color = shadow, offset = DpOffset(0.dp, 16.dp)))
            .clip(CircleShape).background(if (dark) Color(0xFF241F38) else Color(0xFFCFC8E8))) {
            // one canvas for the four blobs: each gradient is built once per colour and moved by the
            // canvas matrix. Moving blurred or gradient layers beside other animation crashed the
            // emulator's renderer; v1's blur(14px) is the gradient's soft edge.
            val rPx = with(androidx.compose.ui.platform.LocalDensity.current) { (size * 0.846f / 2 + 14.dp).toPx() }
            val brushes = blobs.map { col ->
                androidx.compose.runtime.remember(col, rPx) {
                    Brush.radialGradient(listOf(col, col.copy(alpha = 0.85f), col.copy(alpha = 0.35f), Color.Transparent), Offset(rPx, rPx), rPx)
                }
            }
            Canvas(Modifier.fillMaxSize()) {
                tick.let { }
                val px = 1.dp.toPx()
                val r = rPx
                val tops = floatArrayOf(5f, 11f, 17f, -7f); val lefts = floatArrayOf(2f, 17f, -7f, 13f)
                for (i in 0..3) {
                    val k = 0.5f - 0.5f * kotlin.math.cos(blobP[i] * 2 * PI).toFloat()
                    val (a, b) = when (i) {
                        0 -> floatArrayOf(-0.18f, -0.12f, 1f) to floatArrayOf(0.22f, 0.16f, 1.25f)
                        2 -> floatArrayOf(0.06f, 0.22f, 0.9f) to floatArrayOf(-0.22f, -0.16f, 1.2f)
                        else -> floatArrayOf(0.20f, 0.18f, 1.1f) to floatArrayOf(-0.16f, -0.10f, 0.9f)
                    }
                    val kk = if (i == 3) 1f - k else k
                    val dx = (lefts[i] - 14f) * px + (a[0] + (b[0] - a[0]) * kk) * 2 * r
                    val dy = (tops[i] - 14f) * px + (a[1] + (b[1] - a[1]) * kk) * 2 * r
                    val sc = a[2] + (b[2] - a[2]) * kk
                    translate(dx, dy) {
                        scale(sc, sc, Offset(r, r)) {
                            drawCircle(brushes[i], r, Offset(r, r))
                        }
                    }
                }
            }
            // .aio-cap: the lit glass over it
            Canvas(Modifier.fillMaxSize()) {
                val w = this.size.width
                drawRect(Brush.verticalGradient(0f to Color.White.copy(alpha = 0.10f), 0.4f to Color.Transparent, 1f to Color.Black.copy(alpha = 0.25f)))
                scale(1f, 0.42f / 0.60f, Offset(w * 0.32f, w * 0.20f)) {
                    drawCircle(Brush.radialGradient(0f to Color.White.copy(alpha = 0.42f), 0.6f to Color.White.copy(alpha = 0.05f), 0.7f to Color.Transparent, 1f to Color.Transparent,
                        center = Offset(w * 0.32f, w * 0.20f), radius = w * 0.6f), radius = w * 0.6f, center = Offset(w * 0.32f, w * 0.20f))
                }
            }
            Box(Modifier.fillMaxSize()
                .innerShadow(CircleShape, Shadow(radius = 0.dp, color = Color.White.copy(alpha = 0.5f), offset = DpOffset(0.dp, 1.dp)))
                .innerShadow(CircleShape, Shadow(radius = 10.dp, color = Color.Black.copy(alpha = 0.35f), offset = DpOffset(0.dp, (-4).dp))))
        }
        // .aio-dust: six motes breathed in toward the centre, staggered
        if (state == OrbState.Work && pal.dust.isNotEmpty()) Canvas(Modifier.requiredSize(size + 40.dp).graphicsLayer { sway() }) {
            val from = listOf(-78f to -42f, 74f to -54f, 86f to 28f, -84f to 36f, -12f to -82f, 32f to 78f)
            val delay = listOf(0f, 0.3f, 0.65f, 0.95f, 1.3f, 1.55f)
            val px = 1.dp.toPx()
            for (i in 0..5) {
                val tt = dust - delay[i]
                if (tt < 0f) continue
                val k = (tt % 1.9f) / 1.9f
                val e = k * k  // ease-in
                val alpha = when { k < 0.12f -> k / 0.12f * 0.9f; k < 0.7f -> 0.9f - (k - 0.12f) / 0.58f * 0.2f; else -> 0.7f * (1f - (k - 0.7f) / 0.3f) }
                val (dx, dy) = from[i]
                val p = Offset(center.x + (dx + (-2f - dx) * e) * px, center.y + (dy + (-2f - dy) * e) * px)
                val rr = 2.5f * px * (1f - 0.7f * e)
                drawCircle(pal.dust[i].copy(alpha = alpha * 0.45f), rr * 3.2f, p)
                drawCircle(pal.dust[i].copy(alpha = alpha), rr, p)
            }
        }
    }
}
