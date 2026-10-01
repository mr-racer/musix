package ru.musixai.app.core.designsystem

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import kotlin.math.cos
import kotlin.math.sin

/** The v1 font stacks (styles.css): Geist is the body AND the `.mono` label voice; Noto Sans
 *  is `.serif`; Lora (was Noto Serif Display) / Playfair are display; JetBrains Mono only for code. */
object MusixFontFamilies {
    val Sans = FontFamily(
        Font(R.font.noto_sans_400, FontWeight.Normal), Font(R.font.noto_sans_400_italic, FontWeight.Normal, FontStyle.Italic),
        Font(R.font.noto_sans_500, FontWeight.Medium), Font(R.font.noto_sans_600, FontWeight.SemiBold),
        Font(R.font.noto_sans_700, FontWeight.Bold),
    )
    val Geist = FontFamily(
        Font(R.font.geist_400, FontWeight.Normal), Font(R.font.geist_500, FontWeight.Medium),
        Font(R.font.geist_600, FontWeight.SemiBold), Font(R.font.geist_700, FontWeight.Bold),
    )
    /** The italic caption voice (the vibe line, the AI's small lines, the login head). Lora since
     *  2026-10-02: Noto Serif Display Light was unreadable at caption sizes (the owner's call). */
    val SerifDisplay = FontFamily(
        Font(R.font.lora_400_italic, FontWeight.Light, FontStyle.Italic),
        Font(R.font.lora_400_italic, FontWeight.Normal, FontStyle.Italic),
        Font(R.font.lora_500_italic, FontWeight.Medium, FontStyle.Italic),
        Font(R.font.lora_400, FontWeight.Normal),
        Font(R.font.lora_500, FontWeight.Medium),
    )
    val Playfair = FontFamily(
        Font(R.font.playfair_display_400, FontWeight.Normal), Font(R.font.playfair_display_500, FontWeight.Medium),
        Font(R.font.playfair_display_600, FontWeight.SemiBold),
        Font(R.font.playfair_display_400_italic, FontWeight.Normal, FontStyle.Italic),
        Font(R.font.playfair_display_500_italic, FontWeight.Medium, FontStyle.Italic),
    )
    val Mono = FontFamily(
        Font(R.font.jetbrains_mono_400, FontWeight.Normal), Font(R.font.jetbrains_mono_500, FontWeight.Medium),
        Font(R.font.jetbrains_mono_600, FontWeight.SemiBold),
    )
}

@Immutable
data class MusixType(
    val body: TextStyle = TextStyle(fontFamily = MusixFontFamilies.Geist, fontSize = 14.sp, lineHeight = 1.5.em),
    /** `.serif`: Noto Sans, -0.01em (long-form text: facts, bios, lyrics). */
    val serif: TextStyle = TextStyle(fontFamily = MusixFontFamilies.Sans, fontSize = 14.sp, lineHeight = 1.55.em, letterSpacing = (-0.01).em),
    val label: TextStyle = TextStyle(fontFamily = MusixFontFamilies.Geist, fontWeight = FontWeight.Medium, fontSize = 13.sp),
    /** `.mono` eyebrows: uppercase, wide tracking (login «ОБЩИЙ СЕРВЕР», section labels). */
    val eyebrow: TextStyle = TextStyle(fontFamily = MusixFontFamilies.Geist, fontWeight = FontWeight.Medium, fontSize = 10.sp,
        letterSpacing = 0.24.em),
    val display: TextStyle = TextStyle(fontFamily = MusixFontFamilies.SerifDisplay, fontStyle = FontStyle.Italic,
        fontWeight = FontWeight.Light, fontSize = 30.sp, lineHeight = 1.12.em, letterSpacing = (-0.015).em),
    val title: TextStyle = TextStyle(fontFamily = MusixFontFamilies.Playfair, fontWeight = FontWeight.Medium, fontSize = 22.sp),
    /** `.mono`: the tracked-caps label voice — Geist 500 (no longer a monospace, v1 styles.css l. 22). */
    val mono: TextStyle = TextStyle(fontFamily = MusixFontFamilies.Geist, fontWeight = FontWeight.Medium, fontSize = 12.sp),
    val code: TextStyle = TextStyle(fontFamily = MusixFontFamilies.Mono, fontSize = 12.sp),
)

val LocalMusixType = staticCompositionLocalOf { MusixType() }
val LocalIsDark = staticCompositionLocalOf { true }

object MusixTheme {
    val colors: MusixColors @Composable @ReadOnlyComposable get() = LocalMusixColors.current
    val type: MusixType @Composable @ReadOnlyComposable get() = LocalMusixType.current
    val isDark: Boolean @Composable @ReadOnlyComposable get() = LocalIsDark.current
}

/** The app theme: the generated token colors, v1's type, Material only underneath (for the
 *  primitives the design does not override — ripples, text selection, system bars). */
@Composable
fun MusixTheme(dark: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    val c = if (dark) DarkMusixColors else LightMusixColors
    val scheme = (if (dark) darkColorScheme() else lightColorScheme()).copy(
        primary = c.accent, background = c.bg, surface = c.surface, onBackground = c.text, onSurface = c.text,
    )
    CompositionLocalProvider(LocalMusixColors provides c, LocalMusixType provides MusixType(), LocalIsDark provides dark) {
        MaterialTheme(colorScheme = scheme, content = content)
    }
}

/** A CSS `linear-gradient(<angle>deg, …)` as a Compose brush over a box of [w]×[h]. */
fun MusixGradient.brush(w: Float, h: Float): Brush {
    val a = Math.toRadians(angleDeg.toDouble())
    // CSS: 0deg points up, angles run clockwise; the line spans the box's projection
    val dx = sin(a).toFloat()
    val dy = -cos(a).toFloat()
    val half = (kotlin.math.abs(w * dx) + kotlin.math.abs(h * dy)) / 2
    val cx = w / 2
    val cy = h / 2
    return Brush.linearGradient(colors, start = Offset(cx - dx * half, cy - dy * half), end = Offset(cx + dx * half, cy + dy * half))
}
