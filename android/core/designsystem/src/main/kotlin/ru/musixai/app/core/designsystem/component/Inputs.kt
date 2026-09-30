package ru.musixai.app.core.designsystem.component

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.dropShadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.shadow.Shadow
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.material3.Text
import ru.musixai.app.core.designsystem.MusixTheme

private val FIELD = RoundedCornerShape(12.dp)

/** v1 `.login-input`: a dark well; focus = a violet rim and a soft 3 px halo. */
@Composable
fun MusixField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
    password: Boolean = false,
    keyboard: KeyboardOptions = KeyboardOptions.Default,
    actions: KeyboardActions = KeyboardActions.Default,
    textStyle: TextStyle = MusixTheme.type.body.copy(fontSize = 14.sp),
) {
    val c = MusixTheme.colors
    val dark = MusixTheme.isDark
    val source = remember { MutableInteractionSource() }
    val focused by source.collectIsFocusedAsState()
    val rim by animateColorAsState(if (focused) Color(0x8C7C5BFF) else if (dark) Color(0x1AFFFFFF) else Color(0x1F000000))
    BasicTextField(
        value = value, onValueChange = onValueChange, singleLine = true,
        textStyle = textStyle.copy(color = c.text),
        cursorBrush = SolidColor(c.accentLight),
        visualTransformation = if (password) PasswordVisualTransformation() else VisualTransformation.None,
        keyboardOptions = keyboard, keyboardActions = actions, interactionSource = source,
        modifier = modifier.fillMaxWidth(),
        decorationBox = { inner ->
            Box(
                Modifier
                    .then(if (focused) Modifier.dropShadow(FIELD, Shadow(radius = 0.dp, spread = 3.dp, color = Color(0x265874EA))) else Modifier)
                    .background(if (dark) Color(0x52000000) else Color(0xFFFFFFFF), FIELD)
                    .border(1.dp, rim, FIELD)
                    .padding(horizontal = 14.dp, vertical = 12.dp),
            ) {
                if (value.isEmpty()) Text(placeholder, style = textStyle.copy(color = c.textSubtle))
                inner()
            }
        },
    )
}

/** v1 `.cta-v3`: the violet pill with a lit top edge and a glow under it. */
@Composable
fun CtaButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
    val shape = RoundedCornerShape(12.dp)
    Box(
        modifier
            .dropShadow(shape, Shadow(radius = 22.dp, color = Color(0x805874EA), offset = DpOffset(0.dp, 8.dp)))
            .background(Brush.verticalGradient(listOf(Color(0xFF8394FF), Color(0xFF5E41EB))), shape)
            .border(1.dp, Brush.verticalGradient(listOf(Color(0x6BFFFFFF), Color(0x00FFFFFF), Color(0x66000000))), shape)
            .pressable(enabled, onClick)
            .padding(horizontal = 16.dp, vertical = 13.dp),
        contentAlignment = androidx.compose.ui.Alignment.Center,
    ) {
        Text(text, style = MusixTheme.type.body.copy(fontSize = 14.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 0.14.sp, color = Color.White.copy(alpha = if (enabled) 1f else 0.7f)))
    }
}

/** v1 `.login-tab` pair inside the dark tray. */
@Composable
fun TabPair(options: List<String>, selected: Int, onSelect: (Int) -> Unit, modifier: Modifier = Modifier) {
    val c = MusixTheme.colors
    Row(
        modifier
            .fillMaxWidth()
            .background(Color(0x38000000), RoundedCornerShape(14.dp))
            .border(1.dp, Color(0x0FFFFFFF), RoundedCornerShape(14.dp))
            .padding(4.dp),
    ) {
        options.forEachIndexed { i, label ->
            val on = i == selected
            val shape = RoundedCornerShape(11.dp)
            Box(
                Modifier
                    .weight(1f)
                    .background(if (on) Color(0x297C5BFF) else Color.Transparent, shape)
                    .border(1.dp, if (on) Color(0x597C5BFF) else Color.Transparent, shape)
                    .pressable(true) { onSelect(i) }
                    .padding(vertical = 9.dp, horizontal = 12.dp),
                contentAlignment = androidx.compose.ui.Alignment.Center,
            ) {
                Text(label, style = MusixTheme.type.body.copy(fontSize = 13.sp, fontWeight = FontWeight.Medium,
                    color = if (on) Color(0xFFBBA8FF) else c.textMuted))
            }
        }
    }
}

/** `.mono` uppercase eyebrow labels. */
@Composable
fun Eyebrow(text: String, modifier: Modifier = Modifier, color: Color = MusixTheme.colors.textMuted) {
    Text(text.uppercase(), modifier = modifier, style = MusixTheme.type.eyebrow.copy(color = color))
}
