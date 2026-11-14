package ru.musixai.app.core.designsystem.motion

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.DpRect
import androidx.compose.ui.unit.dp
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import kotlin.math.abs

/**
 * A cover that starts playing flies into the mini-player's cover (r1's `flyToMini`, r3 §5.5):
 * a copy takes off from where the cover lay, lands on the mini-player's cover, which catches
 * it with a short pulse, and leaves — nothing is composed at rest. With no mini-player yet (a
 * cold start plays nothing) it aims at the dock, where the bar's cover is about to stand.
 * mdpi, so a px is a dp.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "w400dp-h800dp-mdpi")
class CoverFlightTest {
    @get:Rule val compose = createComposeRule()

    private val flight = CoverFlight()
    private lateinit var source: CoverSource
    private val from = Rect(30f, 300f, 102f, 372f) // a 72 dp cover on a screen, red
    private val mini = Rect(10f, 709f, 50f, 749f) // the mini-player's 40 dp cover
    private var miniShown by mutableStateOf(true)
    private var miniClip: Dp? = null // the bar rising: only this much of it shows yet
    private var miniSize = 40.dp

    private fun scene(reduced: Boolean = false) {
        compose.mainClock.autoAdvance = false
        compose.setContent {
            source = rememberCoverSource()
            Box(Modifier.fillMaxSize()) {
                Box(Modifier.offset(from.left.dp, from.top.dp).size(72.dp).coverSource(source).background(Color.Red))
                if (miniShown) {
                    val cover = Modifier.size(miniSize).coverFlightTarget(flight).background(Color.Blue)
                    val clip = miniClip
                    if (clip == null) Box(Modifier.offset(mini.left.dp, mini.top.dp).then(cover))
                    else Box(Modifier.offset(mini.left.dp, mini.top.dp).size(40.dp, clip).clipToBounds().wrapContentHeight(Alignment.Top, unbounded = true)) { Box(cover) }
                }
                CoverFlightLayer(flight, reduced = reduced)
            }
        }
        compose.mainClock.advanceTimeByFrame()
    }

    /** The first frame applies the state change, the next composes the copy (still at take-off). */
    private fun launch() {
        compose.runOnIdle { flight.launch(source, 12.dp) }
        repeat(3) { if (compose.onAllNodesWithTag(CoverFlightTag).fetchSemanticsNodes().isEmpty()) compose.mainClock.advanceTimeByFrame() }
    }

    private fun copy(): DpRect = compose.onNodeWithTag(CoverFlightTag).getBoundsInRoot()
    private fun DpRect.cx() = (left.value + right.value) / 2
    private fun DpRect.cy() = (top.value + bottom.value) / 2
    private fun DpRect.w() = right.value - left.value
    private fun near(want: Float, got: Float, msg: String, tol: Float = 1f) = assertTrue("$msg: want $want, got $got", abs(want - got) <= tol)

    @Test fun theCopyTakesOffFromTheCover() {
        scene()
        launch()
        val c = copy()
        near(from.center.x, c.cx(), "x")
        near(from.center.y, c.cy(), "y")
        near(from.width, c.w(), "width")
    }

    /** r1: «painted from the thumbnail's own pixels, so it is never blank» — no second load,
     *  no placeholder at take-off: the copy draws what the cover drew. */
    @Test fun theCopyIsTheCoversOwnPixels() {
        scene()
        launch()
        compose.mainClock.advanceTimeBy(120) // over the screen's white, half way down
        val img = compose.onNodeWithTag(CoverFlightTag).captureToImage().toPixelMap()
        assertEquals(Color.Red, img[img.width / 2, img.height / 2])
    }

    @Test fun theCopyLandsOnTheMiniPlayersCoverWhichCatchesItThenLeaves() {
        scene()
        launch()
        compose.mainClock.advanceTimeBy(200)
        val mid = copy()
        assertTrue("on its way down: ${mid.cy()}", mid.cy() > from.center.y + 1 && mid.cy() < mini.center.y - 1)
        assertTrue("shrinking: ${mid.w()}", mid.w() < from.width - 1 && mid.w() > mini.width + 1)
        compose.mainClock.advanceTimeBy(FLY_MS - 200L + 80) // the catch swells most ~50 ms in
        val caught = copy()
        near(mini.center.x, caught.cx(), "landed x")
        near(mini.center.y, caught.cy(), "landed y")
        assertTrue("the catch swells it: ${caught.w()}", caught.w() > mini.width + 2)
        compose.mainClock.advanceTimeBy(CATCH_MS + 100L)
        compose.onNodeWithTag(CoverFlightTag).assertDoesNotExist()
    }

    @Test fun withoutAMiniPlayerItAimsAtTheDock() {
        miniShown = false
        scene()
        compose.runOnIdle { flight.dock = mini }
        launch()
        compose.mainClock.advanceTimeBy(FLY_MS + 120L)
        near(mini.center.x, copy().cx(), "x")
        near(mini.center.y, copy().cy(), "y")
    }

    @Test fun aMiniPlayerShownMidFlightTakesTheAim() {
        miniShown = false
        scene()
        compose.runOnIdle { flight.dock = Rect(10f, 640f, 50f, 680f) } // a guess 69 dp off
        launch()
        compose.mainClock.advanceTimeBy(150)
        miniShown = true
        compose.mainClock.advanceTimeBy(FLY_MS + 120L - 150)
        near(mini.center.y, copy().cy(), "y")
    }

    @Test fun withNowhereToLandNothingFlies() {
        miniShown = false
        scene()
        launch()
        compose.onNodeWithTag(CoverFlightTag).assertDoesNotExist()
    }

    @Test fun reducedMotionSendsNothing() {
        scene(reduced = true)
        launch()
        compose.onNodeWithTag(CoverFlightTag).assertDoesNotExist()
    }

    @Test fun theFlightRunsBetweenTheTwoRects() {
        assertEquals(from, flightRect(from, mini, 0f))
        assertEquals(mini, flightRect(from, mini, 1f))
        val half = flightRect(from, mini, 0.5f)
        assertEquals(Rect(20f, 504.5f, 76f, 560.5f), half)
    }

    /** The bar rises from nothing (MiniPlayerSlot): its cover is laid out whole while the clip
     *  around it still shows none of it — the owner's emulator, 2026-11-14, crashed on a NaN
     *  corner there. The aim is the cover itself, not the part of it that shows yet. */
    @Test fun aCoverStillClippedAwayIsAimedAtWhole() {
        miniClip = 0.dp
        scene()
        launch()
        compose.mainClock.advanceTimeBy(FLY_MS + 80L)
        val caught = copy()
        near(mini.center.x, caught.cx(), "landed x")
        near(mini.center.y, caught.cy(), "landed y")
        assertTrue("caught whole: ${caught.w()}", caught.w() > mini.width + 2)
    }

    /** A cover of no size yet is nowhere to land well, but no frame of the copy may break. */
    @Test fun aCoverOfNoSizeBreaksNothing() {
        miniSize = 0.dp
        scene()
        launch()
        compose.mainClock.advanceTimeBy(FLY_MS + CATCH_MS + 100L)
        compose.onNodeWithTag(CoverFlightTag).assertDoesNotExist()
    }
}
