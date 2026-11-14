package ru.musixai.app.core.designsystem.content

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.core.designsystem.control.Pill
import ru.musixai.app.core.designsystem.gesture.rememberDebounced
import ru.musixai.app.core.designsystem.motion.Leave
import ru.musixai.app.core.designsystem.motion.rememberReducedMotion
import ru.musixai.app.core.designsystem.text

/** What a screen (or a block of one) has to show. */
sealed interface ScreenState<out T> {
    data object Loading : ScreenState<Nothing>
    data class Ready<T>(val value: T) : ScreenState<T>
    data class Empty(val text: String = "Здесь пока пусто") : ScreenState<Nothing>
    data class Failed(val text: String = "Не получилось загрузить") : ScreenState<Nothing>
}

/**
 * «Состояния» (2026-11-14 spec §6, №30): one place for loading, empty, failed and ready, so no
 * screen invents its own. The kinds cross-fade (in 220, out 140 on the leaving curve); new data
 * of the same kind replaces the old in place, without a flash. «Повторить» is debounced — a
 * double tap sends one request.
 */
@Composable
fun <T> StateHost(
    state: ScreenState<T>,
    modifier: Modifier = Modifier,
    onRetry: (() -> Unit)? = null,
    loading: @Composable () -> Unit = { Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) { Spinner(24.dp) } },
    content: @Composable (T) -> Unit,
) {
    val reduced = rememberReducedMotion()
    val retry = onRetry?.let { rememberDebounced(action = it) }
    AnimatedContent(
        targetState = state,
        modifier = modifier,
        contentKey = { it::class },
        transitionSpec = {
            if (reduced) EnterTransition.None togetherWith ExitTransition.None
            else fadeIn(tween(220, delayMillis = 60)) togetherWith fadeOut(tween(140, easing = Leave))
        },
        label = "state",
    ) { s ->
        when (s) {
            ScreenState.Loading -> loading()
            is ScreenState.Ready -> content(s.value)
            is ScreenState.Empty -> Empty(s.text, Modifier.fillMaxWidth())
            is ScreenState.Failed -> Column(
                Modifier.fillMaxWidth().padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Text(s.text, style = MusixTheme.text.body.copy(color = MusixTheme.colors.textMuted), textAlign = TextAlign.Center)
                if (retry != null) Pill("Повторить", onClick = retry)
            }
        }
    }
}
