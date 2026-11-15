package ru.musixai.app.core.designsystem.surface

import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.Animatable
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
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
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
import ru.musixai.app.core.designsystem.motion.MusixSprings
import kotlin.math.roundToInt

/**
 * r2's «перетекающее меню» (morph-menu.js) in Compose — moved from the home into the library
 * (2026-11-14 spec §5.4): the anchor — a capsule, a round button — flows into a panel of the
 * screen's width minus 32 under it, and back, on one spring (stiffness 320, damping 32). The
 * panel's surface grows out of the anchor over the first 60 % of the way and melts back into it
 * over the last 60 %, while the real anchor under the overlay fades the other way
 * ([Morph.anchorAlpha]): no frame swaps one for the other (the owner, 2026-11-14: the search
 * «резко превращается из белого в прозрачный»). The content fades in after the surface; a scrim
 * dims the rest. A tap outside, Back, or the caller closes it.
 *
 * With [glass] the panel is liquid glass of that tone (over [GlassScene]'s picture, which holds
 * only the background — the screen's text never ghosts through it), fading in with the surface.
 *
 * The anchor's rectangle is in the overlay's own coordinates. The overlay draws nothing when closed.
 */
@Stable
class Morph {
    internal val p = Animatable(0f)
    internal var open by mutableStateOf(false)

    /** How far it is open (0 = the anchor, 1 = the panel); past 1 on the spring's overshoot. */
    val progress: Float get() = p.value

    /** The real anchor under the overlay: gone while the panel covers it, back as its surface melts. */
    val anchorAlpha: Float get() = 1f - morphSurface(p.value)
}

/** How much of the panel's fill and rim shows at [t] (0 = the anchor, 1 = open): a smoothstep
 *  over the first 60 % of the way — the spring's slow tail, so the melt takes ≈ 10 frames. */
fun morphSurface(t: Float): Float {
    val x = (t / 0.6f).coerceIn(0f, 1f)
    return x * x * (3f - 2f * x)
}

@Composable
fun rememberMorph(open: Boolean, reduced: Boolean): Morph {
    val m = remember { Morph() }
    m.open = open
    LaunchedEffect(open, reduced) {
        if (reduced) m.p.snapTo(if (open) 1f else 0f)
        else m.p.animateTo(if (open) 1f else 0f, MusixSprings.menu())
    }
    return m
}

@Composable
fun MorphMenu(
    morph: Morph,
    anchor: Rect?,
    onClose: () -> Unit,
    radiusFrom: Dp,
    scrim: Float,
    radiusTo: Dp = 22.dp,
    glass: GlassTone? = null,
    content: @Composable () -> Unit,
) {
    val p = morph.p
    val open = morph.open
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
        val s = morphSurface(t)
        Box(
            Modifier.offset { IntOffset(cur.left.roundToInt(), cur.top.roundToInt()) }
                .size(with(density) { cur.width.coerceAtLeast(1f).toDp() }, with(density) { cur.height.coerceAtLeast(1f).toDp() })
                .clip(shape)
                // opaque once grown: text under a translucent panel ghosts through its controls
                .then(if (glass == null) Modifier.background((if (dark) Color(0xFF1C1A24) else Color(0xFFFFFFFF)).copy(alpha = s)) else Modifier)
                .border(1.dp, c.border.copy(alpha = c.border.alpha * s), shape)
                .pointerInput(Unit) { detectTapGestures { } },  // a tap inside is not «outside»
        ) {
            if (glass != null) Box(Modifier.matchParentSize().graphicsLayer { alpha = s }.liquidGlass(shape, glass, shadow = false))
            Box(
                Modifier.wrapContentWidth(Alignment.Start, unbounded = true).requiredWidth(panelWidth)
                    .wrapContentHeight(Alignment.Top, unbounded = true)
                    .onSizeChanged { contentH = it.height }
                    .graphicsLayer { alpha = ((t - 0.6f) / 0.4f).coerceIn(0f, 1f) },  // after the surface
            ) { content() }
        }
    }
}

private fun lerp(a: Float, b: Float, t: Float) = a + (b - a) * t
