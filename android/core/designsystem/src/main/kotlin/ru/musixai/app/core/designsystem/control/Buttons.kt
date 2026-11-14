package ru.musixai.app.core.designsystem.control

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.keyframes
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.clickable
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import ru.musixai.app.core.designsystem.MusixIcons
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.core.designsystem.gesture.HapticCue
import ru.musixai.app.core.designsystem.gesture.Press
import ru.musixai.app.core.designsystem.gesture.pressable
import ru.musixai.app.core.designsystem.motion.rememberReducedMotion
import ru.musixai.app.core.designsystem.text

/** The soft fill of a quiet control: white 7 % on dark, black 5 % on light. */
@Composable
internal fun softFill(): Color = if (MusixTheme.isDark) Color.White.copy(alpha = 0.07f) else Color.Black.copy(alpha = 0.05f)

/**
 * «Круглая кнопка» (`components.md`, Icon button): a 40 dp circle in a 48 dp touch zone, the
 * glyph at 22, giving to 0.9 under the finger. [on] lights it in [accent] (огонёк orange, вода
 * blue) and — the moment it turns on — the glyph bounces: swells to 1.45, leans 8° and springs
 * back in 520 ms. A [toggle] says ToggleOn / ToggleOff; a plain button is silent.
 */
@Composable
fun RoundButton(
    icon: ImageVector,
    contentDescription: String?,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    on: Boolean = false,
    toggle: Boolean = false,
    accent: Color = MusixTheme.colors.accent,
    size: Dp = 40.dp,
) {
    val c = MusixTheme.colors
    val reduced = rememberReducedMotion()
    val fill by animateColorAsState(if (on) accent.copy(alpha = 0.18f) else softFill(), tween(220), label = "fill")
    val tint by animateColorAsState(if (on) accent else c.text, tween(220), label = "tint")
    val bounce = remember { Animatable(0f) }
    var was by remember { mutableStateOf(on) }
    LaunchedEffect(on) {
        if (on && !was && !reduced) bounce.animateTo(1f, keyframes { durationMillis = 520; 0.35f at 140; 1f at 520 }).also { bounce.snapTo(0f) }
        was = on
    }
    Box(
        modifier.size(48.dp).semantics { role = if (toggle) Role.Switch else Role.Button }
            .pressable(role = Press.Icon, haptic = if (toggle) (if (on) HapticCue.ToggleOff else HapticCue.ToggleOn) else null, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Box(Modifier.size(size).background(fill, CircleShape), contentAlignment = Alignment.Center) {
            Icon(icon, contentDescription, Modifier.size(size * 0.55f).graphicsLayer {
                val b = bounce.value
                // up to 1.45 and 8° at a third of the way, back by the end
                val k = if (b <= 0.35f) b / 0.35f else 1f - (b - 0.35f) / 0.65f
                val s = 1f + 0.45f * k
                scaleX = s; scaleY = s
                rotationZ = -8f * k
            }, tint = tint)
        }
    }
}

/** How a [Pill] sits on the page. */
enum class PillStyle {
    /** A soft fill (tools, follow-ups). */
    Soft,
    /** Only a hairline (secondary choices). */
    Outline,
    /** A dashed hairline: «нет в фонотеке». */
    Dashed,
    /** The accent fill: the chosen one, the main action of a small group. */
    Accent,
}

/**
 * «Пилюля»: the soft pill of the library's tools, the assistant's suggestions, the artist's
 * buttons — 40 dp tall (a 48 dp zone around it in rows of one), Geist 500 13, an optional
 * [leading] dot, icon or cover. Gives to 0.96. Silent.
 */
@Composable
fun Pill(
    text: String,
    onClick: (() -> Unit)?,
    modifier: Modifier = Modifier,
    style: PillStyle = PillStyle.Soft,
    leading: (@Composable () -> Unit)? = null,
    trailing: (@Composable () -> Unit)? = null,
) {
    val c = MusixTheme.colors
    val shape = RoundedCornerShape(999.dp)
    val bg = when (style) { PillStyle.Soft -> softFill(); PillStyle.Accent -> c.accent; else -> Color.Transparent }
    val fg = if (style == PillStyle.Accent) Color.White else c.text
    val line = if (MusixTheme.isDark) Color.White.copy(alpha = 0.22f) else Color.Black.copy(alpha = 0.18f)
    Row(
        modifier.heightIn(min = 40.dp)
            .then(if (onClick != null) Modifier.pressable(role = Press.Chip, onClick = onClick) else Modifier)
            .background(bg, shape)
            .then(when (style) {
                PillStyle.Outline -> Modifier.border(1.dp, line, shape)
                PillStyle.Dashed -> Modifier.drawBehind {
                    drawRoundRect(line, cornerRadius = CornerRadius(size.height / 2), style = Stroke(1.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(5.dp.toPx(), 4.dp.toPx()))))
                }
                else -> Modifier
            })
            .padding(start = if (leading != null) 8.dp else 16.dp, end = if (trailing != null) 10.dp else 16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        leading?.invoke()
        Text(text, style = MusixTheme.text.label.copy(color = if (style == PillStyle.Dashed) c.textMuted else fg), maxLines = 1)
        trailing?.invoke()
    }
}

/**
 * «Ссылка» (`typography.md`): text with a 1 dp underline 4 dp under its baseline at 42 % of
 * its colour, on every line it wraps to. A [primary] link — one or two per screen — carries a
 * chevron that slides 3 dp when pressed.
 */
@Composable
fun TextLink(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    style: TextStyle = MusixTheme.text.body,
    color: Color = MusixTheme.colors.text,
    primary: Boolean = false,
) {
    var layout by remember { mutableStateOf<TextLayoutResult?>(null) }
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    val nudge by animateFloatAsState(if (pressed) 3f else 0f, spring(dampingRatio = .6f, stiffness = 700f), label = "chevron")
    Row(
        modifier.semantics { role = Role.Button }.clickable(interactionSource = source, indication = null, onClick = onClick),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(text, Modifier.drawBehind {
            val l = layout ?: return@drawBehind
            val y0 = 4.dp.toPx()
            for (i in 0 until l.lineCount) {
                val y = l.getLineBaseline(i) + y0
                drawLine(color.copy(alpha = color.alpha * 0.42f), androidx.compose.ui.geometry.Offset(l.getLineLeft(i), y),
                    androidx.compose.ui.geometry.Offset(l.getLineRight(i), y), strokeWidth = 1.dp.toPx())
            }
        }, style = style.copy(color = color), onTextLayout = { layout = it })
        if (primary) Icon(MusixIcons.ChevronRight, null, Modifier.padding(start = 2.dp).size(14.dp).graphicsLayer { translationX = nudge.dp.toPx() }, tint = color)
    }
}
