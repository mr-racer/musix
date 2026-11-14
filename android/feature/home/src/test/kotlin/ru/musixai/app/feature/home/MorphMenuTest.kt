package ru.musixai.app.feature.home

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.unit.dp
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import ru.musixai.app.core.designsystem.MusixTheme
import kotlin.math.abs
import ru.musixai.app.core.designsystem.surface.MorphMenu
import ru.musixai.app.core.designsystem.surface.rememberMorph

/**
 * The search's way back (the owner, 2026-11-14: «резко превращается из белого в прозрачный»):
 * the panel shrinks into the bare round button and its white dissolves on the way, so the
 * spot inside the button but off the glyph goes back to the page frame by frame. mdpi: px = dp.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "w393dp-h800dp-mdpi")
class MorphMenuTest {
    @get:Rule val compose = createComposeRule()

    private var open by mutableStateOf(true)

    private fun page() {
        compose.mainClock.autoAdvance = false
        compose.setContent {
            MusixTheme(false) {
                val morph = rememberMorph(open, reduced = false)
                Box(Modifier.fillMaxSize().background(Color.Black).testTag("page")) {
                    // the bare button under the overlay: no surface of its own
                    Box(Modifier.offset(300.dp, 20.dp).size(40.dp).graphicsLayer { alpha = morph.anchorAlpha })
                    MorphMenu(morph, Rect(300f, 20f, 340f, 60f), onClose = { open = false }, radiusFrom = 20.dp, scrim = 0f) {
                        Box(Modifier.fillMaxWidth().height(120.dp))
                    }
                }
            }
        }
        compose.mainClock.advanceTimeBy(1_500)
    }

    /** Inside the round button, off its glyph: the sRGB value, which is close to how bright the
     *  eye sees it (a linear luminance would exaggerate the first steps from white). */
    private fun spot(): Float = compose.onNodeWithTag("page").captureToImage().toPixelMap()[306, 40].red

    @Test fun theOpenPanelIsWhite() {
        page()
        assertEquals(1f, spot(), 0.02f)
    }

    @Test fun closingDissolvesThePanelInsteadOfDroppingIt() {
        page()
        open = false
        var last = spot()
        repeat(90) { i ->
            compose.mainClock.advanceTimeByFrame()
            val now = spot()
            assertTrue("frame $i: $last → $now", abs(now - last) <= 0.2f)  // at least five frames of melt
            last = now
        }
        assertEquals("the page again", 0f, last, 0.02f)
    }
}
