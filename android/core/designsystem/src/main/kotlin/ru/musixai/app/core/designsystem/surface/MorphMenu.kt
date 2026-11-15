package ru.musixai.app.core.designsystem.surface

import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.spring
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.SideEffect
import androidx.compose.foundation.layout.wrapContentSize
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.lerp as mixColor
import androidx.compose.ui.layout.layout
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Outline
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.LayoutDirection
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
 * **The block itself** ([MorphFrom], the owner, 2026-11-15: «не сам блок расширяется, а новый блок
 * заменяет старый… нужно, чтобы старый блок маленький переезжал в большой со всеми его границами»):
 * the anchor's own surface — its glass or fill and its rim — is what grows, edge and all, from the
 * first frame; the anchor is gone at once (nothing under it fades), its contents ride in the window's
 * corner as they were and go in the first third, the panel's come in after them. Only the surface's
 * material turns from the anchor's to the panel's.
 *
 * The anchor's rectangle is in the overlay's own coordinates. The overlay draws nothing when closed.
 */
@Stable
class Morph {
    internal val p = Animatable(0f)
    internal var open by mutableStateOf(false)
    internal var whole by mutableStateOf(false)

    /** How far it is open (0 = the anchor, 1 = the panel); past 1 on the spring's overshoot. */
    val progress: Float get() = p.value

    /** The real anchor under the overlay: gone while the panel covers it, back as its surface melts.
     *  When the anchor itself grows ([MorphFrom]) it is simply away while the overlay stands. */
    val anchorAlpha: Float get() = if (whole) (if (open || p.value > 0f) 0f else 1f) else 1f - morphSurface(p.value)
}

/**
 * The anchor a [MorphMenu] grows out of as itself: its [face] (its contents, laid out at the anchor's
 * width, without its surface) and its surface — [glass] (with its [shadow]) or a [fill] — and [rim].
 * At the first frame the morph must look exactly like the anchor: give what the anchor draws.
 */
@Immutable
class MorphFrom(
    val glass: GlassTone? = null,
    val shadow: Boolean = false,
    val fill: Color = Color.Transparent,
    val rim: Color = Color.Transparent,
    val face: @Composable () -> Unit,
)

private fun smooth(x: Float): Float { val k = x.coerceIn(0f, 1f); return k * k * (3f - 2f * k) }

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
        // back into the anchor without the opening's overshoot: it settles where it lies, it never bounces in it
        else m.p.animateTo(if (open) 1f else 0f, if (open) MusixSprings.menu() else CloseSpec)
    }
    return m
}

/** The way back: critically damped, a touch slower than the opening (≈ 0.45 s). */
private val CloseSpec = spring<Float>(dampingRatio = 1f, stiffness = 230f)

/**
 * The panel itself. It is laid out once, where it opens; what grows out of the anchor is its window
 * (a clip in the draw phase): no layout and no composition per frame, so the way back into the
 * anchor is as smooth as the way out (the artist's «Путь фаната», 2026-11-15: «немножко рвано»).
 * [tilt] (degrees) lays the panel back into the page near the anchor — it stands up as it opens
 * and lies down as it goes back, turning on the anchor's line.
 */
@Composable
fun MorphMenu(
    morph: Morph,
    anchor: Rect?,
    onClose: () -> Unit,
    radiusFrom: Dp,
    scrim: Float,
    radiusTo: Dp = 22.dp,
    glass: GlassTone? = null,
    tilt: Float = 0f,
    from: MorphFrom? = null,
    content: @Composable () -> Unit,
) {
    val p = morph.p
    val open = morph.open
    val whole = from != null
    SideEffect { morph.whole = whole }
    BackHandler(enabled = open, onBack = onClose)
    val closed by remember(morph) { derivedStateOf { p.value == 0f } }
    if (anchor == null || (!open && closed)) return
    val c = MusixTheme.colors
    val dark = MusixTheme.isDark
    val density = LocalDensity.current
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val w = constraints.maxWidth.toFloat()
        val h = constraints.maxHeight.toFloat()
        val margin = with(density) { 16.dp.toPx() }
        var contentH by remember { mutableIntStateOf(0) }
        Box(Modifier.fillMaxSize().drawBehind { drawRect(Color.Black.copy(alpha = scrim * p.value.coerceIn(0f, 1f))) }
            .pointerInput(Unit) { detectTapGestures { onClose() } })
        // the panel under the anchor, lifted when it would run off the bottom
        val top = minOf(anchor.top, h - contentH - margin).coerceAtLeast(margin / 2)
        val target = Rect(margin, top, w - margin, top + contentH)
        val panelWidth = with(density) { target.width.toDp() }
        val fill = if (dark) Color(0xFF1C1A24) else Color(0xFFFFFFFF)
        val rim = c.border
        val window = { t: Float ->
            Rect(
                lerp(anchor.left, target.left, t) - target.left, lerp(anchor.top, target.top, t) - target.top,
                lerp(anchor.right, target.right, t) - target.left, lerp(anchor.bottom, target.bottom, t) - target.top,
            )
        }
        val radius = { t: Float -> with(density) { lerp(radiusFrom.toPx(), radiusTo.toPx(), t.coerceIn(0f, 1f)) } }
        if (from != null) {
            val onScreen = { t: Float -> window(t).translate(target.topLeft) }
            val anchorWidth = with(density) { anchor.width.toDp() }
            Box(Modifier.fillMaxSize().graphicsLayer {
                if (tilt != 0f && h > 0f) {
                    // flat at both ends — at the start it is the anchor as it lies — and laid back on the way
                    val t = p.value.coerceIn(0f, 1f)
                    transformOrigin = TransformOrigin(0.5f, (anchor.center.y / h).coerceIn(0f, 1f))
                    rotationX = tilt * 4f * t * (1f - t)
                    cameraDistance = 1400f * density.density / 72f
                }
            }) {
                // the surface: laid out at the window every frame — a leaf, nothing inside to lay out — so its
                // glass, lens and rim run along the edge as it grows
                Box(
                    Modifier.layout { m, _ ->
                        val r = onScreen(p.value)
                        val pl = m.measure(Constraints.fixed(r.width.roundToInt().coerceAtLeast(1), r.height.roundToInt().coerceAtLeast(1)))
                        layout(pl.width, pl.height) { pl.place(r.left.roundToInt(), r.top.roundToInt()) }
                    }.drawBehind {
                        val f = mixColor(from.fill, if (glass == null) fill else Color.Transparent, morphSurface(p.value))
                        if (f.alpha > 0f) drawRoundRect(f, cornerRadius = CornerRadius(radius(p.value)))
                    }.drawWithContent {
                        drawContent()
                        val e = rim.let { mixColor(from.rim, it, morphSurface(p.value)) }
                        val sw = 1.dp.toPx()
                        if (e.alpha > 0f) drawRoundRect(e, Offset(sw / 2, sw / 2), Size(size.width - sw, size.height - sw), CornerRadius(radius(p.value)), style = Stroke(sw))
                    },
                ) {
                    val fromGlass = from.glass
                    if (fromGlass != null) Box(Modifier.matchParentSize().graphicsLayer {
                        alpha = if (fromGlass == glass) 1f else 1f - morphSurface(p.value)
                    }.liquidGlass({ RoundedCornerShape(radius(p.value)) }, fromGlass, shadow = from.shadow))
                    if (glass != null && glass != fromGlass) Box(Modifier.matchParentSize().graphicsLayer { alpha = morphSurface(p.value) }
                        .liquidGlass({ RoundedCornerShape(radius(p.value)) }, glass, shadow = false))
                }
                // what is inside, seen through the same window: the panel laid out once where it opens, the
                // anchor's own contents riding in the window's corner as they were
                Box(Modifier.fillMaxSize().graphicsLayer { shape = WindowShape(onScreen(p.value), radius(p.value)); clip = true }) {
                    Box(
                        Modifier.offset { IntOffset(target.left.roundToInt(), target.top.roundToInt()) }
                            .wrapContentWidth(Alignment.Start, unbounded = true).requiredWidth(panelWidth)
                            .wrapContentHeight(Alignment.Top, unbounded = true)
                            .onSizeChanged { contentH = it.height }
                            .graphicsLayer { alpha = smooth((p.value - 0.22f) / 0.44f) }  // overlapping the face's way out: never an empty box
                            .pointerInput(Unit) { detectTapGestures { } },  // a tap inside is not «outside»
                    ) { content() }
                    Box(
                        Modifier.offset { val r = onScreen(p.value); IntOffset(r.left.roundToInt(), r.top.roundToInt()) }
                            .wrapContentSize(Alignment.TopStart, unbounded = true).requiredWidth(anchorWidth)
                            .graphicsLayer { alpha = 1f - smooth(p.value / 0.3f) },
                    ) { from.face() }
                }
            }
            return@BoxWithConstraints
        }
        Box(
            Modifier.offset { IntOffset(target.left.roundToInt(), target.top.roundToInt()) }
                .size(panelWidth, with(density) { contentH.toDp() })
                .graphicsLayer {
                    val t = p.value
                    val win = window(t)
                    shape = WindowShape(win, radius(t))
                    clip = true
                    if (tilt != 0f && size.height > 0f) {
                        val k = 1f - morphSurface(t.coerceIn(0f, 1f))
                        transformOrigin = TransformOrigin(0.5f, ((anchor.center.y - target.top) / size.height).coerceIn(0f, 1f))
                        rotationX = tilt * k
                        cameraDistance = 1400f * density.density / 72f
                    }
                }
                // opaque once grown: text under a translucent panel ghosts through its controls
                .then(if (glass == null) Modifier.drawBehind { drawRect(fill.copy(alpha = morphSurface(p.value))) } else Modifier)
                .drawWithContent {
                    drawContent()
                    val t = p.value
                    val r = radius(t)
                    val win = window(t)
                    drawRoundRect(rim.copy(alpha = rim.alpha * morphSurface(t)), win.topLeft, win.size, CornerRadius(r), style = Stroke(1.dp.toPx()))
                }
                .pointerInput(Unit) { detectTapGestures { } },  // a tap inside is not «outside»
        ) {
            if (glass != null) Box(Modifier.matchParentSize().graphicsLayer { alpha = morphSurface(p.value) }
                .liquidGlass(RoundedCornerShape(radiusTo), glass, shadow = false))
            Box(
                Modifier.wrapContentWidth(Alignment.Start, unbounded = true).requiredWidth(panelWidth)
                    .wrapContentHeight(Alignment.Top, unbounded = true)
                    .onSizeChanged { contentH = it.height }
                    .graphicsLayer { alpha = ((p.value - 0.5f) / 0.5f).coerceIn(0f, 1f) },  // after the surface, before it melts
            ) { content() }
        }
    }
}

/** A rounded window at [r] inside the panel's own box. */
private class WindowShape(private val r: Rect, private val radius: Float) : Shape {
    override fun createOutline(size: Size, layoutDirection: LayoutDirection, density: Density): Outline =
        Outline.Rounded(RoundRect(r, CornerRadius(radius)))
}

private fun lerp(a: Float, b: Float, t: Float) = a + (b - a) * t
