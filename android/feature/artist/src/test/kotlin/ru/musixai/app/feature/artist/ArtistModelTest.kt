package ru.musixai.app.feature.artist

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import ru.musixai.app.core.model.ArtistYou

class ArtistModelTest {
    private fun disc(n: Int, heard: Int) = Disc("a$n$heard", "t", "t", null, 2000, n, heard, 0, null)

    @Test fun plays_open_the_first_three_levels() {
        assertEquals(0, standing(0, emptyList()).k)
        assertEquals(1, standing(10, emptyList()).k)
        assertEquals(2, standing(149, listOf(disc(10, 0))).k)
    }

    @Test fun backstage_wants_half_the_albums_heard_through() {
        val half = listOf(disc(10, 5), disc(10, 0))
        assertEquals(3, standing(150, half).k)
        val none = listOf(disc(10, 4), disc(10, 0))
        val s = standing(150, none)
        assertEquals(2, s.k)
        assertEquals("дослушать ещё 1 альбом", s.needRest)
    }

    @Test fun legend_wants_every_album() {
        assertEquals(4, standing(300, listOf(disc(10, 5), disc(8, 4))).k)
        assertEquals(3, standing(300, listOf(disc(10, 5), disc(8, 3))).k)
    }

    @Test fun the_next_step_by_plays() {
        val s = standing(42, emptyList())
        assertEquals("Первый ряд", s.needTo)
        assertEquals("ещё 8 прослушиваний", s.needRest)
    }

    @Test fun air_words_never_a_place() {
        assertEquals("Не сходит с эфира", air(ArtistYou(500, 40, 1, 120)).name)
        assertEquals("чаще всех в твоей библиотеке", air(ArtistYou(500, 40, 1, 120)).line)
        assertEquals("В ротации", air(ArtistYou(50, 10, 10, 120)).name)
        assertEquals("Ещё не в эфире", air(ArtistYou(0, 0, null, 120)).name)
    }

    @Test fun editions_come_off_the_title() {
        assertEquals("AM" to "Deluxe Edition", cleanTitle("AM (Deluxe Edition)"))
        assertEquals("Humbug" to null, cleanTitle("Humbug"))
        assertEquals("Favourite Worst Nightmare" to "Tour Edition", cleanTitle("Favourite Worst Nightmare [Australian Tour Edition]"))
    }

    @Test fun russian_plurals() {
        assertEquals("песня", songs(21))
        assertEquals("песни", songs(3))
        assertEquals("песен", songs(11))
        assertEquals("лет", yearsW(12))
    }

    @Test fun flags_and_countries() {
        assertEquals("🇬🇧", flagOf("gb"))
        assertNull(flagOf(null))
        assertEquals("Великобритания", countryName("GB"))
    }
}
