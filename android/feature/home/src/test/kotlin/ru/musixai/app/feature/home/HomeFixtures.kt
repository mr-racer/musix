package ru.musixai.app.feature.home

import ru.musixai.app.core.model.ArtistRef
import ru.musixai.app.core.model.Counts
import ru.musixai.app.core.model.DayAlbum
import ru.musixai.app.core.model.DayTrack
import ru.musixai.app.core.model.Home
import ru.musixai.app.core.model.Track
import ru.musixai.app.core.model.Vibe
import ru.musixai.app.core.model.Weather
import java.time.LocalDate

/** A home for the screen tests (fake data): three vibes and the album of the day, 3 of 11 heard. */
internal object HomeFixtures {
    fun track(i: Int, album: String = "a$i", title: String = "Песня $i") =
        Track("t$i", title, "Артист $i", listOf(ArtistRef("ar$i", "Артист $i")), album, "Альбом $i", 2001, "rock", 200_000, i, 1, null, 0)

    val HOME = Home(
        vibes = listOf(
            Vibe("v1", "Ночной синт-поп", (1..3).map { track(it) }, 1.0),
            Vibe("v2", "Тёплый соул", (4..6).map { track(it) }, 0.8),
            Vibe("v3", "Гитарный вечер", (7..8).map { track(it) }, 0.6),
        ),
        wavePhrase = "Электронный пульс и соул-темп на вечер",
        counts = Counts(1200, 140, 90, 6), pulse = null, recent = emptyList(),
        recentlyAdded = (11..13).map { track(it) }, playlists = emptyList(), images = emptyMap(),
        dayAlbum = DayAlbum(
            kind = "one", day = LocalDate.of(2026, 11, 13), albumId = "al1", title = "Группа крови", artist = "Кино", year = 1988,
            coverImageId = null,
            tracks = (1..11).map { DayTrack("d$it", "Песня $it", 240_000, heard = it <= 3) },
            plays = 41, lastPlayedAt = null, songId = "d1", songPlays = 23, artistRank = 4, artistPlayedMin = 900, otherAlbumsHeard = 2,
        ),
        weather = Weather("cloudy", 4.0),
    )
}
