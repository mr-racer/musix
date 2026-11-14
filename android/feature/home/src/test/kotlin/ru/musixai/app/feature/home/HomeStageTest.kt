package ru.musixai.app.feature.home

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.unit.dp
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.core.designsystem.LocalStageHeight
import kotlin.math.abs

/**
 * The mini-player is open — no strip of its own, it lies on the scene (the accepted phone
 * look, `.mini` over the page) — so the home's sky goes on under it down to the tab bar,
 * with no seam where the page ends (the emulator, 2026-11-14: the shell's lighter ground
 * showed there as a band). The shell's ground is red here, so any of it shows. mdpi: px = dp.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "w393dp-h800dp-mdpi")
class HomeStageTest {
    @get:Rule val compose = createComposeRule()

    @Test fun theSkyGoesOnUnderTheMiniPlayerWithoutASeam() {
        compose.setContent {
            MusixTheme(false) {
                CompositionLocalProvider(LocalStageHeight provides 766) {
                    Column(Modifier.fillMaxSize().background(Color.Red)) {
                        Box(Modifier.size(393.dp, 700.dp).testTag("page")) { HomeScreen(HomeUi(home = HomeFixtures.HOME), HomeActions()) }
                        Box(Modifier.size(393.dp, 66.dp).testTag("bar")) // the open bar: draws nothing here
                    }
                }
            }
        }
        compose.mainClock.advanceTimeBy(2_000)
        val page = compose.onNodeWithTag("page").captureToImage().toPixelMap()
        val bar = compose.onNodeWithTag("bar").captureToImage().toPixelMap()
        for (x in listOf(4, 196, 388)) {
            val above = page[x, 697] // the page's bottom margin: sky
            for (y in listOf(2, 33, 63)) {
                val under = bar[x, y]
                val seam = maxOf(abs(above.red - under.red), abs(above.green - under.green), abs(above.blue - under.blue))
                assertTrue("($x, $y) under the bar: $under, the sky above it: $above", seam <= 0.02f)
            }
        }
    }
}
