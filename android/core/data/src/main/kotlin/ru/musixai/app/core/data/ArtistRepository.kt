package ru.musixai.app.core.data

import app.musix.api.models.ArtistStreamIn
import kotlinx.serialization.json.JsonPrimitive
import ru.musixai.app.core.model.AlbumCard
import ru.musixai.app.core.model.AlbumPage
import ru.musixai.app.core.model.Artist
import ru.musixai.app.core.model.ArtistPage
import ru.musixai.app.core.model.ArtistYou
import ru.musixai.app.core.model.Credit
import ru.musixai.app.core.model.Grammy
import ru.musixai.app.core.model.ShelfAlbum
import ru.musixai.app.core.network.MusixApi
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import javax.inject.Inject
import javax.inject.Singleton

/**
 * The artist page (`/artists/{id}/page` + the bio, which may not exist yet), the album page
 * (`/albums/{id}`) and the artist's stream (`POST /stream/artist`).
 *
 * The last pages are kept in memory: an album prefetches its artist, so the way from the album
 * to the artist draws the artist's discography in its first frame — the cover flies back into
 * its place on the axis instead of waiting for the network.
 */
@Singleton
class ArtistRepository @Inject constructor(private val api: MusixApi, private val library: LibraryRepository) {
    private val pages = ConcurrentHashMap<String, ArtistPage>()
    private val albums = ConcurrentHashMap<String, AlbumPage>()

    /** The page from memory, if it was loaded (or prefetched) this session. */
    fun cached(id: String): ArtistPage? = pages[id]
    fun cachedAlbum(id: String): AlbumPage? = albums[id]

    suspend fun page(id: String): ArtistPage {
        val uuid = UUID.fromString(id)
        val p = api.call { screens.artistPageApiV2ArtistsArtistIdPageGet(uuid) }
        val bio = runCatching { api.call { knowledge.artistBioApiV2ArtistsArtistIdBioGet(uuid) } }.getOrNull()
        val images = p.images.mapValues { it.value.model() }
        val page = ArtistPage(
            artist = Artist(p.artist.id.toString(), p.artist.name, p.artist.sortName, p.artist.imageId),
            trackCount = p.trackCount,
            topTracks = p.topTracks.map { it.model() },
            albums = p.albums.map { a -> AlbumCard(a.id.toString(), a.title, a.albumArtist?.name, a.originalYear ?: a.year, a.trackCount, 0, a.coverImageId?.let { images[it] }, 0) },
            appearsOn = p.appearsOn.map { it.model() },
            images = images,
            bio = bio?.text?.takeIf { it.isNotBlank() },
            facets = bio?.facets.orEmpty().mapNotNull { (k, v) -> (v as? JsonPrimitive)?.content?.let { k to it } }.toMap(),
            cutout = p.artist.cutoutId?.let { images[it] },
            country = p.country,
            countryCode = p.countryCode,
            photo = p.photoId?.let { images[it] },
            wide = p.wideId?.let { images[it] },
            logo = p.logoId?.let { images[it] },
            pageColor = p.pageColor,
            grammy = p.grammy?.let { Grammy(it.wins, it.nominations ?: 0, it.position, it.laureates) },
            facts = p.facts.orEmpty().map { it.text }.filter { it.isNotBlank() },
            you = p.you?.let { ArtistYou(it.plays, it.heardTracks, it.rank, it.artists) },
            heard = p.heard.orEmpty(),
            plays = p.plays.orEmpty(),
            shelf = p.albums.map { a -> ShelfAlbum(a.id.toString(), a.title, a.originalYear ?: a.year, a.trackCount, a.coverImageId?.let { images[it] }, a.durationMs.toLong()) },
        )
        // the top tracks play from the mirror: the ones it lacks are remembered first
        runCatching { library.remember(p.topTracks + p.appearsOn, p.images) }
        pages[id] = page
        return page
    }

    suspend fun album(id: String): AlbumPage {
        val p = api.call { screens.albumPageApiV2AlbumsAlbumIdGet(UUID.fromString(id)) }
        val images = p.images.mapValues { it.value.model() }
        val a = p.album
        val page = AlbumPage(
            id = a.id.toString(), title = a.title, artistId = a.albumArtist?.id?.toString(), artist = a.albumArtist?.name,
            year = a.originalYear ?: a.year, image = a.coverImageId?.let { images[it] },
            tracks = p.tracks.map { it.model() }.sortedWith(compareBy({ it.discNo ?: 1 }, { it.trackNo ?: Int.MAX_VALUE })),
            durationMs = a.durationMs.toLong(),
            trackPlays = p.trackPlays.orEmpty(),
            producers = p.producers.orEmpty().map { Credit(it.name, it.artistId?.toString(), it.songs) },
            label = p.label?.takeIf { it.isNotBlank() },
            lastPlayedAt = p.lastPlayedAt?.toInstant()?.toEpochMilli(),
            images = images,
        )
        runCatching { library.remember(p.tracks, p.images) }
        albums[id] = page
        return page
    }

    /** «Поток артиста»: his songs and the ones close to them by sound, ready to play (in the mirror). */
    suspend fun stream(id: String, limit: Int = 40): List<String> {
        val out = api.call { stream.artistApiV2StreamArtistPost(ArtistStreamIn(UUID.fromString(id), limit)) }
        library.remember(out.tracks, out.images)
        return out.tracks.map { it.id.toString() }
    }
}
