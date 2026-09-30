package ru.musixai.app.core.designsystem.component

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.dropShadow
import androidx.compose.ui.draw.innerShadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.shadow.Shadow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.dp
import ru.musixai.app.core.designsystem.MusixTheme

/** v1 `.liquid-glass`: a translucent sheet with a 165° sheen, a bright top rim and a deep
 *  drop shadow. The backdrop blur comes from [glassBackdrop] where a Haze source exists. */
@Composable
fun LiquidGlass(
    modifier: Modifier = Modifier,
    radius: Dp = 22.dp,
    content: @Composable BoxScope.() -> Unit,
) {
    val dark = MusixTheme.isDark
    val shape: Shape = RoundedCornerShape(radius)
    val sheen = if (dark) {
        Brush.linearGradient(
            0f to Color(0x29FFFFFF), 0.32f to Color(0x0DFFFFFF), 0.64f to Color(0x05FFFFFF), 1f to Color(0x1AFFFFFF),
        )
    } else {
        Brush.linearGradient(
            0f to Color(0xEBFFFFFF), 0.36f to Color(0x94FFFFFF), 0.66f to Color(0x6BFFFFFF), 1f to Color(0xCCFFFFFF),
        )
    }
    Box(
        modifier
            .dropShadow(shape, Shadow(radius = 42.dp, color = if (dark) Color(0x73000000) else Color(0x292E2456), offset = DpOffset(0.dp, 18.dp)))
            .clip(shape)
            .glassBackdrop()
            .background(if (dark) Color(0x5C181820) else Color(0x59F4F3FA))
            .background(sheen)
            .innerShadow(shape, Shadow(radius = 0.dp, color = if (dark) Color(0x40FFFFFF) else Color(0xF2FFFFFF), offset = DpOffset(0.dp, 1.dp)))
            .border(1.dp, if (dark) Color(0x21FFFFFF) else Color(0xBFFFFFFF), shape),
        content = content,
    )
}
