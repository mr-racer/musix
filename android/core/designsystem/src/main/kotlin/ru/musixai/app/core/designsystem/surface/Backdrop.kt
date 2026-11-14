package ru.musixai.app.core.designsystem.surface

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import dev.chrisbanes.haze.HazeState
import dev.chrisbanes.haze.hazeSource
import ru.musixai.app.core.designsystem.MusixTheme

internal val LocalGlassSource = staticCompositionLocalOf<HazeState?> { null }

/** Capture only the backdrop, as a sibling of the glass, never its own foreground.
 * Cover art can be supplied as [background] when the phone player is ported. */
@Composable
fun GlassScene(
    modifier: Modifier = Modifier,
    background: @Composable BoxScope.() -> Unit = {
        Box(Modifier.matchParentSize().background(MusixTheme.colors.bg))
    },
    content: @Composable BoxScope.() -> Unit,
) {
    val source = remember { HazeState() }
    Box(modifier) {
        Box(Modifier.matchParentSize().hazeSource(source), content = background)
        CompositionLocalProvider(LocalGlassSource provides source) { content() }
    }
}
