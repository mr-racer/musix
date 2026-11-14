package ru.musixai.app.feature.home

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
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
import ru.musixai.app.core.designsystem.component.FLY_MS
import ru.musixai.app.core.designsystem.component.LocalCoverFlight
import ru.musixai.app.core.designsystem.component.coverFlightTarget
import ru.musixai.app.core.player.PlayerState
import ru.musixai.app.core.player.QueueMode
import kotlin.math.abs

/**
 * r3 §5.5 «обложка улетает в мини-плеер», and r1 §5.4 for the вайбики: starting the album
 * of the day sends its cover to the mini-player, a vibe sends the cover of its first song;
 * pausing the album that plays already sends nothing. The page is 393×700 with the
 * mini-player's cover under it, as in the app.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "w448dp-h1000dp-xxhdpi")
class HomeFlightTest {
    @get:Rule val compose = createComposeRule()

    private val flight = CoverFlight()

    private fun home(player: PlayerState = PlayerState()) {
        compose.mainClock.autoAdvance = false
        compose.setContent {
            MusixTheme(true) {
                CompositionLocalProvider(LocalCoverFlight provides flight) {
                    Box(Modifier.fillMaxSize()) {
                        Column {
                            Box(Modifier.size(393.dp, 700.dp)) { HomeScreen(HomeUi(home = HomeFixtures.HOME, player = player), HomeActions()) }
                            Box(Modifier.padding(start = 10.dp, top = 9.dp).size(40.dp).coverFlightTarget(flight))
                        }
                        CoverFlightLayer(flight, reduced = false)
                    }
                }
            }
        }
        compose.mainClock.advanceTimeBy(500)
    }

    private fun copies() = compose.onAllNodesWithTag(CoverFlightTag).fetchSemanticsNodes()

    /** Taps, then steps the two frames that compose the copy: it is drawn at take-off. */
    private fun tap(click: () -> Unit) {
        click()
        repeat(3) { if (copies().isEmpty()) compose.mainClock.advanceTimeByFrame() }
    }

    private fun copy(): DpRect = compose.onNodeWithTag(CoverFlightTag).getBoundsInRoot()
    private fun same(want: DpRect, got: DpRect, msg: String) = assertTrue(
        "$msg: want $want, got $got",
        listOf(want.left - got.left, want.top - got.top, want.right - got.right, want.bottom - got.bottom).all { abs(it.value) <= 1f },
    )

    @Test fun listenSendsTheTicketsCoverToTheMiniPlayer() {
        home()
        val cover = compose.onNodeWithTag("ticket-cover", useUnmergedTree = true).getBoundsInRoot()
        tap { compose.onNodeWithContentDescription("3 из 11").performClick() }
        same(cover, copy(), "takes off from the ticket's cover")
        compose.mainClock.advanceTimeBy(FLY_MS + 80L)
        val c = copy()
        assertTrue("lands on the mini-player's cover: $c", abs((c.left + c.right).value / 2 - 30f) <= 1f && abs((c.top + c.bottom).value / 2 - 729f) <= 1f)
    }

    @Test fun pausingTheAlbumThatPlaysSendsNothing() {
        home(PlayerState(trackId = "d4", mode = QueueMode.LIST, isPlaying = true))
        tap { compose.onNodeWithContentDescription("3 из 11").performClick() }
        assertTrue("no copy: ${copies().size}", copies().isEmpty())
    }

    @Test fun aVibeSendsTheCoverOfItsFirstSong() {
        home()
        val cover = compose.onNodeWithTag("vibe-cover-v1", useUnmergedTree = true).getBoundsInRoot()
        tap { compose.onNodeWithText("Ночной синт-поп").performClick() }
        same(cover, copy(), "takes off from the first song's cover")
    }
}
