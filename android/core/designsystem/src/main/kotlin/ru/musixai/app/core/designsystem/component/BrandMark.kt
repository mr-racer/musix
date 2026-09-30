package ru.musixai.app.core.designsystem.component

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.dropShadow
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.shadow.Shadow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.dp

/** v1 `BrandMark`: a dark tile with five EQ bars in the brand colors (oklch → sRGB). */
private val BARS = listOf(0.44f to 0xFF5B81FE, 0.70f to 0xFF858DFF, 0.94f to 0xFFAD99FB, 0.60f to 0xFFD08DAC, 0.36f to 0xFFDCA744)

@Composable
fun BrandMark(size: Dp = 34.dp, modifier: Modifier = Modifier) {
    val shape = RoundedCornerShape(size * 0.28f)
    Box(
        modifier
            .size(size)
            .dropShadow(shape, Shadow(radius = 12.dp, color = Color(0x80000000), offset = DpOffset(0.dp, 4.dp)))
            .background(Brush.linearGradient(listOf(Color(0xFF211C30), Color(0xFF0C0A13)), start = Offset(0f, 0f), end = Offset.Infinite), shape),
        contentAlignment = Alignment.Center,
    ) {
        Canvas(Modifier.size(size * 0.6f)) {
            val u = this.size.width / 24f
            val barW = 3.1f * u
            val gap = 1.3f * u
            val total = BARS.size * barW + (BARS.size - 1) * gap
            var x = (this.size.width - total) / 2
            for ((h, c) in BARS) {
                val bh = h * 19f * u
                drawRoundRect(Color(c), topLeft = Offset(x, this.size.height / 2 - bh / 2), size = Size(barW, bh), cornerRadius = CornerRadius(barW / 2))
                x += barW + gap
            }
        }
    }
}
