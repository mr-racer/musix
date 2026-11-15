package ru.musixai.app.core.designsystem.motion

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.TextStyle
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.core.designsystem.text

/**
 * «Мерцающая строка»: a line of what is being done with light passing through it (the player's ask
 * status, the assistant's stage): one fixed gradient slid across the text in its own layer — never a new
 * gradient per frame. Still under reduced motion.
 */
@Composable
fun TextShimmer(text: String, modifier: Modifier = Modifier, style: TextStyle = MusixTheme.text.reading, base: Color = MusixTheme.colors.textMuted, light: Color = MusixTheme.colors.text, periodMs: Int = 1500) {
    if (rememberReducedMotion()) { Text(text, modifier, maxLines = 1, style = style.copy(color = base)); return }
    val t = rememberInfiniteTransition(label = "shimmer")
    val x by t.animateFloat(1f, -1f, infiniteRepeatable(tween(periodMs, easing = LinearEasing), RepeatMode.Restart), label = "x")
    val sweep = remember(base, light) { Brush.horizontalGradient(0.3f to base, 0.5f to light, 0.7f to base) }
    Text(text, modifier.graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen }.drawWithContent {
        drawContent()
        val w = size.width
        // the gradient is 220 % of the line wide and slides across it
        drawContext.transform.translate(w * x * 1.1f, 0f)
        drawRect(sweep, topLeft = Offset(-w * 0.6f, 0f), size = androidx.compose.ui.geometry.Size(w * 2.2f, size.height), blendMode = BlendMode.SrcAtop)
        drawContext.transform.translate(-w * x * 1.1f, 0f)
    }, maxLines = 1, style = style.copy(color = base))
}

