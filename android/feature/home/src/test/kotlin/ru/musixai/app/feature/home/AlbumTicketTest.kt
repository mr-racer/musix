package ru.musixai.app.feature.home

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshots.Snapshot
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.height
import androidx.compose.ui.unit.width
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
import ru.musixai.app.core.model.DayAlbum
import ru.musixai.app.core.model.DayTrack
import java.time.LocalDate
import kotlin.math.abs

/** r3 §5.4 on a 360 dp phone (the ticket is 328 wide): the phrase is two lines, never an
 *  ellipsis — a phrase that does not fit is left out; the progress caption is one line; the
 *  title steps down to two lines before an ellipsis, its edition goes to the grey line; after
 *  «Слушать» the button gives its place to the beads while the album is in the player. */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "w360dp-h800dp-xxhdpi")
class AlbumTicketTest {
    @get:Rule val compose = createComposeRule()

    private fun layout(tag: String): TextLayoutResult {
        val out = mutableListOf<TextLayoutResult>()
        compose.onNodeWithTag(tag, useUnmergedTree = true).performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(out) }
        return out.first()
    }

    private var slot by mutableLongStateOf(0L)
    private var inPlayer by mutableStateOf(false)
    private var listened = 0
    private var shown by mutableStateOf<DayAlbum?>(null)

    /** The first call sets the content; the next ones swap the album in place. */
    private fun show(day: DayAlbum, dense: Boolean = true) {
        val first = shown == null
        shown = day
        if (!first) { compose.waitForIdle(); return }
        compose.setContent {
            MusixTheme(true) {
                Box(Modifier.width(328.dp).background(Color.Black)) {
                    AlbumTicket(shown!!, null, dense = dense, extraHeard = emptySet(), albumPlaying = inPlayer, isPlaying = false,
                        currentTrackId = null, reduced = true, onListen = { listened++ }, onOpen = {}, phraseSlot = slot,
                        modifier = Modifier.testTag("ticket"))
                }
            }
        }
    }

    // every three hours the next phrase: 24 slots go round every phrase of a kind
    @Test fun everyOnePhraseFitsTwoLines() = slotsThrough("one")
    @Test fun everyLongPhraseFitsTwoLines() = slotsThrough("long")
    @Test fun everyNeverPhraseFitsTwoLines() = slotsThrough("never")

    private fun slotsThrough(kind: String) {
        show(day(kind))
        repeat(24) { i ->
            slot = i.toLong()
            compose.waitForIdle()
            val l = layout("ticket-phrase")
            assertFalse("phrase $i overflows: ${l.layoutInput.text}", l.hasVisualOverflow)
        }
    }

    @Test fun thePhraseHasNoShuffleButton() {
        show(day("one"))
        compose.onNodeWithContentDescription("Другая фраза").assertDoesNotExist()
    }

    @Test fun theProgressCaptionIsOneLine() {
        show(day("one", heard = 3))
        val l = layout("ticket-caption")
        assertEquals("caption: ${l.layoutInput.text}", 1, l.lineCount)
        assertFalse(l.hasVisualOverflow)
    }

    @Test fun aShortTitleIsOneLine() {
        show(day("one"), dense = false)
        assertEquals(1, layout("ticket-title").lineCount)
    }

    @Test fun aLongTitleTakesTwoLinesInsteadOfAnEllipsis() {
        show(day("one", title = "Где-то между небом и землёй, ночью над рекой"), dense = false)
        val l = layout("ticket-title")
        assertEquals(l.layoutInput.text.text, 2, l.lineCount)
        assertFalse("cut: ${l.layoutInput.text}", l.hasVisualOverflow)
    }

    @Test fun aTwoLineTitleKeepsTheCardsHeight() {
        show(day("one"), dense = false)
        val short = compose.onNodeWithTag("ticket").getBoundsInRoot().height
        show(day("one", title = "Где-то между небом и землёй, ночью над рекой"), dense = false)
        val long = compose.onNodeWithTag("ticket").getBoundsInRoot().height
        assertTrue("short $short, long $long", abs((long - short).value) <= 0.5f)
    }

    @Test fun theEditionGoesToTheGreyLine() {
        show(day("one", title = "Мракобесие и джаз (Deluxe Edition)"), dense = false)
        assertEquals("Мракобесие и джаз", layout("ticket-title").layoutInput.text.text)
        assertEquals("Агата Кристи · 1997 · Deluxe Edition", layout("ticket-meta").layoutInput.text.text)
    }

    @Test fun listenGivesTheButtonsPlaceToTheBeads() {
        show(day("one"))
        compose.mainClock.autoAdvance = false  // the player has not taken the album yet: 1 s later
        compose.onNodeWithTag("ticket-listen").performClick()
        Snapshot.sendApplyNotifications()
        compose.mainClock.advanceTimeBy(1_000)
        assertEquals(1, listened)
        compose.onNodeWithTag("ticket-listen").assertDoesNotExist()
        val beads = compose.onNodeWithContentDescription("Услышано 0 из 11").getBoundsInRoot()
        assertTrue("beads ${beads.width}", beads.width.value >= 300f)
    }

    @Test fun whileTheAlbumIsInThePlayerItHasNoButton() {
        inPlayer = true  // paused: the mini-player has the play button
        show(day("one", heard = 3))
        compose.waitForIdle()
        compose.onNodeWithTag("ticket-listen").assertDoesNotExist()
    }

    @Test fun anotherQueueBringsTheButtonBackAsContinue() {
        show(day("one", heard = 3))
        compose.onNodeWithTag("ticket-listen").performClick()
        inPlayer = true
        compose.waitForIdle()
        compose.onNodeWithTag("ticket-listen").assertDoesNotExist()
        inPlayer = false  // the wave took over
        compose.waitForIdle()
        compose.onNodeWithContentDescription("Продолжить").assertExists()
    }

    @Test fun theBeadsHaveNoFinishNotch() {
        inPlayer = true
        show(day("one", heard = 3))
        compose.waitForIdle()
        val beads = compose.onNodeWithContentDescription("Услышано 3 из 11")
        val img = beads.captureToImage().toPixelMap()
        // 6 dp over the beads' axis (xxhdpi) only a notch reaches; the top row is the card alone
        // (its glow shades it along x, so each pixel is compared with the one above it)
        val above = img.height / 2 - 6 * 3
        for (x in 0 until img.width) {
            val a = img[x, above]
            val top = img[x, 1]
            assertTrue("x=$x: $a vs $top", abs(a.red - top.red) + abs(a.green - top.green) + abs(a.blue - top.blue) <= 0.05f)
        }
    }

    private fun day(kind: String, heard: Int = 0, title: String = "Мракобесие и джаз") = DayAlbum(
        kind = kind, day = LocalDate.of(2026, 11, 13), albumId = "al1", title = title, artist = "Агата Кристи", year = 1997,
        coverImageId = null,
        tracks = (1..11).map { DayTrack("d$it", if (it == 1) "Где-то между небом и землёй ночью" else "Песня $it", 240_000, heard = it <= heard) },
        plays = 41, lastPlayedAt = LocalDate.of(2025, 3, 2).toEpochDay() * 86_400_000, songId = "d1", songPlays = 23, artistRank = 4,
        artistPlayedMin = 900, otherAlbumsHeard = 2,
    )
}
