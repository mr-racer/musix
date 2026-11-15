package ru.musixai.app.core.designsystem.content

import ru.musixai.app.core.designsystem.text
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.zIndex
import coil3.compose.AsyncImage
import kotlinx.coroutines.launch
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.core.designsystem.gesture.HapticCue
import ru.musixai.app.core.designsystem.gesture.LocalMusixHaptics
import ru.musixai.app.core.designsystem.motion.springOf
import kotlin.math.abs
import kotlin.math.roundToInt

/** One cover of a [CoverStack]. */
data class StackItem(val image: Any?, val name: String, val year: String?)

/**
 * «Стопка обложек» (CoverStack, spec §6 — «Ещё у артиста» of the album; later the player's «Далее»
 * and the library): a fan of covers. The finger lifts the one under it (Tick on each new one), the
 * neighbours make way and its name shows above it; letting go picks it — [onPick] gets its index
 * and where it stands (root px), so the page can fly it out of there. Each card on its own spring.
 */
@Composable
fun CoverStack(items: List<StackItem>, onPick: (Int, Rect) -> Unit, modifier: Modifier = Modifier, size: Dp = 92.dp) {
    if (items.isEmpty()) return
    val c = MusixTheme.colors
    val n = items.size
    val haptics = LocalMusixHaptics.current
    val scope = rememberCoroutineScope()
    val lift = remember(n) { List(n) { Animatable(0f) } }
    var held by remember { mutableIntStateOf(-1) }
    val origin = remember { Ref(Offset.Zero) }
    val pick by rememberUpdatedState(onPick)
    val spec = remember { springOf<Float>(0.3f, 0.86f) }
    BoxWithConstraints(modifier.fillMaxWidth().height(size + 34.dp).onGloballyPositioned { origin.value = it.positionInRoot() }) {
        val density = LocalDensity.current
        val w = constraints.maxWidth.toFloat()
        val sz = with(density) { size.toPx() }
        val step = if (n > 1) minOf(sz * 0.72f, (w - sz) / (n - 1)) else 0f
        fun at(x: Float) = if (step <= 0f) 0 else (x / step).toInt().coerceIn(0, n - 1)
        fun hold(i: Int) {
            if (i == held) return
            held = i
            haptics.perform(HapticCue.Tick, fromUser = true)
            lift.forEachIndexed { j, a -> scope.launch { a.animateTo(if (j == i) 1f else 0f, spec) } }
        }
        fun letGo() { held = -1; lift.forEach { a -> scope.launch { a.animateTo(0f, spec) } } }
        Box(
            Modifier.fillMaxWidth().height(size + 34.dp)
                .semantics { contentDescription = "Стопка обложек: ${items.joinToString { it.name }}" }
                .pointerInput(n, step) {
                    awaitEachGesture {
                        // nothing is taken until the finger goes sideways: a page scrolled with the finger
                        // on the stack used to pick the cover it was let go on (a swipe swapped the album)
                        val down = awaitFirstDown(requireUnconsumed = false)
                        hold(at(down.position.x))
                        val slop = viewConfiguration.touchSlop
                        var up = false
                        var mine = false
                        while (true) {
                            val e = awaitPointerEvent(PointerEventPass.Main)
                            val ch = e.changes.firstOrNull { it.id == down.id } ?: break
                            if (!ch.pressed) { up = true; break }
                            if (!mine) {
                                val d = ch.position - down.position
                                if (abs(d.y) > slop && abs(d.y) > abs(d.x)) break   // the page's scroll
                                if (abs(d.x) > slop) mine = true
                            }
                            if (mine) ch.consume()
                            hold(at(ch.position.x))
                        }
                        val i = held
                        letGo()
                        if (up && i >= 0) {
                            val x = origin.value.x + i * step
                            val y = origin.value.y + with(density) { 34.dp.toPx() }
                            pick(i, Rect(x, y, x + sz, y + sz))
                        }
                    }
                },
        ) {
            val hi = held
            if (hi >= 0) {
                val it = items[hi]
                Text(
                    buildAnnotatedString {
                        append(it.name)
                        if (it.year != null) withStyle(SpanStyle(fontSize = 12.sp, fontWeight = FontWeight.Normal, color = c.textSubtle)) { append("  " + it.year) }
                    },
                    Modifier.offset { IntOffset(((hi * step + sz / 2) - w * 0.35f).coerceIn(0f, w * 0.3f).roundToInt(), 0) },
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                    style = MusixTheme.text.label.copy(fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.text),
                )
            }
            for (i in 0 until n) {
                val item = items[i]
                Box(
                    Modifier.zIndex(if (hi == i) 50f else i.toFloat())
                        .offset { IntOffset((i * step).roundToInt(), with(density) { 34.dp.roundToPx() }) }
                        .size(size)
                        .semantics { role = Role.Button; contentDescription = item.name + (item.year?.let { ", $it" } ?: ""); onClick { pick(i, Rect.Zero); true } }
                        .graphicsLayer {
                            val v = lift[i].value
                            val h = held
                            val spread = if (h < 0) 0f else (if (i < h) -1f else if (i > h) 1f else 0f) * minOf(14.dp.toPx(), step * 0.4f) * lift.maxOf { it.value }
                            val tilt = (i - (n - 1) / 2f) * (if (h < 0) 1.2f else 0.6f)
                            transformOrigin = TransformOrigin(0.5f, 1f)
                            translationX = spread
                            translationY = -16.dp.toPx() * v
                            rotationZ = tilt * (1f - v)
                            val s = 1f + 0.08f * v
                            scaleX = s; scaleY = s
                        }
                        .shadow(8.dp, RoundedCornerShape(8.dp))
                        .clip(RoundedCornerShape(8.dp))
                        .background(c.plate),
                ) {
                    AsyncImage(item.image, null, Modifier.size(size), contentScale = ContentScale.Crop)
                }
            }
        }
    }
}

private class Ref<T>(var value: T)
