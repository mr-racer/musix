package ru.musixai.app.core.designsystem.component

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.dropShadow
import androidx.compose.ui.draw.innerShadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.shadow.Shadow
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.LinearEasing
import ru.musixai.app.core.designsystem.MusixTheme

private val ACTIVE = Brush.verticalGradient(listOf(Color(0xFF7C86F5), Color(0xFF5849DF)))  // oklch(67% .18 270) → oklch(54% .22 280)

/** v1 `ToggleSwitch`: a two-half rocker, 44×22; the lit half carries the brand gradient. */
@Composable
fun ToggleSwitch(checked: Boolean, onChange: (Boolean) -> Unit, modifier: Modifier = Modifier) {
    val dark = MusixTheme.isDark
    Row(
        modifier.size(44.dp, 22.dp).skeInset(RoundedCornerShape(8.dp)).pressable { onChange(!checked) }.padding(2.dp),
        horizontalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        for (half in listOf(false, true)) {
            val on = half == checked
            val shape = RoundedCornerShape(6.dp)
            Box(
                Modifier.weight(1f).fillMaxHeight()
                    .then(if (on) Modifier.dropShadow(shape, Shadow(radius = 8.dp, color = Color(0x665874EA))).background(ACTIVE, shape)
                        .innerShadow(shape, Shadow(radius = 3.dp, color = Color(0x59000000), offset = DpOffset(0.dp, 1.dp)))
                    else Modifier.background(if (dark) Brush.verticalGradient(listOf(Color(0xFF2C2C34), Color(0xFF1C1C23))) else Brush.verticalGradient(listOf(Color.White, Color(0xFFE1E0EA))), shape)
                        .innerShadow(shape, Shadow(radius = 0.dp, color = if (dark) Color(0x1FFFFFFF) else Color.White, offset = DpOffset(0.dp, 1.dp)))),
            )
        }
    }
}

data class SegmentOption<T>(val value: T, val label: String)

/** v1 `Segmented`: a pressed-in tray; the active segment is a raised button, the rest flat text. */
@Composable
fun <T> Segmented(value: T, options: List<SegmentOption<T>>, onChange: (T) -> Unit, modifier: Modifier = Modifier, small: Boolean = false) {
    val c = MusixTheme.colors
    Row(modifier.skeInset(RoundedCornerShape(10.dp)).padding(3.dp), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
        for (o in options) {
            val active = o.value == value
            Box(
                (if (active) Modifier.skeButton(8.dp) else Modifier).pressable { onChange(o.value) }
                    .padding(horizontal = 14.dp, vertical = if (small) 5.dp else 7.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(o.label, style = MusixTheme.type.label.copy(fontSize = if (small) 11.sp else 12.sp, fontWeight = FontWeight.SemiBold,
                    letterSpacing = 0.06.em, color = if (active) c.text else c.textSubtle))
            }
        }
    }
}

/** `.load-skel`: a translucent block with a sweeping highlight (1.5 s). */
@Composable
fun Skel(modifier: Modifier, radius: androidx.compose.ui.unit.Dp = 8.dp) {
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
fun Spinner(size: androidx.compose.ui.unit.Dp = 16.dp, color: Color = MusixTheme.colors.accentLight) {
    val t = rememberInfiniteTransition(label = "spin")
    val a by t.animateFloat(0f, 360f, infiniteRepeatable(tween(1000, easing = LinearEasing)), label = "a")
    Canvas(Modifier.size(size)) {
        drawArc(color.copy(alpha = 0.25f), 0f, 360f, false, style = Stroke(this.size.width * 0.14f))
        drawArc(color, a, 270f, false, style = Stroke(this.size.width * 0.14f, cap = androidx.compose.ui.graphics.StrokeCap.Round))
    }
}

@Composable
fun Empty(text: String = "Здесь пока пусто", modifier: Modifier = Modifier) {
    Box(modifier.padding(24.dp), contentAlignment = Alignment.Center) {
        Text(text, style = MusixTheme.type.body.copy(fontSize = 13.sp, color = MusixTheme.colors.textSubtle))
    }
}

/** A round glass icon button (the header's search/settings, the player's collapse). */
@Composable
fun RoundGlassButton(onClick: () -> Unit, modifier: Modifier = Modifier, size: androidx.compose.ui.unit.Dp = 44.dp, content: @Composable () -> Unit) {
    val dark = MusixTheme.isDark
    val shape = androidx.compose.foundation.shape.CircleShape
    Box(
        modifier.size(size)
            .dropShadow(shape, Shadow(radius = 12.dp, color = if (dark) Color(0x80000000) else Color(0x292E2456), offset = DpOffset(0.dp, 4.dp)))
            .background(if (dark) Brush.verticalGradient(listOf(Color(0xFF26262D), Color(0xFF16161B))) else Brush.verticalGradient(listOf(Color.White, Color(0xFFE9E8EF))), shape)
            .innerShadow(shape, Shadow(radius = 0.dp, color = if (dark) Color(0x1FFFFFFF) else Color.White, offset = DpOffset(0.dp, 1.dp)))
            .pressable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) { content() }
}
