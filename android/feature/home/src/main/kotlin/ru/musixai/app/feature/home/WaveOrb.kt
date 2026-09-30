package ru.musixai.app.feature.home

import android.os.Build
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.keyframes
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.BlurredEdgeTreatment
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.innerShadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.shadow.Shadow
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.dp
import ru.musixai.app.core.designsystem.MusixIcons
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.core.designsystem.component.pressable
import ru.musixai.app.core.designsystem.oklch

/**
 * v1 `.fy-hybrid.tint-irid` as the phone renders it (62 px × 1.25): a blurred conic ring
 * spinning behind the orb, four blurred palette blobs inside it, an iridescent glass cap,
 * the glyph, and — while the wave plays — the watch-bezel progress dial.
 *
 * On phones v1 froze the blob drift, the glow pulse, the breathing and the halo (its
 * "main battery drain on phones" note) and kept only the ring spinning, so this does the
 * same: one rotating texture per frame, the blurs are drawn once. The ring runs faster
 * while playing (2.2 s) and boils while the wave is being built (1.1 s, a spinner glyph).
 */
@Composable
internal fun WaveOrb(blobs: List<Color>, playing: Boolean, loading: Boolean, progress: Float, onClick: () -> Unit) {
    val dark = MusixTheme.isDark
    val c = blobs.map { animateColorAsState(it, tween(1600), label = "blob").value }  // v1: 1.6 s recolor

    // the ring's turn: a frame loop whose speed follows the state without a jump in angle
    var angle by remember { mutableFloatStateOf(0f) }
    val period = when { loading -> 1_100f; playing -> 2_200f; else -> 6_000f }
    LaunchedEffect(period) {
        var last = 0L
        while (true) withFrameNanos { t ->
            if (last != 0L) angle = (angle + 360f * ((t - last) / 1e6f) / period) % 360f
            last = t
        }
    }
    val ringAlpha by animateFloatAsState(if (playing || loading) 1f else 0.65f, tween(300), label = "ring")
    // v1 `fyLaunch`: a press-in bounce when a fresh wave starts
    val launch = remember { Animatable(1f) }
    LaunchedEffect(loading) {
        if (loading) launch.animateTo(1f, keyframes { durationMillis = 600; 1f at 0; 0.92f at 240 using CubicBezierEasing(0.34f, 1.56f, 0.64f, 1f); 1f at 600 })
    }

    Box(Modifier.requiredSize(110.dp).graphicsLayer { scaleX = launch.value; scaleY = launch.value }, contentAlignment = Alignment.Center) {
        // .fy-ring: inset −5 px, conic c1→c2→c3→c1, blur 3 px, .65 → 1
        // the canvas leaves the blur room to fade inside it, or the turning square's edges show
        Canvas(Modifier.requiredSize(110.dp).graphicsLayer { rotationZ = angle; alpha = ringAlpha }
            .then(if (Build.VERSION.SDK_INT >= 31) Modifier.blur(3.75.dp, BlurredEdgeTreatment.Unbounded) else Modifier)) {
            drawCircle(Brush.sweepGradient(listOf(c[0], c[1], c[2], c[0])), radius = 45.dp.toPx())
        }
        if (playing) Dial(progress, dark)
        // .fy-clip with the four blobs (54 px, blur 9 px), at rest as on a phone
        Box(Modifier.requiredSize(78.dp).clip(CircleShape)) {
            Canvas(Modifier.requiredSize(78.dp).then(if (Build.VERSION.SDK_INT >= 31) Modifier.blur(11.dp) else Modifier)) {
                val u = size.width / 62f  // one v1 css px
                val r = 27f * u
                fun blob(col: Color, left: Float, top: Float) =
                    if (Build.VERSION.SDK_INT >= 31) drawCircle(col, r, Offset((left + 27f) * u, (top + 27f) * u))
                    else drawCircle(Brush.radialGradient(listOf(col, col.copy(alpha = 0f)), Offset((left + 27f) * u, (top + 27f) * u), r * 1.3f), r * 1.3f, Offset((left + 27f) * u, (top + 27f) * u))
                blob(c[2], -3f, 9f); blob(c[3], 7f, -3f); blob(c[0], 2f, 2f); blob(c[1], 9f, 6f)
            }
        }
        // .fy-glasscap: inset 11 px, the iridescent 140° tint, a lit rim above and a shade below
        Box(Modifier.requiredSize(50.dp).clip(CircleShape)
            .drawBehind {
                val d = Offset(0.643f, 0.766f) * (size.width * 1.409f / 2f)  // css 140°: toward the lower right
                val mid = Offset(size.width / 2, size.height / 2)
                drawCircle(Brush.linearGradient(listOf(Color(0x807C5BFF), Color(0x6BFF78C8), Color(0x66E0B341)), mid - d, mid + d))
            }
            .innerShadow(CircleShape, Shadow(radius = 0.dp, color = Color(0x80FFFFFF), offset = DpOffset(0.dp, 1.25.dp)))
            .innerShadow(CircleShape, Shadow(radius = 10.dp, color = Color(0x40000000), offset = DpOffset(0.dp, (-3.75).dp))),
            contentAlignment = Alignment.Center) {
            when {
                loading -> Spinner()
                playing -> Icon(MusixIcons.Pause, null, Modifier.size(19.dp), tint = Color.White)
                else -> Icon(MusixIcons.Play, null, Modifier.size(22.dp).offset(x = 2.5.dp), tint = Color.White)
            }
        }
        Box(Modifier.requiredSize(78.dp).clip(CircleShape).pressable(onClick = onClick))
    }
}

/** v1 `OrbProgressArc` (.fy-dial): a hairline track and the played arc from 12 o'clock. */
@Composable
private fun Dial(progress: Float, dark: Boolean) {
    val p by animateFloatAsState(progress.coerceIn(0f, 1f), tween(350, easing = LinearEasing), label = "dial")
    val track = if (dark) Color(0x29FFFFFF) else Color(0x2E2E2456)
    val fill = if (dark) Color(0xEBFFFFFF) else oklch(46f, 0.20f, 275f)
    val glow = if (dark) Color(0x1AFFFFFF) else Color(0x157C5BFF)
    Canvas(Modifier.requiredSize(95.dp)) {
        val u = size.width / 76f
        val r = 35f * u
        val tl = Offset(center.x - r, center.y - r)
        val s = androidx.compose.ui.geometry.Size(r * 2, r * 2)
        drawCircle(track, r, style = Stroke(1.3f * u))
        // the css drop-shadow glow: a soft wide copy under the arc
        drawArc(glow, -90f, 360f * p, false, tl, s, style = Stroke(6f * u, cap = StrokeCap.Round))
        drawArc(fill, -90f, 360f * p, false, tl, s, style = Stroke(1.6f * u, cap = StrokeCap.Round))
    }
}

/** `.fy-spinner`: a 14 px ring, the top quarter lit, 0.7 s a turn. */
@Composable
private fun Spinner() {
    var a by remember { mutableFloatStateOf(0f) }
    LaunchedEffect(Unit) {
        var last = 0L
        while (true) withFrameNanos { t -> if (last != 0L) a = (a + 360f * ((t - last) / 1e6f) / 700f) % 360f; last = t }
    }
    Canvas(Modifier.size(17.5.dp).graphicsLayer { rotationZ = a }) {
        val w = 2.5.dp.toPx()
        drawCircle(Color(0x59FFFFFF), size.width / 2 - w / 2, style = Stroke(w))
        drawArc(Color.White, -135f, 90f, false, Offset(w / 2, w / 2), androidx.compose.ui.geometry.Size(size.width - w, size.height - w), style = Stroke(w))
    }
}
