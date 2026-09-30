package ru.musixai.app.core.data

import kotlinx.serialization.json.JsonPrimitive
import ru.musixai.app.core.model.AlbumCard
import ru.musixai.app.core.model.Artist
import ru.musixai.app.core.model.ArtistPage
import ru.musixai.app.core.network.MusixApi
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/** The artist atlas: `/artists/{id}/page` (BFF) + the bio (may not exist yet). */
@Singleton
class ArtistRepository @Inject constructor(private val api: MusixApi) {
    suspend fun page(id: String): ArtistPage {
        val uuid = UUID.fromString(id)
        val p = api.call { screens.artistPageApiV2ArtistsArtistIdPageGet(uuid) }
        val bio = runCatching { api.call { knowledge.artistBioApiV2ArtistsArtistIdBioGet(uuid) } }.getOrNull()
        val images = p.images.mapValues { it.value.model() }
        return ArtistPage(
            artist = Artist(p.artist.id.toString(), p.artist.name, p.artist.sortName, p.artist.imageId),
            trackCount = p.trackCount,
            topTracks = p.topTracks.map { it.model() },
            albums = p.albums.map { a -> AlbumCard(a.id.toString(), a.title, a.albumArtist?.name, a.year, a.trackCount, 0, a.coverImageId?.let { images[it] }, 0) },
            appearsOn = p.appearsOn.map { it.model() },
            images = images,
            bio = bio?.text?.takeIf { it.isNotBlank() },
            facets = bio?.facets.orEmpty().mapNotNull { (k, v) -> (v as? JsonPrimitive)?.content?.let { k to it } }.toMap(),
            cutout = p.artist.cutoutId?.let { images[it] },
            country = p.country,
            countryCode = p.countryCode,
        )
    }
}
