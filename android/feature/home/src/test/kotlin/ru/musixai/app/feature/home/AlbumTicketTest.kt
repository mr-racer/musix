package ru.musixai.app.feature.home

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.dp
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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

/** r3 §5.4 on a 360 dp phone (the ticket is 328 wide): the phrase is two lines, never an
 *  ellipsis — a phrase that does not fit is left out of the shuffle; the progress caption is
 *  one line (the long r2 wording when it fits, the mock's short one when not). */
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

    private fun show(day: DayAlbum) {
        val d = day
        compose.setContent {
            MusixTheme(true) {
                Box(Modifier.width(328.dp)) {
                    AlbumTicket(d, null, dense = true, extraHeard = emptySet(), albumPlaying = false, isPlaying = false,
                        currentTrackId = null, reduced = true, onListen = {}, onOpen = {})
                }
            }
        }
    }

    // the shuffle is random: 24 taps over five phrases miss one with p < 0.1 %, and a miss
    // can only let an overflow through, never fail a fitting ticket
    @Test fun everyOnePhraseFitsTwoLines() = shuffleThrough("one")
    @Test fun everyLongPhraseFitsTwoLines() = shuffleThrough("long")
    @Test fun everyNeverPhraseFitsTwoLines() = shuffleThrough("never")

    private fun shuffleThrough(kind: String) {
        show(day(kind))
        repeat(24) { i ->
            val l = layout("ticket-phrase")
            assertFalse("phrase $i overflows: ${l.layoutInput.text}", l.hasVisualOverflow)
            compose.onNodeWithContentDescription("Другая фраза").performClick()
            compose.waitForIdle()
        }
    }

    @Test fun theProgressCaptionIsOneLine() {
        show(day("one", heard = 3))
        val l = layout("ticket-caption")
        assertEquals("caption: ${l.layoutInput.text}", 1, l.lineCount)
        assertFalse(l.hasVisualOverflow)
    }

    private fun day(kind: String, heard: Int = 0) = DayAlbum(
        kind = kind, day = LocalDate.of(2026, 11, 13), albumId = "al1", title = "Мракобесие и джаз", artist = "Агата Кристи", year = 1997,
        coverImageId = null,
        tracks = (1..11).map { DayTrack("d$it", if (it == 1) "Где-то между небом и землёй ночью" else "Песня $it", 240_000, heard = it <= heard) },
        plays = 41, lastPlayedAt = LocalDate.of(2025, 3, 2).toEpochDay() * 86_400_000, songId = "d1", songPlays = 23, artistRank = 4,
        artistPlayedMin = 900, otherAlbumsHeard = 2,
    )
}
