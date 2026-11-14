package ru.musixai.app.feature.home

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.github.takahirom.roborazzi.captureRoboImage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.core.model.Home
import kotlin.math.abs

/**
 * r3 «Сцена» §3: the hero takes the free height, so on every page the album of the day sits
 * 12 dp above the bottom (the mini-player in the app), the orb stays inside the hero and
 * nothing overlaps. Page = the window minus the status bar, the mini-player and the tab bar.
 * The screenshots (fake data, `recordRoborazziDebug`) are for the eye, not asserted.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "w448dp-h1000dp-xxhdpi")
class HomeLayoutTest {
    @get:Rule val compose = createComposeRule()

    private fun page(w: Int, h: Int, dark: Boolean = true, home: Home = HOME) {
        compose.mainClock.autoAdvance = false
        compose.setContent {
            MusixTheme(dark) { Box(Modifier.size(w.dp, h.dp)) { HomeScreen(HomeUi(home = home), HomeActions()) } }
        }
        compose.mainClock.advanceTimeBy(500)
        compose.onRoot().captureRoboImage("build/outputs/roborazzi/home-r3-${w}x$h${if (dark) "" else "-light"}.png")

        val hero = compose.onNodeWithTag("home-hero").getBoundsInRoot()
        val orb = compose.onNodeWithTag("home-orb").getBoundsInRoot()
        val vibes = compose.onNodeWithTag("home-vibes").getBoundsInRoot()
        val ticket = compose.onNodeWithTag("home-ticket").getBoundsInRoot()
        close(h.dp - 12.dp, ticket.bottom, "the ticket sits 12 dp above the bottom at ${w}x$h")
        assertTrue("the orb fits the hero at ${w}x$h: $orb in $hero", orb.top >= hero.top - TOL && orb.bottom <= hero.bottom + TOL)
        val capsule = compose.onNodeWithTag("home-capsule").getBoundsInRoot()
        assertTrue("the capsule fits the hero at ${w}x$h: $capsule in $hero", capsule.top >= hero.top - TOL && capsule.bottom <= hero.bottom + TOL)
        assertTrue("the vibes end above the ticket at ${w}x$h", vibes.bottom <= ticket.top + TOL)
        assertTrue("the hero is below the phrase at ${w}x$h", hero.top >= 48.dp + 22.dp)
        // the chips scroll edge to edge (not cut at the column's 16 dp), and keep their slot
        val scroll = compose.onNodeWithTag("home-vibes-scroll").getBoundsInRoot()
        close(0.dp, scroll.left, "the vibes scroll from the left edge at ${w}x$h")
        close(w.dp, scroll.right, "the vibes scroll to the right edge at ${w}x$h")
        close(48.dp, vibes.bottom - vibes.top, "the vibes row stays 48 high at ${w}x$h")
    }

    private fun close(want: Dp, got: Dp, msg: String) = assertTrue("$msg: want $want, got $got", abs((want - got).value) <= TOL.value)

    @Test fun compactPage() = page(360, 460)
    @Test fun smallRowPage() = page(360, 560)
    @Test fun rowPage() = page(393, 640)
    @Test fun columnPage() = page(411, 700)
    @Test fun tallColumnPage() = page(448, 820)
    @Test fun lightTheme() = page(393, 640, dark = false)

    /** A tall page has the room: the server's long vibe phrase shows whole, on three lines. */
    @Test fun aLongPhraseShowsWholeOnATallPage() {
        page(427, 830, home = HOME.copy(wavePhrase = "От пульса старого рока и синтипопа к электронному биту — громкий вечер в синтетике"))
        val out = mutableListOf<TextLayoutResult>()
        compose.onNodeWithTag("home-phrase", useUnmergedTree = true).performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(out) }
        val r = out.first()
        val lines = (0 until r.lineCount).map { r.layoutInput.text.text.substring(r.getLineStart(it), r.getLineEnd(it, visibleEnd = true)) }
        assertFalse("the phrase is cut: $lines", r.hasVisualOverflow)
    }

    /** On a tall page the hero is a centred column: the orb on the page's axis. */
    @Test fun theColumnIsCentred() {
        page(411, 700)
        val orb = compose.onNodeWithTag("home-orb").getBoundsInRoot()
        close(411.dp / 2, (orb.left + orb.right) / 2, "the orb's centre")
        assertEquals(HeroForm.Column, heroSpec(700f).form)
    }

    /** [COLUMN_TEXT] is what the column really spends under the orb: title and capsule. */
    @Test fun theColumnTextFitsItsAllowance() {
        page(411, 700)
        val orb = compose.onNodeWithTag("home-orb").getBoundsInRoot()
        val capsule = compose.onNodeWithTag("home-capsule").getBoundsInRoot()
        assertTrue("under the orb: ${capsule.bottom - orb.bottom}, allowed $COLUMN_TEXT", (capsule.bottom - orb.bottom).value <= COLUMN_TEXT + TOL.value)
    }

    /** A row page whose hero has the room (here ~243 dp) stands the hero up as a column,
     *  rather than a 104 dp orb in a row with empty sky above and below it. */
    @Test fun aRowPageWithRoomStandsUp() {
        page(393, 640)
        val orb = compose.onNodeWithTag("home-orb").getBoundsInRoot()
        close(393.dp / 2, (orb.left + orb.right) / 2, "the orb's centre")
        close(120.dp, orb.right - orb.left, "the orb")
    }

    private companion object {
        val TOL = 0.5.dp
        val HOME = HomeFixtures.HOME
    }
}
