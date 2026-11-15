package ru.musixai.app.core.designsystem.content

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.core.designsystem.motion.rememberReducedMotion
import ru.musixai.app.core.designsystem.text

/**
 * «Свой вопрос» (the player's ask sheet, round 4, 2026-11-15): the listener's line stands on the right,
 * tinted with the song's [accent] — a bubble with a tail corner towards the edge — so a question never
 * melts into the answer, which is plain reading text on the left. Dark: a light tint of the accent on its
 * deep fill; light: the accent darkened on a pale wash.
 */
@Composable
fun AskedLine(text: String, accent: Color, modifier: Modifier = Modifier) {
    val dark = MusixTheme.isDark
    val ink = if (dark) lerp(Color.White, accent, 0.24f) else lerp(Color.Black, accent, 0.62f)
    val fill = if (dark) lerp(Color.White.copy(alpha = 0.03f), accent, 0.30f) else lerp(Color.White.copy(alpha = 0.5f), accent.copy(alpha = 1f), 0.15f)
    val edge = accent.copy(alpha = if (dark) 0.46f else 0.30f)
    val shape = RoundedCornerShape(20.dp, 20.dp, 6.dp, 20.dp)
    BoxWithConstraints(modifier.fillMaxWidth(), contentAlignment = Alignment.CenterEnd) {
        Text(
            text,
            Modifier.widthIn(max = maxWidth * 0.84f).background(fill, shape).border(1.dp, edge, shape)
                .drawBehind { if (dark) drawLine(Color.White.copy(alpha = 0.14f), Offset(20.dp.toPx(), 0.5f), Offset(size.width - 20.dp.toPx(), 0.5f), 1f) }
                .padding(start = 15.dp, end = 15.dp, top = 10.dp, bottom = 11.dp),
            style = MusixTheme.text.body.copy(fontSize = 15.sp, fontWeight = FontWeight.Medium, lineHeight = 1.4.em, letterSpacing = (-0.005).em, color = ink),
        )
    }
}

/** Between two turns of a conversation: a hairline of the accent that fades out to both ends. */
@Composable
fun TurnRule(accent: Color, modifier: Modifier = Modifier) {
    Canvas(modifier.fillMaxWidth().height(1.dp)) {
        drawRect(Brush.horizontalGradient(0f to Color.Transparent, 0.5f to accent.copy(alpha = 0.4f), 1f to Color.Transparent))
    }
}
