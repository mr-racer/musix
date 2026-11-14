package ru.musixai.app.core.designsystem.control

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.input.TextFieldLineLimits
import androidx.compose.foundation.text.input.TextFieldState
import androidx.compose.foundation.text.input.clearText
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import ru.musixai.app.core.designsystem.MusixIcons
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.core.designsystem.gesture.Press
import ru.musixai.app.core.designsystem.gesture.pressable
import ru.musixai.app.core.designsystem.text

/**
 * «Стеклянное поле»: the one text field of the new screens — 48 dp, a soft pill that takes a
 * thin accent rim when focused, the placeholder in the muted ink, a × that comes in with the
 * first letter and empties the field. [onSubmit] is the keyboard's action (search, send).
 * State lives in a [TextFieldState] the screen holds — no value/onValueChange round trip.
 */
@Composable
fun GlassField(
    state: TextFieldState,
    placeholder: String,
    modifier: Modifier = Modifier,
    leading: ImageVector? = null,
    imeAction: ImeAction = ImeAction.Done,
    onSubmit: (() -> Unit)? = null,
    enabled: Boolean = true,
) {
    val c = MusixTheme.colors
    val source = remember { MutableInteractionSource() }
    val focused by source.collectIsFocusedAsState()
    val rim by animateColorAsState(if (focused) c.accent.copy(alpha = 0.45f) else Color.Transparent, tween(180), label = "rim")
    val shape = RoundedCornerShape(999.dp)
    BasicTextField(
        state = state,
        modifier = modifier.fillMaxWidth().height(48.dp),
        enabled = enabled,
        textStyle = MusixTheme.text.body.copy(color = c.text),
        keyboardOptions = KeyboardOptions(imeAction = imeAction),
        onKeyboardAction = onSubmit?.let { submit -> { submit() } },
        lineLimits = TextFieldLineLimits.SingleLine,
        interactionSource = source,
        cursorBrush = SolidColor(c.accent),
        decorator = { inner ->
            Row(
                Modifier.fillMaxWidth().height(48.dp).background(softFill(), shape).border(1.dp, rim, shape)
                    .padding(start = if (leading != null) 14.dp else 18.dp, end = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                if (leading != null) Icon(leading, null, Modifier.size(18.dp), tint = c.textMuted)
                Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
                    if (state.text.isEmpty()) Text(placeholder, style = MusixTheme.text.body.copy(color = c.textMuted), maxLines = 1)
                    inner()
                }
                AnimatedVisibility(
                    state.text.isNotEmpty(),
                    enter = fadeIn(tween(160)) + scaleIn(initialScale = 0.6f),
                    exit = fadeOut(tween(120)) + scaleOut(targetScale = 0.6f),
                ) {
                    Box(Modifier.size(40.dp).pressable(role = Press.Icon) { state.clearText() }, contentAlignment = Alignment.Center) {
                        Icon(MusixIcons.Close, "Очистить", Modifier.size(16.dp), tint = c.textMuted)
                    }
                }
            }
        },
    )
}

/** [GlassField] for search: the magnifier in front, «Найти» on the keyboard. */
@Composable
fun SearchField(state: TextFieldState, placeholder: String = "Поиск", modifier: Modifier = Modifier, onSearch: (() -> Unit)? = null) =
    GlassField(state, placeholder, modifier, leading = MusixIcons.Search, imeAction = ImeAction.Search, onSubmit = onSearch)
