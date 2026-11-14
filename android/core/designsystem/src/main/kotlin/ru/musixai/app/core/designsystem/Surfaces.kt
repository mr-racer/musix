package ru.musixai.app.core.designsystem

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.dropShadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.shadow.Shadow
import androidx.compose.ui.layout.layout
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.offset

/** The hairline of a lifted surface (`surfaces.md`): white 14 % on dark, black 8 % on light. */
internal fun hairline(dark: Boolean) = if (dark) Color.White.copy(alpha = 0.14f) else Color.Black.copy(alpha = 0.08f)

/**
 * `float` (`surfaces.md`): windows, sheets, toasts, menus — the solid `--mx-float`, a 14 %
 * hairline and the deep soft shadow (`0 24px 60px rgba(0,0,0,.5)`, lighter on the light theme).
 */
fun Modifier.float(shape: Shape = RoundedCornerShape(26.dp), shadow: Boolean = true): Modifier = composed {
    val c = MusixTheme.colors
    val dark = MusixTheme.isDark
    (if (shadow) dropShadow(shape, Shadow(radius = 30.dp, color = if (dark) Color(0x80000000) else Color(0x2E2E2456), offset = DpOffset(0.dp, 12.dp))) else this)
        .background(c.float, shape)
        .border(1.dp, hairline(dark), shape)
}

/** `plate` (`surfaces.md`): the facts block, sample chips — `--mx-plate`, radius 16 (chips 12). */
fun Modifier.plate(radius: Dp = 16.dp): Modifier = composed {
    val shape = RoundedCornerShape(radius)
    background(MusixTheme.colors.plate, shape).border(1.dp, MusixTheme.colors.border, shape)
}

/**
 * A row that runs past its column's side padding [h] to the screen's edges (the home's vibes,
 * a tool row, the discography line): it scrolls edge to edge while its first item still
 * lines up with the column.
 */
fun Modifier.bleed(h: Dp): Modifier = layout { m, c ->
    val dx = h.roundToPx()
    val p = m.measure(c.offset(horizontal = 2 * dx))
    layout(p.width - 2 * dx, p.height) { p.place(-dx, 0) }
}
