package ru.musixai.app.feature.home

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.dp
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.core.model.WavePreset

/** «Что играть» never splits a word across lines: on a phone where four segments are too
 *  narrow for «Незнакомое» (the emulator, 427 dp: «Незнакомо / е»), they stand 2 × 2. */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "w600dp-h900dp-xxhdpi")
class TunerPanelTest {
    @get:Rule val compose = createComposeRule()

    private fun lines(text: String): Int {
        val out = mutableListOf<TextLayoutResult>()
        compose.onNodeWithText(text, useUnmergedTree = true).performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(out) }
        return out.first().lineCount
    }

    private fun panel(width: Int) = compose.setContent {
        MusixTheme(true) { Box(Modifier.width(width.dp)) { TunerPanel(Tune(open = true, presets = PRESETS), {}, {}, {}) } }
    }

    @Test fun aPhonePanelKeepsEveryWordWhole() {
        panel(395)  // a 427 dp phone: the panel is the screen − 32
        assertEquals(1, lines("Незнакомое"))
        assertEquals(1, lines("Любимое"))
    }

    @Test fun aWidePanelStillFitsInARow() {
        panel(560)
        assertEquals(1, lines("Незнакомое"))
    }

    private companion object {
        val PRESETS = listOf(
            WavePreset("mix", "familiarity", "Микс"), WavePreset("favorites", "familiarity", "Любимое"),
            WavePreset("rediscover", "familiarity", "Давно не слушал"), WavePreset("unfamiliar", "familiarity", "Незнакомое"),
            WavePreset("calm", "sound", "Спокойное"), WavePreset("energetic", "sound", "Бодрое"),
        )
    }
}
