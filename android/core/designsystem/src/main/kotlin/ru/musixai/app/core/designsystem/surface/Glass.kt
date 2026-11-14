package ru.musixai.app.core.designsystem.surface

import android.content.res.Configuration
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.chrisbanes.haze.HazeInput
import dev.chrisbanes.haze.HazeState
import dev.chrisbanes.haze.glass.GlassStyle
import dev.chrisbanes.haze.glass.hazeGlass
import ru.musixai.app.core.designsystem.MusixTheme

/** Haze 2.1's clear glass, with its native optics and platform fallback intact.
 * Place over [GlassScene]'s captured background. No custom shader or animation loop. */
@Composable
fun LiquidGlass(
    modifier: Modifier = Modifier,
    radius: Dp = 22.dp,
    content: @Composable BoxScope.() -> Unit,
) {
    val source = LocalGlassSource.current ?: remember { HazeState() }
    val shape = remember(radius) { RoundedCornerShape(radius) }
    val style = remember(shape) { GlassStyle.clear.then { shape(shape) } }
    val input = remember(source) { HazeInput.Sources(source) }
    // Haze reads system configuration; MusiX also has an in-app theme.
    val dark = MusixTheme.isDark
    val configuration = LocalConfiguration.current
    val appearance = remember(configuration, dark) {
        Configuration(configuration).apply {
            uiMode = (uiMode and Configuration.UI_MODE_NIGHT_MASK.inv()) or
                (if (dark) Configuration.UI_MODE_NIGHT_YES else Configuration.UI_MODE_NIGHT_NO)
        }
    }
    CompositionLocalProvider(LocalConfiguration provides appearance) {
        Box(modifier.hazeGlass(input = input, style = style).clip(shape), content = content)
    }
}
