package ru.musixai.app.core.designsystem.surface

import android.os.Build
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.kyant.backdrop.backdrops.LayerBackdrop
import com.kyant.backdrop.backdrops.layerBackdrop
import com.kyant.backdrop.backdrops.rememberLayerBackdrop
import com.kyant.backdrop.drawBackdrop
import com.kyant.backdrop.effects.blur
import com.kyant.backdrop.effects.lens
import com.kyant.backdrop.effects.vibrancy
import com.kyant.backdrop.highlight.Highlight
import com.kyant.backdrop.shadow.Shadow
import ru.musixai.app.core.designsystem.MusixTheme

/**
 * How much of the world a piece of glass lets through (the owner, 2026-11-15: Kyant0's
 * AndroidLiquidGlass — «похоже на Apple», instead of Haze's optics).
 *
 * - [Chip] — buttons and capsules (`.lg` of the web): a thin blur and a strong lens at the rim.
 * - [Clear] — a sheet one looks through, the queue: the library seen almost as it is.
 * - [Deep] — a sheet one reads from (about the song, the assistant): more blur and a darker body.
 */
enum class GlassTone(internal val blur: Dp, internal val lensHeight: Dp, internal val lensAmount: Dp, internal val dark: Color, internal val light: Color) {
    Chip(4.dp, 16.dp, 32.dp, Color(0x5C181820), Color(0x99FFFFFF)),
    Clear(6.dp, 24.dp, 48.dp, Color(0x42181820), Color(0x80F4F3FA)),
    Deep(18.dp, 24.dp, 48.dp, Color(0x80141420), Color(0xBFF4F3FA)),
}

/** The picture glass is made of: what is drawn under it, recorded into one layer. */
internal val LocalGlassSource = staticCompositionLocalOf<LayerBackdrop?> { null }

/** Records [background] for the glass inside [content] (its siblings above, never its own foreground). */
@Composable
fun GlassScene(
    modifier: Modifier = Modifier,
    background: @Composable BoxScope.() -> Unit = {
        Box(Modifier.matchParentSize().background(MusixTheme.colors.bg))
    },
    content: @Composable BoxScope.() -> Unit,
) {
    val source = rememberLayerBackdrop()
    Box(modifier) {
        // glass drawn inside the recorded picture would read itself: the background gets none
        CompositionLocalProvider(LocalGlassSource provides null) {
            Box(Modifier.matchParentSize().layerBackdrop(source), content = background)
        }
        CompositionLocalProvider(LocalGlassSource provides source) { content() }
    }
}

/** The shell's own source: everything on screen, for the glass of sheets drawn over it. */
@Composable
internal fun rememberGlassSource(): LayerBackdrop = rememberLayerBackdrop()

internal fun Modifier.glassSource(source: LayerBackdrop): Modifier = layerBackdrop(source)

/**
 * Liquid glass of the given [tone] in [shape]. Without a [source] (outside a [GlassScene], or
 * inside the picture it would read) it is the same surface without the world behind it; under
 * Android 12 there is no blur, under 13 no lens — the body then carries the separation.
 */
fun Modifier.liquidGlass(
    shape: Shape,
    tone: GlassTone = GlassTone.Chip,
    shadow: Boolean = true,
    source: LayerBackdrop? = null,
    onArt: Boolean = false,
): Modifier = composed {
    // glass laid over artwork stays dark in both themes (the web's `.lg.on-art`)
    val dark = MusixTheme.isDark || onArt
    val from = source ?: LocalGlassSource.current
    val reach = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
    // without the blur behind it the body has to hide what it would have softened
    val body = (if (dark) tone.dark else tone.light).let { if (from == null || !reach) it.copy(alpha = (it.alpha + 0.42f).coerceAtMost(0.94f)) else it }
    if (from == null) {
        this.clip(shape).background(body, shape)
    } else {
        this.drawBackdrop(
            backdrop = from,
            shape = { shape },
            effects = {
                vibrancy()
                blur(tone.blur.toPx())
                lens(tone.lensHeight.toPx(), tone.lensAmount.toPx(), depthEffect = tone != GlassTone.Chip)
            },
            highlight = { Highlight.Default },
            shadow = if (shadow) ({ Shadow(radius = 24.dp, color = Color.Black.copy(alpha = if (dark) 0.28f else 0.10f)) }) else null,
            onDrawSurface = { drawRect(body) },
        )
    }
}

/** A box of liquid glass ([GlassTone.Chip] unless told otherwise) over [GlassScene]'s picture. */
@Composable
fun LiquidGlass(
    modifier: Modifier = Modifier,
    radius: Dp = 22.dp,
    tone: GlassTone = GlassTone.Chip,
    onArt: Boolean = false,
    content: @Composable BoxScope.() -> Unit,
) {
    val shape = RoundedCornerShape(radius)
    Box(modifier.liquidGlass(shape, tone, onArt = onArt).clip(shape), content = content)
}

/** Text and glyph colour on liquid glass: light on the dark body, near-black on the light one. */
@Composable
fun glassInk(onArt: Boolean = false, soft: Boolean = false): Color =
    if (onArt || MusixTheme.isDark) Color.White.copy(alpha = if (soft) 0.76f else 0.92f)
    else Color(0xFF161422).copy(alpha = if (soft) 0.72f else 0.92f)
