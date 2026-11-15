package ru.musixai.app.core.designsystem.control

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ru.musixai.app.core.designsystem.MusixIcons
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.core.designsystem.motion.TextShimmer
import ru.musixai.app.core.designsystem.gesture.Press
import ru.musixai.app.core.designsystem.gesture.pressable
import ru.musixai.app.core.designsystem.motion.rememberReducedMotion
import ru.musixai.app.core.designsystem.text

/**
 * «Сворачивающееся поле» (the player's «Спросить», 2026-11-14/15): while the answer is made the field
 * rolls up into its own round button on the right — the button holds a [Richbox] ([state]) and stops the
 * answer on a tap — and one line beside it says what is being done ([status], shimmering while [busy]).
 * When the answer has come it unrolls into the field again. The send button keeps its own place in both:
 * folded, the field is a 50 dp circle with the button in its middle.
 */
@Composable
fun FoldingComposer(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    folded: Boolean,
    busy: Boolean,
    state: RichboxState,
    status: String,
    onSend: () -> Unit,
    onStop: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val c = MusixTheme.colors
    val reduced = rememberReducedMotion()
    val focus = LocalFocusManager.current
    // 0 a field, 1 a round button (k 300, c 23 — a little give at the end)
    val v by animateFloatAsState(if (folded) 1f else 0f, if (reduced) tween(120) else androidx.compose.animation.core.spring(dampingRatio = 23f / (2f * kotlin.math.sqrt(300f)), stiffness = 300f), label = "fold")
    BoxWithConstraints(modifier.fillMaxWidth().height(50.dp)) {
        val full = maxWidth
        // the line of what is being done stands where the field was
        Box(Modifier.padding(start = 8.dp, end = 64.dp).fillMaxHeight(), contentAlignment = Alignment.CenterStart) {
            AnimatedContent(status, transitionSpec = { (fadeIn(tween(260)) + slideInVertically(tween(260)) { it / 8 }) togetherWith fadeOut(tween(140)) }, label = "status") { s ->
                if (s.isEmpty()) Box(Modifier) else if (busy) TextShimmer(s, style = MusixTheme.text.reading.copy(fontSize = 15.sp), base = c.textMuted, light = c.text)
                else Text(s, maxLines = 1, style = MusixTheme.text.reading.copy(fontSize = 15.sp, color = c.textMuted))
            }
        }
        val w = (full + (50.dp - full) * v).coerceAtLeast(44.dp)
        Box(
            Modifier.align(Alignment.CenterEnd).width(w).height(50.dp).clip(RoundedCornerShape(25.dp))
                .background(c.text.copy(alpha = 0.10f)).border(1.dp, c.border, RoundedCornerShape(25.dp)),
        ) {
            BasicTextField(
                value, onValueChange,
                Modifier.align(Alignment.CenterStart).padding(start = 18.dp, end = 50.dp).fillMaxWidth()
                    .graphicsLayer { alpha = (1f - v * 2.4f).coerceIn(0f, 1f) },
                enabled = !folded,
                singleLine = true,
                textStyle = MusixTheme.text.body.copy(fontSize = 15.sp, color = c.text),
                cursorBrush = SolidColor(c.accent),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                keyboardActions = KeyboardActions(onSend = { if (value.isNotBlank()) { focus.clearFocus(); onSend() } }),
                decorationBox = { inner ->
                    if (value.isEmpty()) Text(placeholder, maxLines = 1, style = MusixTheme.text.body.copy(fontSize = 15.sp, color = c.textSubtle))
                    inner()
                },
            )
            // the send button: an arrow in the field, the Richbox in the circle
            Box(
                Modifier.align(Alignment.CenterEnd).offset(x = (-4).dp).size(42.dp).clip(CircleShape)
                    .pressable(role = Press.Icon) { if (folded) { if (busy) onStop() } else if (value.isNotBlank()) { focus.clearFocus(); onSend() } },
                contentAlignment = Alignment.Center,
            ) {
                Icon(MusixIcons.ArrowUp, "Отправить", Modifier.size(22.dp).graphicsLayer {
                    val k = (1f - v).coerceIn(0f, 1f); alpha = k; val s = 0.5f + 0.5f * k; scaleX = s; scaleY = s; rotationZ = 90f * (1f - k)
                }, tint = c.text)
                Richbox(state, Modifier.graphicsLayer {
                    val k = v.coerceIn(0f, 1f); alpha = k; val s = 0.5f + 0.5f * k; scaleX = s; scaleY = s; rotationZ = -90f * (1f - k)
                }, size = 24.dp, ink = if (MusixTheme.isDark) null else c.text)
            }
        }
    }
}

