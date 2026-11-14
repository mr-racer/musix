package ru.musixai.app.core.designsystem.component

import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.layout
import androidx.compose.ui.unit.constrainHeight

/**
 * The stage: the height (px) the shell gives its screens and the mini-player together. It
 * holds still while the bar comes and goes — the screen above gives way, the stage does not.
 * The bar is open, no strip of its own (the accepted phone look: `.mini` lies on the scene),
 * so a screen with a backdrop of its own paints it [stageTall]: under the bar too.
 * 0 outside the shell: a screen's own height.
 */
val LocalStageHeight = compositionLocalOf { 0 }

/**
 * Lays a backdrop out as tall as the [stage] from the screen's top, while the screen keeps its
 * own size: the rest hangs below it, under the mini-player. As the stage holds still, so does
 * the backdrop while the bar rises; only what stands on it moves up.
 */
fun Modifier.stageTall(stage: Int): Modifier = layout { m, c ->
    val h = if (c.hasBoundedHeight) maxOf(c.maxHeight, stage) else c.maxHeight
    val p = m.measure(if (h == c.maxHeight) c else c.copy(minHeight = h, maxHeight = h))
    layout(p.width, c.constrainHeight(p.height)) { p.place(0, 0) }
}
