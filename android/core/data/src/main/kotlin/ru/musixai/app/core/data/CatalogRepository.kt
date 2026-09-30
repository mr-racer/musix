package ru.musixai.app.core.data

import app.musix.api.models.LibrarySummaryOut
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.mapNotNull
import ru.musixai.app.core.database.KvEntity
import ru.musixai.app.core.database.MusixDatabase
import ru.musixai.app.core.model.Album
import ru.musixai.app.core.model.AlbumCard
import ru.musixai.app.core.model.Counts
import ru.musixai.app.core.model.LibrarySummary
import ru.musixai.app.core.model.Track
import ru.musixai.app.core.network.ApiJson
import ru.musixai.app.core.network.MusixApi
import javax.inject.Inject
import javax.inject.Singleton

enum class AlbumSort { Plays, Year, Title, Added }

/** The library screen's data: albums from the mirror, the summary (and per-album plays for
 *  «слушаю чаще») from `/library/summary`, kept in Room for the next cold start. */
@Singleton
class CatalogRepository @Inject constructor(private val api: MusixApi, private val db: MusixDatabase) {
    private val dao = db.library()

    val summary: Flow<LibrarySummary> = db.mirror().kvFlow(KEY).mapNotNull { raw ->
        raw?.let { runCatching { ApiJson.decodeFromString(LibrarySummaryOut.serializer(), it) }.getOrNull() }?.let { s ->
            LibrarySummary(Counts(s.counts.tracks, s.counts.albums, s.counts.artists, s.counts.playlists), s.genres.size, s.plays,
                s.playedMs.toLong(), s.firstAddedAt?.toInstant()?.toEpochMilli(), s.albumPlays.orEmpty())
        }
    }

    /** The library's first and last release year, when any track carries one. */
    val years: Flow<IntRange?> = dao.years().map { y -> val lo = y?.lo; val hi = y?.hi; if (lo != null && hi != null) lo..hi else null }

    suspend fun refresh() {
        val s = api.call { screens.librarySummaryApiV2LibrarySummaryGet() }
        db.mirror().putKv(KvEntity(KEY, ApiJson.encodeToString(LibrarySummaryOut.serializer(), s)))
    }

    fun albums(sort: Flow<AlbumSort>): Flow<List<AlbumCard>> = combine(dao.albumRows(), summary.map { it.albumPlays }, sort) { rows, plays, s ->
        val images = if (rows.isEmpty()) emptyMap() else rows.mapNotNull { it.coverImageId }.distinct().chunked(500).flatMap { dao.images(it) }.associateBy { it.id }
        val cards = rows.map { r -> AlbumCard(r.id, r.title, r.artist, r.year, r.tracks, r.addedAt, r.coverImageId?.let { images[it]?.model() }, plays[r.id] ?: 0) }
        when (s) {
            AlbumSort.Plays -> cards.sortedWith(compareByDescending<AlbumCard> { it.plays }.thenByDescending { it.addedAt })
            AlbumSort.Year -> cards.sortedWith(compareByDescending<AlbumCard> { it.year ?: 0 }.thenBy { it.title.lowercase() })
            AlbumSort.Title -> cards.sortedBy { it.title.lowercase() }
            AlbumSort.Added -> cards.sortedByDescending { it.addedAt }
        }
    }

    suspend fun album(id: String): Album? = dao.album(id)?.let { Album(it.id, it.title, it.year, it.albumArtistId, it.coverImageId) }

    fun albumTracks(id: String): Flow<List<Track>> = dao.albumTracks(id).map { r -> r.map { it.model() } }

    private companion object { const val KEY = "screen.summary" }
}
