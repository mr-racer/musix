package ru.musixai.app.feature.player

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.DpRect
import androidx.compose.ui.unit.dp
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.core.designsystem.component.CoverFlight
import ru.musixai.app.core.designsystem.component.CoverFlightLayer
import ru.musixai.app.core.designsystem.component.CoverFlightTag
import ru.musixai.app.core.designsystem.component.CoverSource
import ru.musixai.app.core.designsystem.component.FLY_MS
import ru.musixai.app.core.designsystem.component.LocalCoverFlight
import ru.musixai.app.core.designsystem.component.coverSource
import ru.musixai.app.core.designsystem.component.rememberCoverSource
import ru.musixai.app.core.player.PlayerState
import kotlin.math.abs

/**
 * The mini-player's side of the cover flight (r3 §5.5): its cover is where covers land, and
 * before it is shown (a cold start) the shell's dock guess is exactly where it will stand.
 * mdpi, so a px is a dp.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "w393dp-h800dp-mdpi")
class MiniPlayerFlightTest {
    @get:Rule val compose = createComposeRule()

    private val flight = CoverFlight()
    private lateinit var source: CoverSource

    private fun shell() {
        compose.mainClock.autoAdvance = false
        compose.setContent {
            source = rememberCoverSource()
            MusixTheme(true) {
                CompositionLocalProvider(LocalCoverFlight provides flight) {
                    Box(Modifier.fillMaxSize()) {
                        Column(Modifier.fillMaxSize()) {
                            Box(Modifier.weight(1f).fillMaxWidth())
                            MiniPlayerBar(PlayerState(trackId = "t1", title = "Песня", artist = "Артист"), {}, {}, {}, {})
                            Box(Modifier.fillMaxWidth().height(64.dp).testTag("tabs"))
                        }
                        Box(Modifier.offset(100.dp, 200.dp).size(72.dp).coverSource(source)) // a cover on a screen
                        CoverFlightLayer(flight, reduced = false)
                    }
                }
            }
        }
        compose.mainClock.advanceTimeBy(100)
    }

    private fun cover(): DpRect = compose.onNodeWithTag(MiniCoverTag, useUnmergedTree = true).getBoundsInRoot()
    private fun near(want: Float, got: Float, msg: String) = assertTrue("$msg: want $want, got $got", abs(want - got) <= 0.5f)

    @Test fun theDockGuessIsWhereTheBarsCoverStands() {
        shell()
        val tabs = compose.onNodeWithTag("tabs").getBoundsInRoot()
        val guess = miniPlayerCoverAbove(tabs.top.value, Density(1f))
        val c = cover()
        near(c.left.value, guess.left, "left")
        near(c.top.value, guess.top, "top")
        near(c.right.value, guess.right, "right")
        near(c.bottom.value, guess.bottom, "bottom")
    }

    @Test fun coversLandOnTheBarsCover() {
        shell()
        val c = cover()
        compose.runOnIdle { flight.launch(source, 12.dp) }
        // a paused clock jumps an idle stretch: step the two frames that compose the copy first
        repeat(3) { if (compose.onAllNodesWithTag(CoverFlightTag).fetchSemanticsNodes().isEmpty()) compose.mainClock.advanceTimeByFrame() }
        compose.mainClock.advanceTimeBy(FLY_MS + 80L)
        val copy = compose.onNodeWithTag(CoverFlightTag).getBoundsInRoot()
        near((c.left.value + c.right.value) / 2, (copy.left.value + copy.right.value) / 2, "x")
        near((c.top.value + c.bottom.value) / 2, (copy.top.value + copy.bottom.value) / 2, "y")
    }
}
