package ru.musixai.app.core.designsystem.component

import androidx.compose.foundation.background
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
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

/** v1's skeuomorphic surfaces (`.ske-btn-*`, `.ske-inset-*`): a raised button with a lit top
 *  edge, and a pressed-in well. Everything "physical" in the UI is one of these two. */
@Composable
fun Modifier.skeButton(radius: Dp = 8.dp, pressed: Boolean = false): Modifier {
    val dark = MusixTheme.isDark
    val shape = RoundedCornerShape(radius)
    return if (pressed) {
        this.background(if (dark) Brush.verticalGradient(listOf(Color(0xFF2C2C34), Color(0xFF1C1C23))) else Brush.verticalGradient(listOf(Color.White, Color(0xFFE1E0EA))), shape)
            .innerShadow(shape, Shadow(radius = 5.dp, color = Color(0x73000000), offset = DpOffset(0.dp, 2.dp)))
    } else {
        this.dropShadow(shape, Shadow(radius = if (dark) 5.dp else 4.dp, color = if (dark) Color(0x80000000) else Color(0x212E1E3C), offset = DpOffset(0.dp, 2.dp)))
            .background(if (dark) Brush.verticalGradient(listOf(Color(0xFF2C2C34), Color(0xFF1C1C23))) else Brush.verticalGradient(listOf(Color.White, Color(0xFFE1E0EA))), shape)
            .innerShadow(shape, Shadow(radius = 0.dp, color = if (dark) Color(0x21FFFFFF) else Color.White, offset = DpOffset(0.dp, 1.dp)))
            .innerShadow(shape, Shadow(radius = 0.dp, color = if (dark) Color(0x80000000) else Color(0x1F000000), offset = DpOffset(0.dp, (-1).dp)))
    }
}

@Composable
fun Modifier.skeInset(shape: Shape = RoundedCornerShape(10.dp)): Modifier {
    val dark = MusixTheme.isDark
    return this.background(if (dark) Brush.verticalGradient(listOf(Color(0xFF0A0A0D), Color(0xFF14141A))) else Brush.verticalGradient(listOf(Color(0xFFE7E6EE), Color(0xFFF3F2F7))), shape)
        .innerShadow(shape, Shadow(radius = if (dark) 5.dp else 4.dp, color = if (dark) Color(0xB3000000) else Color(0x212E1E3C), offset = DpOffset(0.dp, 2.dp)))
        .innerShadow(shape, Shadow(radius = 0.dp, spread = 1.dp, color = if (dark) Color(0x80000000) else Color(0x122E1E3C)))
}

/** v1 `.ske-display-*`: the recessed readout of a stat — near-black glass in dark, warm
 *  paper in light, both with a faint amber glow from the top. */
@Composable
fun Modifier.skeDisplay(shape: Shape = RoundedCornerShape(16.dp)): Modifier {
    val dark = MusixTheme.isDark
    return this.background(if (dark) Brush.verticalGradient(listOf(Color(0xFF07070A), Color(0xFF0E0E12))) else Brush.verticalGradient(listOf(Color(0xFFF4F2E9), Color(0xFFE8E5D8))), shape)
        .background(Brush.radialGradient(listOf(Color(0xD4A55A).copy(alpha = if (dark) 0.04f else 0.06f), Color.Transparent)), shape)
        .innerShadow(shape, Shadow(radius = if (dark) 8.dp else 5.dp, color = if (dark) Color(0xD9000000) else Color(0x2E46371E), offset = DpOffset(0.dp, 2.dp)))
        .innerShadow(shape, Shadow(radius = 0.dp, spread = 1.dp, color = if (dark) Color(0x99000000) else Color(0x2146371E)))
}
