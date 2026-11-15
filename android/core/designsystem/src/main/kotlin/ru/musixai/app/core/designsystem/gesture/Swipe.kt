package ru.musixai.app.core.designsystem.gesture

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.keyframes
import androidx.compose.animation.core.tween
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import ru.musixai.app.core.designsystem.MusixIcons
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.core.designsystem.motion.rememberReducedMotion
import kotlin.math.abs

/**
 * «Смахнуть, чтобы убрать» (the queue, 2026-11-14): a row follows the finger to the left 1:1 (to the right
 * it only gives, a rubber band of 60 dp); past 110 dp a bin swells at its end with a threshold tick, and
 * letting go there sends the row out to the left — [onRemove] then, and the caller offers «Вернуть». Short
 * of it, the row springs back. A row that cannot go ([enabled] false — the playing song) answers a sideways
 * pull with a «no» shake and [onReject]. A vertical move is left to the list.
 */
@Composable
fun SwipeToRemove(
    onRemove: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    onReject: () -> Unit = {},
    content: @Composable BoxScope.() -> Unit,
) {
    val haptics = LocalMusixHaptics.current
    val reduced = rememberReducedMotion()
    val scope = rememberCoroutineScope()
    val x = remember { Animatable(0f) }
    var width by remember { mutableStateOf(1f) }
    var over by remember { mutableStateOf(false) }
    val remove by rememberUpdatedState(onRemove)
    val reject by rememberUpdatedState(onReject)
    val can by rememberUpdatedState(enabled)
    val swell by animateFloatAsState(if (over) 1.25f else 1f, androidx.compose.animation.core.spring(dampingRatio = 0.5f, stiffness = 500f), label = "bin")
    Box(
        modifier.onSizeChanged { width = it.width.toFloat() }.pointerInput(Unit) {
            val limit = 110.dp.toPx()
            val rubber = 60.dp.toPx()
            awaitEachGesture {
                val down = awaitFirstDown(requireUnconsumed = false)
                var on = false
                var shook = false
                while (true) {
                    val ev = awaitPointerEvent()
                    val ch = ev.changes.firstOrNull { it.id == down.id } ?: break
                    if (!ch.pressed) break
                    val dx = ch.position.x - down.position.x
                    val dy = ch.position.y - down.position.y
                    if (!can) {
                        if (!shook && abs(dx) > 24.dp.toPx() && abs(dx) > abs(dy)) {
                            shook = true
                            haptics.perform(HapticCue.Reject, fromUser = true)
                            reject()
                            if (!reduced) scope.launch { x.animateTo(0f, keyframes { durationMillis = 360; -14.dp.toPx() at 120; 0f at 360 }) }
                        }
                        continue
                    }
                    if (!on) {
                        if (abs(dx) < 10.dp.toPx()) continue
                        if (abs(dy) > abs(dx) || ch.isConsumed) break
                        on = true
                    }
                    ch.consume()
                    val shown = if (dx < 0) dx else rubberBand(dx, rubber)
                    scope.launch { x.snapTo(shown) }
                    val now = shown < -limit
                    if (now != over) { over = now; haptics.perform(if (now) HapticCue.Threshold else HapticCue.ThresholdOff, fromUser = true) }
                }
                if (!on) return@awaitEachGesture
                if (over) {
                    over = false
                    scope.launch {
                        if (!reduced) x.animateTo(-width * 1.1f, tween(220))
                        remove()
                        x.snapTo(0f)
                    }
                } else scope.launch { x.animateTo(0f, androidx.compose.animation.core.spring(dampingRatio = 0.86f, stiffness = 520f)) }
            }
        },
    ) {
        Box(Modifier.graphicsLayer { translationX = x.value }) {
            content()
            // the bin waits just past the row's right end and comes in with it
            if (x.value < -1f) Box(Modifier.align(Alignment.CenterEnd).offset(x = 64.dp).fillMaxHeight().width(60.dp), contentAlignment = Alignment.Center) {
                Icon(MusixIcons.Trash, "Убрать", Modifier.size(20.dp).graphicsLayer { scaleX = swell; scaleY = swell }, tint = MusixTheme.colors.red)
            }
        }
    }
}
