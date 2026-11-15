package ru.musixai.app.feature.player

import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import kotlinx.coroutines.launch

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.EnterExitState
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil3.compose.AsyncImage
import kotlinx.coroutines.delay
import ru.musixai.app.core.designsystem.gesture.HapticCue
import ru.musixai.app.core.designsystem.gesture.LocalMusixHaptics
import ru.musixai.app.core.designsystem.MusixIcons
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.core.designsystem.motion.LocalCoverFlight
import ru.musixai.app.core.designsystem.control.PlayPauseGlyph
import ru.musixai.app.core.designsystem.motion.coverFlightTarget
import ru.musixai.app.core.designsystem.gesture.pressable
import ru.musixai.app.core.designsystem.motion.rememberReducedMotion
import ru.musixai.app.core.player.PlayerState

/**
 * The mini-player in the accepted phone look (design/proposals/android-2026-11-13, `.mini`;
 * the owner, 2026-11-14: the v1 strip «не в нашем дизайне»): open on the page, no strip of
 * its own, 66 dp — a 2 dp progress line across the top, the cover 42, the title and the
 * artist, ▶ ↔ ❚❚ as one shape and «дальше». A tap opens the full player.
 */
@Composable
fun MiniPlayer(onOpen: () -> Unit, vm: PlayerViewModel = hiltViewModel()) {
    val ui by vm.ui.collectAsStateWithLifecycle()
    val pos = vm.position.collectAsStateWithLifecycle()   // read only in the progress line's draw
    MiniPlayerSlot(ui.player, onOpen, vm::toggle, vm::next, position = { pos.value })
}

internal const val MiniCoverTag = "mini-cover"

// The bar's geometry: the layout below is built from it, and so is the dock guess.
private val PadH = 16.dp
private val BarH = 66.dp
private val CoverSize = 42.dp
private val CoverShape = RoundedCornerShape(8.dp)  // where a flying cover's corners end up (CoverFlight)

// web v2's MiniPlayer.tsx: the bar rises on (.2,.9,.25,1.04) over 620 ms, the cover pops in on
// (.34,1.56,.64,1) over 560 ms, 160 ms after it
private val Rise = CubicBezierEasing(0.2f, 0.9f, 0.25f, 1.04f)
private val Pop = CubicBezierEasing(0.34f, 1.56f, 0.64f, 1f)
private const val RISE_MS = 620
private const val POP_MS = 560
private const val POP_DELAY_MS = 160L

/** Where the bar's cover will stand once the bar is shown above [top] (root px): the shell's
 *  dock for a cover flight on a cold start, before anything has played. */
fun miniPlayerCoverAbove(top: Float, density: Density): Rect = with(density) {
    val y = top - BarH.toPx() + ((BarH - CoverSize) / 2).toPx()
    Rect(Offset(PadH.toPx(), y), Size(CoverSize.toPx(), CoverSize.toPx()))
}

/**
 * The bar's place in the shell. A song from silence makes it rise from under the screen
 * while the page above eases up to make room — its height grows, nothing jumps — then its
 * cover pops in; a cover flying in from the page skips the pop: its arrival is the entrance.
 * The last song stays on the bar while it leaves.
 */
@Composable
internal fun MiniPlayerSlot(p: PlayerState, onOpen: () -> Unit, onToggle: () -> Unit, onNext: () -> Unit, reduced: Boolean = rememberReducedMotion(), position: () -> Long = { p.positionMs }) {
    val shown = p.trackId != null
    val lastShown = remember { mutableStateOf(p) }
    SideEffect { if (shown) lastShown.value = p }
    val bar = if (shown) p else lastShown.value
    val flight = LocalCoverFlight.current
    val mounted = remember { booleanArrayOf(false) }  // the bar already there at launch does not pop
    SideEffect { mounted[0] = true }
    val pop = remember(shown) { Animatable(if (shown && mounted[0] && !reduced && flight?.inbound != true) 0f else 1f) }
    LaunchedEffect(pop) {
        if (pop.value < 1f) {
            delay(POP_DELAY_MS)
            pop.animateTo(1f, tween(POP_MS, easing = Pop))
        }
    }
    AnimatedVisibility(
        shown,
        enter = if (reduced) fadeIn(tween(120)) else
            expandVertically(tween(RISE_MS, easing = Rise), Alignment.Top) + slideInVertically(tween(RISE_MS, easing = Rise)) { it } + fadeIn(tween(300)),
        exit = if (reduced) fadeOut(tween(120)) else
            shrinkVertically(tween(320), Alignment.Top) + slideOutVertically(tween(320)) { it } + fadeOut(tween(200)),
    ) {
        // a cover flying in heads for where the bar's cover will rest — the shell's dock — and
        // meets the bar there; while the bar rises its cover is still below that, so it is no aim
        val settled = transition.currentState == EnterExitState.Visible && transition.targetState == EnterExitState.Visible
        MiniPlayerBar(bar, onOpen, onToggle, onNext, pop = { pop.value }, aim = settled, position = position)
    }
}

@Composable
internal fun MiniPlayerBar(p: PlayerState, onOpen: () -> Unit, onToggle: () -> Unit, onNext: () -> Unit, pop: () -> Float = { 1f }, aim: Boolean = true, position: () -> Long = { p.positionMs }) {
    val c = MusixTheme.colors
    val haptics = LocalMusixHaptics.current
    val glyph by animateFloatAsState(if (p.isPlaying) 1f else 0f, spring(dampingRatio = 0.8f, stiffness = 520f), label = "glyph")
    val fold = LocalPlayerFold.current
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    // a tap opens the player; a pull up opens it after the finger (the cover flies up out of the bar)
    val pull = if (fold == null) Modifier else Modifier.pointerInput(fold) {
        awaitEachGesture {
            val down = awaitFirstDown(requireUnconsumed = false)
            val tracker = androidx.compose.ui.input.pointer.util.VelocityTracker()
            var on = false
            var y0 = 0f
            var cancelled = true
            while (true) {
                val ev = awaitPointerEvent()
                val ch = ev.changes.firstOrNull { it.id == down.id } ?: break
                tracker.addPosition(ch.uptimeMillis, ch.position)
                if (!ch.pressed) { cancelled = false; break }
                val dy = ch.position.y - down.position.y
                if (!on) { if (kotlin.math.abs(dy) < 10.dp.toPx()) continue; on = true; y0 = dy; fold.grab() }
                ch.consume()
                scope.launch { if (fold.drag(dy - y0)) haptics.perform(if (fold.past) HapticCue.Threshold else HapticCue.ThresholdOff, fromUser = true) }
            }
            if (on) { val v = tracker.calculateVelocity().y; scope.launch { fold.release(v, cancelled) } }
        }
    }
    Box(Modifier.fillMaxWidth().height(BarH).then(pull).pressable(onClick = onOpen).padding(horizontal = PadH)) {
        // the progress line across the top: the whole song faint, the played part in the accent
        // the position is read in the draw: its ticks redraw a 2 dp line, the bar does not recompose
        val accent = c.accent
        val dur = p.durationMs
        Box(Modifier.fillMaxWidth().height(2.dp).clip(RoundedCornerShape(1.dp)).background(c.text.copy(alpha = 0.09f)).testTag("mini-progress")
            .drawBehind {
                val frac = if (dur > 0) (position().toFloat() / dur).coerceIn(0f, 1f) else 0f
                drawRect(accent, size = size.copy(width = size.width * frac))
            })
        Row(Modifier.fillMaxSize(), verticalAlignment = Alignment.CenterVertically) {
            // covers that start playing land here (CoverFlight)
            AsyncImage(
                p.artUri, null,
                Modifier.graphicsLayer {
                    val k = pop()
                    scaleX = 0.6f + 0.4f * k
                    scaleY = 0.6f + 0.4f * k
                    rotationZ = -6f * (1f - k)
                    // while the player folds, the bar's picture takes over only in the last steps
                    val e = fold?.p?.value?.coerceIn(0f, 1f) ?: 1f
                    alpha = k.coerceIn(0f, 1f) * ((e - 0.84f) / 0.12f).coerceIn(0f, 1f)
                }.onGloballyPositioned { if (fold != null) fold.mini = it.boundsInRoot() }.size(CoverSize).coverFlightTarget(if (aim) LocalCoverFlight.current else null).testTag(MiniCoverTag)
                    .shadow(6.dp, CoverShape).clip(CoverShape).background(c.surface2),
            )
            Column(Modifier.weight(1f).padding(horizontal = 12.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(p.title, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MusixTheme.type.body.copy(fontSize = 15.sp, fontWeight = FontWeight.Medium, color = c.text))
                Text(p.artist, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MusixTheme.type.body.copy(fontSize = 13.sp, color = c.textMuted))
            }
            Box(
                Modifier.size(48.dp).pressable {
                    haptics.perform(if (p.isPlaying) HapticCue.ToggleOff else HapticCue.ToggleOn, fromUser = true)
                    onToggle()
                }.semantics { contentDescription = if (p.isPlaying) "Пауза" else "Воспроизвести" },
                contentAlignment = Alignment.Center,
            ) { PlayPauseGlyph(glyph, Modifier.size(20.dp), c.text) }
            Icon(MusixIcons.Next, "Дальше", Modifier.size(48.dp).pressable(onClick = onNext).padding(13.dp), tint = c.text)
        }
    }
}
