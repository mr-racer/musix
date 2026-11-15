package ru.musixai.app.feature.player

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.wrapContentSize
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
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
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.setProgress
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.core.designsystem.gesture.HapticCue
import ru.musixai.app.core.designsystem.gesture.LocalMusixHaptics
import ru.musixai.app.core.designsystem.gesture.pressable
import ru.musixai.app.core.designsystem.motion.rememberReducedMotion
import ru.musixai.app.core.designsystem.surface.GlassTone
import ru.musixai.app.core.designsystem.surface.glassInk
import ru.musixai.app.core.designsystem.surface.liquidGlass
import ru.musixai.app.core.designsystem.text
import ru.musixai.app.core.model.SoundMoment
import ru.musixai.app.core.model.SoundSection
import kotlin.math.ceil
import kotlin.math.sin

internal fun fmt(s: Double): String { val t = s.coerceAtLeast(0.0).toLong(); return "${t / 60}:${(t % 60).toString().padStart(2, '0')}" }

private val PLAIN_KINDS = setOf("bass_back", "beat_back", "beat_out", "bass_in")

/** The moments worth naming on the line: no plain «the beat is back», six at most, no «(…)» tails. */
internal fun lineMoments(all: List<SoundMoment>): List<SoundMoment> =
    all.filter { it.kind !in PLAIN_KINDS && "новая партия" !in it.label }.take(6).map { it.copy(label = it.label.replace(Regex("""\s*\(.*\)$"""), "")) }

/** The playing position, smooth between the controller's reports (it reports a few times a second). */
internal class Clock {
    var sec by mutableFloatStateOf(0f)
}

@Composable
internal fun rememberClock(positionMs: Long, playing: Boolean, scrubbing: Boolean): Clock {
    val clock = remember { Clock() }
    val at by rememberUpdatedState(positionMs)
    LaunchedEffect(positionMs, playing, scrubbing) {
        if (scrubbing) return@LaunchedEffect
        val start = at / 1000f
        clock.sec = start
        if (!playing) return@LaunchedEffect
        val t0 = withFrameNanos { it }
        while (true) withFrameNanos { clock.sec = start + (it - t0) / 1e9f }
    }
    return clock
}

/**
 * The seek line: the song's form (its sections as blocks, the choruses a shade lighter, the played
 * part filled), one continuous wave over it while it plays, the moments as dots that swell and say
 * their name a few seconds ahead. Scrubbing is 1:1 with the finger: the line thickens, the time and
 * the section ride above it, a tick on every border.
 */
@Composable
internal fun SeekLine(
    clock: Clock,
    durationSec: Double,
    sections: List<SoundSection>,
    moments: List<SoundMoment>,
    playing: Boolean,
    accent: Color,
    lit: LitMoment,
    onScrub: (Boolean) -> Unit,
    onSeek: (Double) -> Unit,
    modifier: Modifier = Modifier,
) {
    val c = MusixTheme.colors
    val ink = c.text
    val haptics = LocalMusixHaptics.current
    val density = LocalDensity.current
    val reduced = rememberReducedMotion()
    val scope = rememberCoroutineScope()
    val d = durationSec.coerceAtLeast(1.0)
    val secs = remember(sections, d) { sections.filter { it.start < d }.ifEmpty { listOf(SoundSection(0.0, d, "whole", "")) } }
    var width by remember { mutableFloatStateOf(1f) }
    var scrub by remember { mutableStateOf<Float?>(null) }   // seconds under the finger
    val shownSec = { scrub ?: clock.sec }
    val secIndex by remember(secs) { derivedStateOf { val p = shownSec(); secs.indexOfFirst { p < it.end }.let { if (it < 0) secs.lastIndex else it } } }

    // the wave: an amplitude that comes and goes on a critically damped spring, a phase that runs while playing
    val amp = remember { Animatable(0f) }
    var phase by remember { mutableFloatStateOf(0f) }
    LaunchedEffect(playing, scrub != null, reduced) {
        val moving = playing && scrub == null && !reduced
        launch { amp.animateTo(if (moving) 3.2f else 0f, springOf(0.34f)) }
        if (moving) { var t0 = withFrameNanos { it }; while (true) withFrameNanos { phase += (it - t0) / 1e9f * 5.2f; t0 = it } }
    }
    val thumb by animateFloatAsState(if (scrub != null) 1f else 0f, springKcm(420f, 24f), label = "thumb")
    val said = remember(moments) { BooleanArray(moments.size) }
    var label by remember { mutableStateOf<Pair<Int, Long>?>(null) }      // the moment that speaks, and since when

    // a moment says what it is a few seconds ahead
    val second by remember { derivedStateOf { clock.sec.toInt() } }
    LaunchedEffect(second, moments, playing) {
        val pos = clock.sec
        moments.forEachIndexed { k, m ->
            val ahead = m.t - pos
            if (ahead > 6.5 || ahead < -1) said[k] = false
            if (playing && scrub == null && ahead > 0 && ahead <= 6 && !said[k]) { said[k] = true; label = k to System.nanoTime() }
        }
    }
    LaunchedEffect(lit.at) { val at = lit.at ?: return@LaunchedEffect; val k = moments.indexOfFirst { kotlin.math.abs(it.t - at) < 0.6 }; if (k >= 0) label = k to System.nanoTime() }
    LaunchedEffect(label) { if (label != null) { delay(3200); label = null } }

    Column(modifier.fillMaxWidth()) {
        Box(
            Modifier.fillMaxWidth().height(36.dp).onSizeChanged { width = it.width.toFloat() }
                .semantics {
                    contentDescription = "Позиция в песне"
                    stateDescription = "${fmt(clock.sec.toDouble())} из ${fmt(d)}"
                    progressBarRangeInfo = androidx.compose.ui.semantics.ProgressBarRangeInfo((clock.sec / d).toFloat().coerceIn(0f, 1f), 0f..1f)
                    setProgress { onSeek(it * d); true }
                }
                .pointerInput(secs, d) {
                    awaitEachGesture {
                        val down = awaitFirstDown()
                        down.consume()
                        var last = -1
                        fun at(x: Float): Float { val s = (x / width).coerceIn(0f, 1f) * d.toFloat(); val i = secs.indexOfFirst { s < it.end }.let { if (it < 0) secs.lastIndex else it }; if (i != last) { if (last >= 0) haptics.perform(HapticCue.Tick, fromUser = true); last = i }; return s }
                        scrub = at(down.position.x); onScrub(true); label = null
                        while (true) {
                            val ev = awaitPointerEvent()
                            val ch = ev.changes.firstOrNull { it.id == down.id } ?: break
                            if (!ch.pressed) break
                            ch.consume()
                            scrub = at(ch.position.x)
                        }
                        scrub?.let { s -> onSeek(s.toDouble()); clock.sec = s }
                        moments.forEachIndexed { k, m -> said[k] = m.t - clock.sec < 6 }
                        scrub = null; onScrub(false)
                    }
                },
        ) {
            Canvas(Modifier.fillMaxWidth().height(36.dp)) {
                val w = size.width
                val pos = shownSec()
                val x = (pos / d.toFloat()).coerceIn(0f, 1f) * w
                // the blocks, 3 dp apart; while scrubbing they grow 2.2× in height
                val gap = 3.dp.toPx()
                val bh = 4.dp.toPx() * (1f + 1.2f * thumb)
                val by = 22.dp.toPx() - bh / 2
                val total = secs.sumOf { it.end - it.start }.toFloat()
                val avail = w - gap * (secs.size - 1)
                var bx = 0f
                secs.forEachIndexed { i, s ->
                    val bw = ((s.end - s.start).toFloat() / total * avail).coerceAtLeast(1f)
                    val r = CornerRadius(2.dp.toPx())
                    drawRoundRect(ink.copy(alpha = if (s.kind == "chorus") 0.32f else 0.2f), Offset(bx, by), Size(bw, bh), r)
                    val p = when { i < secIndex -> 1f; i > secIndex -> 0f; else -> ((pos - s.start) / (s.end - s.start)).toFloat().coerceIn(0f, 1f) }
                    if (p > 0f) drawRoundRect(accent.copy(alpha = 0.34f), Offset(bx, by), Size(bw * p, bh), r)
                    bx += bw + gap
                }
                // the moments
                moments.forEachIndexed { k, m ->
                    val mx = (m.t / d).toFloat() * w
                    val on = label?.first == k
                    val past = m.t < pos
                    drawCircle(if (on) accent else ink.copy(alpha = if (past) 0.24f else 0.5f), radius = 2.5.dp.toPx() * (if (on) 1.7f else 1f), center = Offset(mx, 10.5.dp.toPx()))
                }
                // the wave over the played part, fading in from its start and out towards the thumb
                val cy = 22.dp.toPx()
                val path = Path().apply {
                    moveTo(0f, cy)
                    val a = amp.value * density.density
                    if (x > 0.5f) {
                        if (a < 0.05f) lineTo(x, cy)
                        else {
                            val n = ceil(x / 2.5f.dp.toPx()).toInt().coerceAtLeast(1)
                            for (i in 1..n) {
                                val xi = x * i / n
                                val xd = xi / density.density
                                val env = minOf(1f, xd / 12f, (x - xi) / density.density / 10f).coerceAtLeast(0f)
                                lineTo(xi, cy + sin(xd * 0.3f - phase) * a * env)
                            }
                        }
                    }
                }
                drawPath(path, accent, style = Stroke(3.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
                // the thumb: 10 → 18 with a soft ring while scrubbing
                val tr = (5f + 4f * thumb).dp.toPx()
                if (thumb > 0.01f) drawCircle(accent.copy(alpha = 0.26f * thumb), radius = tr + 7.dp.toPx() * thumb, center = Offset(x, cy))
                drawCircle(accent, radius = tr, center = Offset(x, cy))
            }
            // the time and the section above the finger
            val bubbleA by animateFloatAsState(if (scrub != null) 1f else 0f, tween(180), label = "bubble")
            if (bubbleA > 0.01f) GlassLabel(Modifier.offset { IntOffset(((shownSec() / d.toFloat()) * width).coerceIn(52.dp.toPx(), width - 52.dp.toPx()).toInt(), (-34).dp.roundToPx()) }.graphicsLayer { alpha = bubbleA; val k = 0.8f + 0.2f * bubbleA; scaleX = k; scaleY = k }) {
                Text(fmt(shownSec().toDouble()), style = MusixTheme.text.number.copy(fontWeight = FontWeight.Medium, color = glassInk()))
                Text("  " + (secs.getOrNull(secIndex)?.label.orEmpty()), style = MusixTheme.text.caption.copy(color = glassInk(soft = true)))
            }
            val said2 = label
            val mA by animateFloatAsState(if (said2 != null && scrub == null) 1f else 0f, tween(180), label = "mlabel")
            val shownLabel = remember { mutableIntStateOf(-1) }
            if (said2 != null) shownLabel.intValue = said2.first
            moments.getOrNull(shownLabel.intValue)?.let { m ->
                if (mA > 0.01f) GlassLabel(Modifier.offset { IntOffset(((m.t / d).toFloat() * width).coerceIn(60.dp.toPx(), width - 60.dp.toPx()).toInt(), (-28).dp.roundToPx()) }.graphicsLayer { alpha = mA; val k = 0.8f + 0.2f * mA; scaleX = k; scaleY = k }) {
                    Text(m.label, style = MusixTheme.text.caption.copy(color = glassInk()))
                }
            }
        }
        // the section's name under its start, on a spring
        val sec = secs.getOrNull(secIndex)
        val name = sec?.label?.replaceFirstChar { it.uppercase() }.orEmpty()
        var nameW by remember { mutableFloatStateOf(0f) }
        val secX = remember { Animatable(0f) }
        LaunchedEffect(secIndex, width, nameW) {
            val target = ((sec?.start ?: 0.0) / d * width).toFloat().coerceIn(0f, (width - nameW).coerceAtLeast(0f))
            if (secX.value == 0f && secX.targetValue == 0f) secX.snapTo(target) else secX.animateTo(target, springOf(0.5f))
        }
        Box(Modifier.fillMaxWidth().height(20.dp)) {
            if (name.isNotEmpty()) Row(Modifier.graphicsLayer { translationX = secX.value }.onSizeChanged { nameW = it.width.toFloat() }, verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.width(1.dp).height(10.dp).background(c.textMuted.copy(alpha = 0.7f)))
                androidx.compose.animation.Crossfade(name, animationSpec = tween(200), label = "sec") { n ->
                    Text(n, Modifier.padding(start = 6.dp), maxLines = 1, style = MusixTheme.text.caption.copy(color = c.textMuted))
                }
            }
        }
        // the times; the length turns into what is left on a tap
        var remain by remember { mutableStateOf(false) }
        Row(Modifier.fillMaxWidth().padding(top = 1.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(fmt(shownSec().toDouble()), style = MusixTheme.text.number.copy(fontSize = 12.sp, color = c.textSubtle))
            Box(Modifier.weight(1f))
            Text(if (remain) "−" + fmt(d - shownSec()) else fmt(d),
                Modifier.pressable(role = ru.musixai.app.core.designsystem.gesture.Press.Chip) { remain = !remain }.padding(start = 12.dp, top = 6.dp, bottom = 6.dp).semantics { contentDescription = if (remain) "Показать длину" else "Показать, сколько осталось" },
                maxLines = 1, overflow = TextOverflow.Clip, style = MusixTheme.text.number.copy(fontSize = 12.sp, color = c.textSubtle))
        }
    }
}

/** A moment lit from outside (a pool on the sound side said when its instrument comes in). */
internal class LitMoment { var at by mutableStateOf<Double?>(null) }

/** A small label on glass over the line (the time while scrubbing, a moment's name). */
@Composable
private fun GlassLabel(modifier: Modifier, content: @Composable () -> Unit) {
    Box(modifier.wrapContentSize(unbounded = true).graphicsLayer { translationX = -size.width / 2f }) {
        Row(Modifier.liquidGlass(RoundedCornerShape(50), GlassTone.Chip, shadow = false).padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) { content() }
    }
}
