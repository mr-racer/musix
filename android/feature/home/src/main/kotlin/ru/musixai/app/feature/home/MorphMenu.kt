package ru.musixai.app.feature.home

import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.requiredWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import ru.musixai.app.core.designsystem.MusixTheme
import kotlin.math.roundToInt

/**
 * r2's «перетекающее меню» (morph-menu.js) in Compose: the anchor — a capsule, a round
 * button — flows into a panel of the screen's width minus 32 under it, and back, on one
 * spring (stiffness 320, damping 32). The anchor's face fades out as the panel's content
 * fades in; a scrim dims the rest. A tap outside, Back, or the caller closes it.
 *
 * [anchor] is in this overlay's own coordinates. The overlay draws nothing when closed.
 */
@Composable
internal fun MorphMenu(
    open: Boolean,
    anchor: Rect?,
    onClose: () -> Unit,
    radiusFrom: Dp,
    scrim: Float,
    reduced: Boolean,
    radiusTo: Dp = 22.dp,
    face: @Composable () -> Unit = {},
    content: @Composable () -> Unit,
) {
    val p = remember { Animatable(0f) }
    LaunchedEffect(open, reduced) {
        if (reduced) p.snapTo(if (open) 1f else 0f)
        else p.animateTo(if (open) 1f else 0f, spring(dampingRatio = 32f / (2f * kotlin.math.sqrt(320f)), stiffness = 320f))
    }
    BackHandler(enabled = open, onBack = onClose)
    if (anchor == null || (!open && p.value == 0f)) return
    val c = MusixTheme.colors
    val dark = MusixTheme.isDark
    val density = LocalDensity.current
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val w = constraints.maxWidth.toFloat()
        val h = constraints.maxHeight.toFloat()
        val margin = with(density) { 16.dp.toPx() }
        var contentH by remember { mutableIntStateOf(0) }
        val t = p.value
        Box(Modifier.fillMaxSize().drawBehind { drawRect(Color.Black.copy(alpha = scrim * t.coerceIn(0f, 1f))) }
            .pointerInput(Unit) { detectTapGestures { onClose() } })
        // the panel under the anchor, lifted when it would run off the bottom
        val top = minOf(anchor.top, h - contentH - margin).coerceAtLeast(margin / 2)
        val target = Rect(margin, top, w - margin, top + contentH)
        val cur = Rect(
            lerp(anchor.left, target.left, t), lerp(anchor.top, target.top, t),
            lerp(anchor.right, target.right, t), lerp(anchor.bottom, target.bottom, t),
        )
        val shape = RoundedCornerShape(lerp(radiusFrom.value, radiusTo.value, t.coerceIn(0f, 1f)).dp)
        val panelWidth = with(density) { target.width.toDp() }
        Box(
            Modifier.offset { IntOffset(cur.left.roundToInt(), cur.top.roundToInt()) }
                .size(with(density) { cur.width.coerceAtLeast(1f).toDp() }, with(density) { cur.height.coerceAtLeast(1f).toDp() })
                .clip(shape)
                .background(if (dark) Color(0xFF1C1A24) else Color(0xFFFFFFFF))  // opaque: text under a translucent panel ghosts through its controls
                .border(1.dp, c.border, shape)
                .pointerInput(Unit) { detectTapGestures { } },  // a tap inside is not «outside»
        ) {
            Box(
                Modifier.wrapContentWidth(Alignment.Start, unbounded = true).requiredWidth(panelWidth)
                    .wrapContentHeight(Alignment.Top, unbounded = true)
                    .onSizeChanged { contentH = it.height }
                    .graphicsLayer { alpha = ((t - 0.35f) / 0.65f).coerceIn(0f, 1f) },
            ) { content() }
            Box(Modifier.size(with(density) { anchor.width.toDp() }, with(density) { anchor.height.toDp() })
                .graphicsLayer { alpha = (1f - t * 3f).coerceIn(0f, 1f) }) { face() }
        }
    }
}

private fun lerp(a: Float, b: Float, t: Float) = a + (b - a) * t
