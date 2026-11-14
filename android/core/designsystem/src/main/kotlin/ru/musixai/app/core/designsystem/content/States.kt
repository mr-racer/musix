package ru.musixai.app.core.designsystem.content

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ru.musixai.app.core.designsystem.MusixTheme

/** `.load-skel`: a translucent block with a sweeping highlight (1.5 s). */
@Composable
fun Skel(modifier: Modifier, radius: Dp = 8.dp) {
    val dark = MusixTheme.isDark
    val t = rememberInfiniteTransition(label = "skel")
    val x by t.animateFloat(-1f, 2f, infiniteRepeatable(tween(1500, easing = LinearEasing), RepeatMode.Restart), label = "x")
    val shape = RoundedCornerShape(radius)
    Box(modifier.background(if (dark) Color(0x0DFFFFFF) else Color(0x0F000000), shape)
        .background(Brush.horizontalGradient(0f to Color.Transparent, 0.5f to (if (dark) Color(0x1AFFFFFF) else Color(0x99FFFFFF)), 1f to Color.Transparent,
            startX = x * 600f - 300f, endX = x * 600f + 300f), shape))
}

/** v1 `Spinner`: a 270° arc turning once a second. */
@Composable
fun Spinner(size: Dp = 16.dp, color: Color = MusixTheme.colors.accentLight) {
    val t = rememberInfiniteTransition(label = "spin")
    val a by t.animateFloat(0f, 360f, infiniteRepeatable(tween(1000, easing = LinearEasing)), label = "a")
    Canvas(Modifier.size(size)) {
        drawArc(color.copy(alpha = 0.25f), 0f, 360f, false, style = Stroke(this.size.width * 0.14f))
        drawArc(color, a, 270f, false, style = Stroke(this.size.width * 0.14f, cap = StrokeCap.Round))
    }
}

@Composable
fun Empty(text: String = "Здесь пока пусто", modifier: Modifier = Modifier) {
    Box(modifier.padding(24.dp), contentAlignment = Alignment.Center) {
        Text(text, style = MusixTheme.type.body.copy(fontSize = 13.sp, color = MusixTheme.colors.textSubtle))
    }
}
