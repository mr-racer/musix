package ru.musixai.app.feature.home

import android.os.Build
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
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
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Outline
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.shadow.Shadow
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import ru.musixai.app.core.designsystem.gesture.HapticCue
import ru.musixai.app.core.designsystem.gesture.LocalMusixHaptics
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.core.designsystem.control.PlayPauseGlyph
import ru.musixai.app.core.designsystem.gesture.pressable
import ru.musixai.app.core.designsystem.oklch
import ru.musixai.app.core.designsystem.motion.rememberParkingLoop
import ru.musixai.app.core.designsystem.surface.GlassTone
import ru.musixai.app.core.designsystem.surface.glassSource
import ru.musixai.app.core.designsystem.surface.liquidGlass
import ru.musixai.app.core.designsystem.surface.rememberGlassSource

/**
 * «Поток»'s orb, r3: the r1 insides (a conic ring, four palette blobs, an iridescent glass
 * cap, the glyph) inside a membrane ([Membrane]) instead of a circle.
 * - a press dents the skin under the finger at once and tilts the body toward it (≤ 4°);
 *   the dent follows the finger while it stays on the orb;
 * - a release that moved ≤ 10 dp starts (or resumes) the stream: the skin rebounds, the
 *   glyph flows ▶ → ❚❚ and [onLaunch] sends the lens wave across the sky; a release while
 *   playing pauses: a short dent inward, no wave;
 * - a finger that leaves the orb cancels: the skin settles, nothing starts.
 * Haptics: press `Lift`, start `Confirm`, pause `ToggleOff`, nothing else.
 * At rest nothing runs: the membrane's loop parks itself; the ring turns only while the
 * stream plays or loads. Reduced motion: a plain button.
 */
@Composable
internal fun MembraneOrb(
    size: Dp,
    blobs: List<Color>,
    playing: Boolean,
    loading: Boolean,
    progress: Float,
    reduced: Boolean,
    onTap: () -> Unit,
    onLaunch: (Offset) -> Unit,
    modifier: Modifier = Modifier,
) {
    val dark = MusixTheme.isDark
    val haptics = LocalMusixHaptics.current
    val density = LocalDensity.current
    val c = blobs.map { animateColorAsState(it, tween(1600), label = "blob").value }
    val membrane = remember { Membrane() }
    val loop = rememberParkingLoop { dt -> membrane.step(dt) }
    val scope = rememberCoroutineScope()
    val tiltX = remember { Animatable(0f) }
    val tiltY = remember { Animatable(0f) }
    var center by remember { mutableStateOf(Offset.Zero) }
    val tap by rememberUpdatedState(onTap)
    val onWave by rememberUpdatedState(onLaunch)
    val isPlaying by rememberUpdatedState(playing)

    // the ring: turns only while the stream plays or loads (2.2 s / 1.1 s a turn), else still
    var angle by remember { mutableFloatStateOf(0f) }
    val period = when { loading -> 1_100f; playing -> 2_200f; else -> 0f }
    LaunchedEffect(period) {
        if (period == 0f) return@LaunchedEffect
        var last = 0L
        while (true) withFrameNanos { t ->
            if (last != 0L) angle = (angle + 360f * ((t - last) / 1e6f) / period) % 360f
            last = t
        }
    }
    val ringAlpha by animateFloatAsState(if (playing || loading) 1f else 0.65f, tween(300), label = "ring")
    val glyph by animateFloatAsState(if (playing) 1f else 0f, spring(dampingRatio = 0.8f, stiffness = 520f), label = "glyph")
    val u = size / 78f  // one r1 orb unit (the orb was 78 dp)
    // the cap's own picture: the blobs it sits on, recorded inside the blur — sharp, so the lens has
    // colour edges to bend (through the blurred ones the cap read as a flat disc)
    val blobSrc = rememberGlassSource()

    Box(modifier.requiredSize(size * 1.42f), contentAlignment = Alignment.Center) {
        Canvas(Modifier.requiredSize(size * 1.41f).graphicsLayer { rotationZ = angle; alpha = ringAlpha }
            .then(if (Build.VERSION.SDK_INT >= 31) Modifier.blur(u * 3.75f, BlurredEdgeTreatment.Unbounded) else Modifier)) {
            drawCircle(Brush.sweepGradient(listOf(c[0], c[1], c[2], c[0])), radius = (u * 45f).toPx())
        }
        if (playing) Dial(progress, dark, size * 1.22f)
        // the body: everything inside the membrane, tilted toward the finger
        Box(
            Modifier.requiredSize(size)
                .onGloballyPositioned { val b = it.boundsInRoot(); center = b.center }
                .graphicsLayer {
                    loop.frame  // read: a new outline every frame the membrane moves
                    shape = MembraneShape(membrane, loop.frame)
                    clip = true
                    rotationX = tiltX.value
                    rotationY = tiltY.value
                    cameraDistance = 12f * density.density
                }
                .semantics {
                    role = Role.Button
                    contentDescription = if (playing) "Поставить Поток на паузу" else "Включить Поток"
                    onClick { tap(); true }
                }
                .then(
                    if (reduced) Modifier.pressable(onClick = { tap() })
                    else Modifier.pointerInput(Unit) {
                        val slop = 10.dp.toPx()
                        awaitEachGesture {
                            val down = awaitFirstDown()
                            val mid = Offset(this.size.width / 2f, this.size.height / 2f)
                            val r = this.size.width / 2f
                            if ((down.position - mid).getDistance() > r) return@awaitEachGesture
                            down.consume()
                            haptics.perform(HapticCue.Lift, fromUser = true)
                            membrane.press(angleOf(down.position.x - mid.x, down.position.y - mid.y))
                            loop.wake()
                            fun tilt(p: Offset) = scope.launch {
                                val n = (p - mid) / r
                                launch { tiltY.animateTo(4f * n.x.coerceIn(-1f, 1f), spring(stiffness = 900f)) }
                                tiltX.animateTo(-4f * n.y.coerceIn(-1f, 1f), spring(stiffness = 900f))
                            }
                            fun untilt() = scope.launch {
                                launch { tiltY.animateTo(0f, spring(dampingRatio = 0.5f, stiffness = 300f)) }
                                tiltX.animateTo(0f, spring(dampingRatio = 0.5f, stiffness = 300f))
                            }
                            tilt(down.position)
                            var moved = false
                            var gone = false
                            while (true) {
                                val ev = awaitPointerEvent()
                                val ch = ev.changes.firstOrNull { it.id == down.id } ?: break
                                if (!ch.pressed) { ch.consume(); break }
                                if ((ch.position - down.position).getDistance() > slop) moved = true
                                val d = ch.position - mid
                                if (!gone && d.getDistance() > r * 1.15f) {
                                    gone = true  // the finger left: cancel, the skin settles
                                    membrane.release(); loop.wake(); untilt()
                                }
                                if (!gone) { membrane.move(angleOf(d.x, d.y)); tilt(ch.position) }
                                ch.consume()
                            }
                            if (gone) return@awaitEachGesture
                            untilt()
                            membrane.release()
                            if (!moved) {
                                if (isPlaying) {
                                    membrane.kick(-1f)
                                    haptics.perform(HapticCue.ToggleOff, fromUser = true)
                                } else {
                                    membrane.kick(0.6f)
                                    haptics.perform(HapticCue.Confirm, fromUser = true)
                                    onWave(center)
                                }
                                tap()
                            }
                            loop.wake()
                        }
                    },
                ),
            contentAlignment = Alignment.Center,
        ) {
            Canvas(Modifier.requiredSize(size).then(if (Build.VERSION.SDK_INT >= 31) Modifier.blur(u * 11f) else Modifier).glassSource(blobSrc)) {
                val k = this.size.width / 62f
                val rr = 27f * k
                fun blob(col: Color, left: Float, top: Float) =
                    if (Build.VERSION.SDK_INT >= 31) drawCircle(col, rr, Offset((left + 27f) * k, (top + 27f) * k))
                    else drawCircle(Brush.radialGradient(listOf(col, col.copy(alpha = 0f)), Offset((left + 27f) * k, (top + 27f) * k), rr * 1.3f), rr * 1.3f, Offset((left + 27f) * k, (top + 27f) * k))
                blob(c[2], -3f, 9f); blob(c[3], 7f, -3f); blob(c[0], 2f, 2f); blob(c[1], 9f, 6f)
            }
            // the cap: clear liquid glass (the owner, 2026-11-15) over the blobs — their colours bend
            // at its rim; the dark body of glass on art keeps the white glyph legible in both themes
            Box(Modifier.requiredSize(u * 50f)
                .liquidGlass(CircleShape, GlassTone.Clear, shadow = false, source = blobSrc, onArt = true)
                .clip(CircleShape)
                .drawBehind {
                    // r1's iridescent sheen at half strength: with a one-hue palette under it the glass
                    // alone reads as a flat tinted disc
                    val d = Offset(0.643f, 0.766f) * (this.size.width * 1.409f / 2f)
                    val m = Offset(this.size.width / 2, this.size.height / 2)
                    drawCircle(Brush.linearGradient(listOf(Color(0x407C5BFF), Color(0x36FF78C8), Color(0x33E0B341)), m - d, m + d))
                },
                contentAlignment = Alignment.Center) {
                if (loading) OrbSpinner(u * 17.5f) else PlayPauseGlyph(glyph, Modifier.size(u * 21f), Color.White)
            }
        }
    }
}

/** The membrane's outline as the body's clip: a smooth closed curve through its points. */
private class MembraneShape(private val m: Membrane, private val version: Int) : Shape {
    override fun createOutline(size: Size, layoutDirection: LayoutDirection, density: Density): Outline {
        val pts = m.outline(size.width / 2f, size.height / 2f, size.width / 2f)
        return Outline.Generic(smoothClosed(pts))
    }
    override fun equals(other: Any?) = other is MembraneShape && other.version == version && other.m === m
    override fun hashCode() = version
}

/** Catmull-Rom through x/y pairs, as cubic Béziers, closed. */
internal fun smoothClosed(pts: FloatArray): Path {
    val n = pts.size / 2
    fun x(i: Int) = pts[2 * ((i % n + n) % n)]
    fun y(i: Int) = pts[2 * ((i % n + n) % n) + 1]
    return Path().apply {
        moveTo(x(0), y(0))
        for (i in 0 until n) {
            cubicTo(
                x(i) + (x(i + 1) - x(i - 1)) / 6f, y(i) + (y(i + 1) - y(i - 1)) / 6f,
                x(i + 1) - (x(i + 2) - x(i)) / 6f, y(i + 1) - (y(i + 2) - y(i)) / 6f,
                x(i + 1), y(i + 1),
            )
        }
        close()
    }
}

/** r1 `OrbProgressArc`: a hairline track and the played arc from 12 o'clock. */
@Composable
private fun Dial(progress: Float, dark: Boolean, size: Dp) {
    val p by animateFloatAsState(progress.coerceIn(0f, 1f), tween(350, easing = LinearEasing), label = "dial")
    val track = if (dark) Color(0x29FFFFFF) else Color(0x2E2E2456)
    val fill = if (dark) Color(0xEBFFFFFF) else oklch(46f, 0.20f, 275f)
    Canvas(Modifier.requiredSize(size)) {
        val u = this.size.width / 76f
        val r = 35f * u
        val tl = Offset(center.x - r, center.y - r)
        val s = Size(r * 2, r * 2)
        drawCircle(track, r, style = Stroke(1.3f * u))
        drawArc(fill, -90f, 360f * p, false, tl, s, style = Stroke(1.6f * u, cap = StrokeCap.Round))
    }
}

/** A ring with its top quarter lit, 0.7 s a turn — only while the wave is being built. */
@Composable
private fun OrbSpinner(size: Dp) {
    var a by remember { mutableFloatStateOf(0f) }
    LaunchedEffect(Unit) {
        var last = 0L
        while (true) withFrameNanos { t -> if (last != 0L) a = (a + 360f * ((t - last) / 1e6f) / 700f) % 360f; last = t }
    }
    Canvas(Modifier.size(size).graphicsLayer { rotationZ = a }) {
        val w = 2.5.dp.toPx()
        drawCircle(Color(0x59FFFFFF), this.size.width / 2 - w / 2, style = Stroke(w))
        drawArc(Color.White, -135f, 90f, false, Offset(w / 2, w / 2), Size(this.size.width - w, this.size.height - w), style = Stroke(w))
    }
}
