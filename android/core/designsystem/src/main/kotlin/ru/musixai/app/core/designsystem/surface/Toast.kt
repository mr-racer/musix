package ru.musixai.app.core.designsystem.surface

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.core.designsystem.float
import ru.musixai.app.core.designsystem.gesture.Press
import ru.musixai.app.core.designsystem.gesture.pressable
import ru.musixai.app.core.designsystem.motion.Leave
import ru.musixai.app.core.designsystem.motion.rememberReducedMotion
import ru.musixai.app.core.designsystem.text
import kotlin.math.abs

const val ToastTag = "musix-toast"

internal class ToastItem(val id: Long, val text: String, val action: String?, val onAction: (() -> Unit)?) {
    var leaving by mutableStateOf(false)
}

/** The stack of toasts (`ToastHost`): `LocalToasts.current?.show("Удалено", "Отменить") { … }`. */
@Stable
class Toasts internal constructor() {
    internal val items = mutableStateListOf<ToastItem>()
    private var next = 0L

    /** At most three stand at once: a fourth sends the oldest away. */
    fun show(text: String, action: String? = null, onAction: (() -> Unit)? = null) {
        items.add(ToastItem(next++, text, action, onAction))
        val live = items.filter { !it.leaving }
        if (live.size > 3) live.first().leaving = true
    }
}

val LocalToasts = staticCompositionLocalOf<Toasts?> { null }

@Composable
fun rememberToasts(): Toasts = remember { Toasts() }

/**
 * The stack of toasts («стопка тостов», 2026-11-14 spec §6, №26): float pills at the bottom
 * centre, the newest in front, older ones tucked behind it — smaller, higher, dimmer. Each comes
 * in 220 ms, stays 4 s (held while the finger is on it), leaves on a short ease-in, and can be
 * swiped away sideways. An action («Отменить») closes it. No haptics: toasts are not gestures.
 */
@Composable
fun ToastHost(toasts: Toasts, modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp), contentAlignment = Alignment.BottomCenter) {
        val live = toasts.items.filter { !it.leaving }
        for (item in toasts.items) key(item.id) {
            val depth = if (item.leaving) 0 else live.size - 1 - live.indexOf(item)
            ToastView(item, depth, onGone = { toasts.items.remove(item) })
        }
    }
}

@Composable
private fun ToastView(item: ToastItem, depth: Int, onGone: () -> Unit) {
    val reduced = rememberReducedMotion()
    val come = remember { Animatable(0f) }
    val dx = remember { Animatable(0f) }
    var held by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(item.leaving) {
        if (!item.leaving) { if (reduced) come.snapTo(1f) else come.animateTo(1f, spring(dampingRatio = .8f, stiffness = 420f)) }
        else { come.animateTo(0f, tween(if (reduced) 120 else 160, easing = Leave)); onGone() }
    }
    LaunchedEffect(held, item.leaving) { if (!held && !item.leaving) { delay(4_000); item.leaving = true } }
    val lift by animateFloatAsState(depth.toFloat(), spring(dampingRatio = .85f, stiffness = 380f), label = "depth")
    val c = MusixTheme.colors
    Row(
        Modifier.widthIn(max = 420.dp).heightIn(min = 48.dp).testTag(ToastTag)
            .graphicsLayer {
                val k = come.value
                translationY = (1f - k) * 16.dp.toPx() - lift * 9.dp.toPx()
                translationX = dx.value
                val s = (1f - lift * 0.05f) * (0.96f + 0.04f * k)
                scaleX = s; scaleY = s
                alpha = (k * (1f - lift * 0.3f) * (1f - abs(dx.value) / (size.width.coerceAtLeast(1f)))).coerceIn(0f, 1f)
            }
            .float(RoundedCornerShape(24.dp))
            .pointerInput(item) {
                val tracker = VelocityTracker()
                var path = 0f  // the finger's own path: the toast moves under it
                detectHorizontalDragGestures(
                    onDragStart = { held = true; path = dx.value; tracker.resetTracking() },
                    onDragEnd = {
                        held = false
                        val v = tracker.calculateVelocity().x
                        if (abs(dx.value) > size.width * 0.35f || abs(v) > 1_000.dp.toPx()) scope.launch {
                            dx.animateTo(if ((dx.value + v * 0.1f) > 0) size.width.toFloat() else -size.width.toFloat(), tween(180, easing = Leave))
                            onGone()
                        } else scope.launch { dx.animateTo(0f, spring(dampingRatio = .7f, stiffness = 420f), initialVelocity = v) }
                    },
                    onDragCancel = { held = false; scope.launch { dx.animateTo(0f) } },
                ) { change, d ->
                    path += d
                    tracker.addPosition(change.uptimeMillis, Offset(path, 0f))
                    scope.launch { dx.snapTo(path) }
                }
            }
            .padding(start = 18.dp, end = if (item.action != null) 6.dp else 18.dp, top = 6.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(item.text, Modifier.weight(1f, fill = false), style = MusixTheme.text.body.copy(color = c.text), maxLines = 2, overflow = TextOverflow.Ellipsis)
        if (item.action != null) Text(
            item.action,
            Modifier.pressable(role = Press.Chip) { item.onAction?.invoke(); item.leaving = true }.padding(horizontal = 12.dp, vertical = 10.dp),
            style = MusixTheme.text.label.copy(color = c.accentLight),
        )
    }
}
