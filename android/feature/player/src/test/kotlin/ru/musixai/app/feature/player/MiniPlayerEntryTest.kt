package ru.musixai.app.feature.player

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshots.Snapshot
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.height
import androidx.compose.ui.unit.width
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.core.designsystem.motion.CoverFlight
import ru.musixai.app.core.designsystem.motion.CoverFlightLayer
import ru.musixai.app.core.designsystem.motion.CoverFlightTag
import ru.musixai.app.core.designsystem.motion.FLY_MS
import ru.musixai.app.core.designsystem.motion.CoverSource
import ru.musixai.app.core.designsystem.motion.LocalCoverFlight
import ru.musixai.app.core.designsystem.motion.coverSource
import ru.musixai.app.core.designsystem.motion.rememberCoverSource
import ru.musixai.app.core.player.PlayerState

/**
 * The mini-player in the accepted phone look (the owner, 2026-11-14: «появляется резко»): a
 * song from silence makes the bar rise from under the screen while the page above eases up to
 * make room, then the cover pops in — unless a cover is flying in, which is its entrance.
 * mdpi, so a px is a dp.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "w393dp-h800dp-mdpi")
class MiniPlayerEntryTest {
    @get:Rule val compose = createComposeRule()

    private val flight = CoverFlight()
    private lateinit var source: CoverSource
    private var state by mutableStateOf(PlayerState())

    private fun shell() {
        compose.mainClock.autoAdvance = false
        compose.setContent {
            source = rememberCoverSource()
            MusixTheme(true) {
                CompositionLocalProvider(LocalCoverFlight provides flight) {
                    Box(Modifier.fillMaxSize()) {
                        Column(Modifier.fillMaxSize()) {
                            Box(Modifier.weight(1f).fillMaxWidth().testTag("page"))
                            MiniPlayerSlot(state, {}, {}, {}, reduced = false)
                            Box(Modifier.fillMaxWidth().height(64.dp))
                        }
                        Box(Modifier.offset(100.dp, 200.dp).size(72.dp).coverSource(source))
                        CoverFlightLayer(flight, reduced = false)
                    }
                }
            }
        }
        compose.mainClock.advanceTimeBy(100)
    }

    private fun page() = compose.onNodeWithTag("page").getBoundsInRoot().height.value
    private fun cover() = compose.onNodeWithTag(MiniCoverTag, useUnmergedTree = true).getBoundsInRoot().width.value
    private val song = PlayerState(trackId = "t1", title = "Песня", artist = "Артист")

    /** A song starts: the write reaches the composition before the next frame (the clock is paused). */
    private fun play() { state = song; Snapshot.sendApplyNotifications() }

    @Test fun thePageMakesRoomStepByStep() {
        shell()
        val full = page()
        play()
        val heights = List(60) { compose.mainClock.advanceTimeByFrame(); page() }
        val bar = full - heights.last()
        assertTrue("the bar took $bar", bar >= 56f)
        (listOf(full) + heights).zipWithNext().forEachIndexed { i, (a, b) ->
            assertTrue("frame $i: the page jumped $a → $b", a - b <= bar / 3)
        }
    }

    @Test fun theBarHasPlayAndNextButNoPrevious() {
        shell()
        play()
        compose.mainClock.advanceTimeBy(1_000)
        compose.onNodeWithContentDescription("Назад").assertDoesNotExist()
        compose.onNodeWithContentDescription("Дальше").assertExists()
        compose.onNodeWithContentDescription("Воспроизвести").assertExists()
    }

    @Test fun theCoverPopsInAfterTheBar() {
        shell()
        play()
        compose.mainClock.advanceTimeBy(260)
        assertTrue("mid-pop ${cover()}", cover() < 40f)
        compose.mainClock.advanceTimeBy(1_000)
        assertEquals(42f, cover(), 0.5f)
    }

    @Test fun aCoverFlyingInIsTheCoversEntrance() {
        shell()
        flight.dock = Rect(10f, 600f, 52f, 642f)  // a cold start: no bar yet, the dock guess
        compose.runOnIdle { flight.launch(source, 12.dp) }
        repeat(3) { compose.mainClock.advanceTimeByFrame() }
        play()
        compose.mainClock.advanceTimeBy(260)
        assertEquals("no pop under a flying cover", 42f, cover(), 0.5f)
    }

    /** A cover flying in heads for where the bar's cover will rest — the dock — and meets
     *  the bar there as it rises; it does not chase the cover on its way up from under the
     *  screen, down over the tab bar (the emulator, 2026-11-14: the song reached the bar
     *  ~300 ms into the flight and the copy dove after the cover, 132 dp below its rest). */
    @Test fun aCoverFlyingInHeadsForWhereTheBarsCoverWillRest() {
        shell()
        val rest = miniPlayerCoverAbove(736f, Density(1f)) // over the 64 dp tab bar of an 800 dp screen
        flight.dock = rest
        compose.runOnIdle { flight.launch(source, 12.dp) }
        repeat(((FLY_MS + 80) / 16)) { i ->
            if (i == 18) play() // the player answers late, the copy most of the way down already
            compose.mainClock.advanceTimeByFrame()
            val c = compose.onAllNodesWithTag(CoverFlightTag).fetchSemanticsNodes().firstOrNull()?.boundsInRoot ?: return@repeat
            assertTrue("frame $i: the copy dipped to ${c.center.y}, the cover rests at ${rest.center.y}", c.center.y <= rest.center.y + 1f)
        }
        val c = compose.onNodeWithTag(CoverFlightTag).getBoundsInRoot()
        assertEquals("landed", rest.center.y, (c.top + c.bottom).value / 2, 1f)
    }
}
