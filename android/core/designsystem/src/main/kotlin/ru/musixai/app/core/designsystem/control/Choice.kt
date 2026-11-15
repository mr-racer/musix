package ru.musixai.app.core.designsystem.control

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onPlaced
import androidx.compose.ui.layout.positionInParent
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.core.designsystem.gesture.HapticCue
import ru.musixai.app.core.designsystem.gesture.LocalMusixHaptics
import ru.musixai.app.core.designsystem.gesture.Press
import ru.musixai.app.core.designsystem.gesture.pressable
import ru.musixai.app.core.designsystem.motion.rememberReducedMotion
import ru.musixai.app.core.designsystem.text

/** Left and right edges of each item, px, in its row. */
private class Spans { val l = mutableStateListOf<Float>(); val r = mutableStateListOf<Float>()
    fun set(i: Int, left: Float, right: Float) { while (l.size <= i) { l.add(0f); r.add(0f) }; l[i] = left; r[i] = right }
    fun ready(i: Int) = i in l.indices && r[i] > l[i]
}

/**
 * The two edges of a highlight chase their targets on different springs — the leading edge
 * quick, the trailing one lazy — so on its way the highlight stretches, then gathers itself
 * («текучая подсветка», FluidHighlight). The edges keep their velocity when the target moves on.
 */
@Composable
private fun rememberFluidEdges(target: Int, spans: Spans): Pair<Animatable<Float, *>, Animatable<Float, *>> {
    val reduced = rememberReducedMotion()
    val left = remember { Animatable(Float.NaN) }
    val right = remember { Animatable(Float.NaN) }
    LaunchedEffect(target, spans.ready(target), reduced) {
        if (!spans.ready(target)) return@LaunchedEffect
        val l = spans.l[target]; val r = spans.r[target]
        if (left.value.isNaN() || reduced) { left.snapTo(l); right.snapTo(r); return@LaunchedEffect }
        val forward = l > left.value
        val quick = spring<Float>(dampingRatio = .78f, stiffness = 900f)
        val lazy = spring<Float>(dampingRatio = .82f, stiffness = 340f)
        launch { left.animateTo(l, if (forward) lazy else quick) }
        launch { right.animateTo(r, if (forward) quick else lazy) }
    }
    return left to right
}

/**
 * «Вкладки» (the library's four, the settings' five): labels in a row, the active one in full
 * colour, a 2 dp line under it that springs between tabs — drawn, so the labels never re-render
 * as it travels. Narrow screens scroll the row; the chosen tab is brought into view. Silent:
 * a tab is navigation.
 */
@Composable
fun Tabs(items: List<String>, selected: Int, onSelect: (Int) -> Unit, modifier: Modifier = Modifier) {
    val c = MusixTheme.colors
    val spans = remember { Spans() }
    val (left, right) = rememberFluidEdges(selected, spans)
    val scroll = rememberScrollState()
    val density = LocalDensity.current
    LaunchedEffect(selected, spans.ready(selected)) {
        if (spans.ready(selected)) {
            val pad = with(density) { 24.dp.toPx() }
            val l = spans.l[selected] - pad; val r = spans.r[selected] + pad
            if (l < scroll.value) scroll.animateScrollTo(l.toInt().coerceAtLeast(0))
            else if (r > scroll.value + scroll.viewportSize) scroll.animateScrollTo((r - scroll.viewportSize).toInt())
        }
    }
    Row(
        modifier.horizontalScroll(scroll).drawBehind {
            if (left.value.isNaN()) return@drawBehind
            val h = 2.dp.toPx()
            drawRoundRect(c.text, Offset(left.value, size.height - h), Size(right.value - left.value, h), CornerRadius(h / 2))
        },
        horizontalArrangement = Arrangement.spacedBy(22.dp),
    ) {
        items.forEachIndexed { i, label ->
            val color by animateColorAsState(if (i == selected) c.text else c.textMuted, tween(200), label = "tab")
            Box(
                Modifier.height(44.dp).onPlaced { spans.set(i, it.positionInParent().x, it.positionInParent().x + it.size.width) }
                    .semantics { role = Role.Tab; this.selected = i == selected }
                    .pressable(role = Press.Tab) { onSelect(i) },
                contentAlignment = Alignment.Center,
            ) { Text(label, style = MusixTheme.text.lead.copy(fontSize = MusixTheme.text.body.fontSize, color = color)) }
        }
    }
}

/**
 * «Сегменты с текучей подсветкой» (accepted 2026-11-13, FluidHighlight): equal segments in a
 * soft groove; the raised highlight flows between them — and follows the finger dragged across,
 * a tick on each segment it lands on (the only haptic). Letting go picks where it stands.
 * [compact] — the groove hugs its labels (the player's sides), instead of filling the row.
 */
@Composable
fun <T> Segments(value: T, options: List<Pair<T, String>>, onChange: (T) -> Unit, modifier: Modifier = Modifier, compact: Boolean = false) {
    val c = MusixTheme.colors
    val dark = MusixTheme.isDark
    val haptics = LocalMusixHaptics.current
    val spans = remember { Spans() }
    val chosen = options.indexOfFirst { it.first == value }.coerceAtLeast(0)
    var hover by remember { mutableStateOf<Int?>(null) }
    val (left, right) = rememberFluidEdges(hover ?: chosen, spans)
    val pick by rememberUpdatedState(onChange)
    val current by rememberUpdatedState(options)
    val raised = if (dark) Color.White.copy(alpha = 0.16f) else Color.White
    Row(
        (if (compact) modifier else modifier.fillMaxWidth()).background(softFill(), RoundedCornerShape(999.dp)).padding(3.dp)
            .drawBehind {
                if (left.value.isNaN()) return@drawBehind
                drawRoundRect(raised, Offset(left.value, 0f), Size(right.value - left.value, size.height), CornerRadius(size.height / 2))
            }
            .pointerInput(Unit) {
                fun at(x: Float) = spans.l.indices.firstOrNull { x >= spans.l[it] && x <= spans.r[it] }
                    ?: if (x < (spans.l.firstOrNull() ?: 0f)) 0 else spans.l.lastIndex
                detectHorizontalDragGestures(
                    onDragStart = { hover = at(it.x) },
                    onDragEnd = { hover?.let { i -> current.getOrNull(i)?.let { pick(it.first) } }; hover = null },
                    onDragCancel = { hover = null },
                ) { change, _ ->
                    val i = at(change.position.x)
                    if (i != hover) { hover = i; haptics.perform(HapticCue.Tick, fromUser = true) }
                }
            },
    ) {
        options.forEachIndexed { i, (v, label) ->
            val on = i == (hover ?: chosen)
            val color by animateColorAsState(if (on) c.text else c.textMuted, tween(180), label = "seg")
            Box(
                (if (compact) Modifier.height(30.dp) else Modifier.weight(1f).height(38.dp)).onPlaced { spans.set(i, it.positionInParent().x, it.positionInParent().x + it.size.width) }
                    .semantics { role = Role.RadioButton; selected = i == chosen }
                    .pressable(role = Press.Chip) { if (v != value) { haptics.perform(HapticCue.Tick, fromUser = true); pick(v) } }
                    .then(if (compact) Modifier.padding(horizontal = 15.dp) else Modifier),
                contentAlignment = Alignment.Center,
            ) { Text(label, style = MusixTheme.text.label.copy(color = color, fontSize = if (compact) 13.sp else MusixTheme.text.label.fontSize), textAlign = TextAlign.Center, maxLines = 1) }
        }
    }
}
