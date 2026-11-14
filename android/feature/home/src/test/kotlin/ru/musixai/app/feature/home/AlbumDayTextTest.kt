package ru.musixai.app.feature.home

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import ru.musixai.app.core.model.DayAlbum
import ru.musixai.app.core.model.DayTrack
import java.time.LocalDate
import java.time.ZoneOffset

/** The album of the day's words and numbers: the r2 model (album-day-model.js), in Kotlin. */
class AlbumDayTextTest {
    private val t = AlbumDayText

    /** [songs] full-length songs (3–5 min), [skits] of 40 s, the first [heard] songs heard. */
    private fun tracks(songs: Int, heard: Int = 0, skits: Int = 0) =
        List(skits) { DayTrack("s$it", "Skit $it", 40_000, false) } +
            List(songs) { DayTrack("t$it", "Song $it", 180_000L + it * 10_000, it < heard) }

    @Test fun `progress counts 7 of 11 heard, the finish on the 9th`() {
        val p = t.progress(tracks(11, heard = 7))
        assertEquals(listOf(7, 11, 9, 2), listOf(p.heard, p.total, p.finishAt, p.left))
        assertFalse(p.done)
        assertTrue(t.progress(tracks(11, heard = 9)).done)
    }

    @Test fun `songs of a minute or shorter never count, and a local hear adds up`() {
        val p = t.progress(tracks(10, heard = 0, skits = 2) + DayTrack("x", "Skit heard", 50_000, true))
        assertEquals(10, p.total)
        assertEquals(0, p.heard)
        assertEquals(1, t.progress(tracks(10), extraHeard = setOf("t3", "s0")).heard)
    }

    @Test fun `the compact button says listen, how far, and again`() {
        assertEquals("Слушать", t.buttonLabel(t.progress(tracks(11))))
        assertEquals("7 из 11", t.buttonLabel(t.progress(tracks(11, heard = 7))))
        assertEquals("Ещё раз", t.buttonLabel(t.progress(tracks(11, heard = 9))))
    }

    @Test fun `the progress phrase counts down to the finish`() {
        val two = t.progressPhrase(t.progress(tracks(11, heard = 7)), 0)!!
        assertEquals("Ещё 2 песни — и пластинка обыграна", two.text)
        assertEquals(listOf("2 песни"), two.bold)
        assertEquals("Последняя песня до финиша", t.progressPhrase(t.progress(tracks(11, heard = 8)), 0)!!.text)
        assertEquals("Половина позади. Не сворачивай", t.progressPhrase(t.progress(tracks(12, heard = 6)), 1)!!.text)
        assertNull(t.progressPhrase(t.progress(tracks(11, heard = 9)), 0))
        assertNull(t.progressPhrase(t.progress(tracks(11)), 0))
    }

    @Test fun `the short progress phrase is the r3 mock's, for a slot too narrow for the long one`() {
        val short = t.progressPhrase(t.progress(tracks(11, heard = 3)), 0, short = true)!!
        assertEquals("Ещё 6 песен — и обыграна", short.text)
        assertEquals(listOf("6 песен"), short.bold)
        assertEquals("Последняя песня до финиша", t.progressPhrase(t.progress(tracks(11, heard = 8)), 0, short = true)!!.text)
    }

    @Test fun `the resting caption gives the songs and the minutes`() {
        assertEquals("13 песен · 52 мин", t.restCaption(List(13) { DayTrack("t$it", "S", 240_000, false) }))
        assertEquals("1 песня · 4 мин", t.restCaption(listOf(DayTrack("a", "S", 240_000, false))))
    }

    @Test fun `plurals follow Russian`() {
        assertEquals(listOf("1 песня", "2 песни", "5 песен", "11 песен", "21 песня", "22 песни"),
            listOf(1, 2, 5, 11, 21, 22).map { t.num(it, AlbumDayText.SONGS) })
    }

    @Test fun `one and long fill their numbers in bold`() {
        val one = t.phrases("one", AlbumDayText.Facts(song = "Frozen", n = 47, k = 12))
        val first = one.first { it.text.startsWith("«Frozen» играла") }
        assertEquals("«Frozen» играла 47 раз. Остальные 12 песен ревнуют", first.text)
        assertEquals(listOf("47 раз"), first.bold)
        assertTrue(one.any { it.text == "Одна песня на репите — это любовь. Целый альбом — уже отношения" })
        val long = t.phrases("long", AlbumDayText.Facts(plays = 32, monthGen = "марта", days = 246)).map { it.text }
        assertTrue(long.contains("32 раза, а потом тишина с марта. Что случилось?"))
        assertTrue(long.contains("246 дней без этого альбома. Он считал"))
    }

    @Test fun `never needs its facts, and a long name shortens`() {
        val plain = t.phrases("never", AlbumDayText.Facts(artist = "Foals", rank = 4, hours = 12, otherAlbumsHeard = 1))
        assertTrue(plain.none { "затёрты" in it.text || "старал" in it.text })
        assertTrue(plain.first().bold.contains("№4"))
        assertTrue(t.phrases("never", AlbumDayText.Facts(artist = "Foals", rank = 4, hours = 12, otherAlbumsHeard = 2)).any { "как новенький" in it.text })
        assertTrue(t.phrases("never", AlbumDayText.Facts(artist = "Foals", rank = 4, hours = 0)).none { "час" in it.text })
        val long = t.phrases("never", AlbumDayText.Facts(artist = "Everything Everything Orchestra", rank = 4, hours = 12, artistMax = 14))
        assertTrue(long.all { "Everything Ev…" in it.text && "Orchestra" !in it.text })
    }

    @Test fun `a quote shortens inside the quotes`() {
        val q = t.quote("Monster (ft. Jay-Z, Rick Ross, Nicki Minaj & Bon Iver)", 24)
        assertTrue(q, q.length <= 26 && q.endsWith("…»"))
        assertEquals("«Frozen»", t.quote("Frozen", 24))
    }

    @Test fun `the facts come from the day's album`() {
        val today = LocalDate.of(2026, 11, 13)
        val last = LocalDate.of(2026, 3, 2).atTime(20, 0).toInstant(ZoneOffset.UTC).toEpochMilli()
        val d = DayAlbum(
            kind = "one", day = today, albumId = "a", title = "Ray Of Light", artist = "Madonna", year = 1998, coverImageId = null,
            tracks = tracks(13, heard = 1, skits = 1), plays = 52, lastPlayedAt = last, songId = "t0", songPlays = 47,
            artistRank = 3, artistPlayedMin = 750, otherAlbumsHeard = 2,
        )
        val f = t.facts(d, today, ZoneOffset.UTC)
        assertEquals(listOf("Song 0", "47", "12"), listOf(f.song, f.n.toString(), f.k.toString()))
        assertEquals(listOf("Madonna", "3", "12", "2"), listOf(f.artist, f.rank.toString(), f.hours.toString(), f.otherAlbumsHeard.toString()))
        assertEquals(listOf("52", "марта", "256"), listOf(f.plays.toString(), f.monthGen, f.days.toString()))
        assertEquals("13 ноября", t.dayLabel(today))
    }

    @Test fun `the finale has two lines`() {
        assertEquals(listOf("Обыграна! От первой песни до последней", "Обыграна! Альбом пройден, можно хвастаться"), t.finalePhrases())
    }

    private fun at(day: Int, hour: Int, minute: Int = 0) =
        LocalDate.of(2026, 11, day).atTime(hour, minute).toInstant(ZoneOffset.UTC).toEpochMilli()

    @Test fun `a phrase holds for three hours of the local day`() {
        val slot = { ms: Long -> t.phraseSlot(ms, ZoneOffset.UTC) }
        assertEquals(slot(at(14, 9)), slot(at(14, 11, 59)))
        assertNotEquals(slot(at(14, 11, 59)), slot(at(14, 12)))
        assertEquals(slot(at(14, 21, 30)) + 1, slot(at(15, 0, 10)))
    }

    @Test fun `the next three hours show another phrase`() {
        for (n in 2..5) for (s in 0L..30L) assertNotEquals("n=$n slot=$s", t.phraseIndex("al1", s, n), t.phraseIndex("al1", s + 1, n))
        assertEquals(0, t.phraseIndex("al1", 7, 1))
    }

    @Test fun `an edition at the end of the title moves to the grey line`() {
        assertEquals("Born to Die" to "The Paradise Edition", t.edition("Born to Die (The Paradise Edition)"))
        assertEquals("Superunknown" to "Super Deluxe", t.edition("Superunknown (Super Deluxe)"))
        assertEquals("Born To Die" to "Paradise Edition", t.edition("Born To Die – Paradise Edition"))
        assertEquals("Bangarang" to "EP", t.edition("Bangarang - EP"))
        assertEquals("F1 The Album" to "Cinematic Edition", t.edition("F1 The Album [Cinematic Edition]"))
        assertEquals("Black Panther: The Album" to "Music From and Inspired By", t.edition("Black Panther: The Album (Music From and Inspired By)"))
    }

    @Test fun `brackets that are part of the name stay`() {
        for (title in listOf("Aglow (Intro)", "Blue (Da Ba Dee)", "Enter the Wu‐Tang (36 Chambers)", "(What's the Story) Morning Glory?",
            "Mercury - Acts 1 & 2", "Мракобесие и джаз", "(Deluxe)")) assertEquals(title, title to null, t.edition(title))
    }
}
