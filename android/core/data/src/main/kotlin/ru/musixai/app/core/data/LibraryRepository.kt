package ru.musixai.app.core.data

import androidx.paging.Pager
import androidx.paging.PagingConfig
import androidx.paging.PagingData
import androidx.paging.map
import app.musix.api.models.ImageData
import app.musix.api.models.TrackOut
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import ru.musixai.app.core.database.ImageEntity
import ru.musixai.app.core.database.MusixDatabase
import ru.musixai.app.core.database.TrackEntity
import ru.musixai.app.core.model.ArtistRef
import ru.musixai.app.core.model.Image
import ru.musixai.app.core.model.Palette
import ru.musixai.app.core.model.Track
import ru.musixai.app.core.network.ApiJson
import javax.inject.Inject
import javax.inject.Singleton

enum class TrackSort { Title, Added, Year }

/** Tracks and images as the screens and the player read them: Room first, always. */
@Singleton
class LibraryRepository @Inject constructor(private val db: MusixDatabase) {
    private val dao = db.library()

    val trackCount: Flow<Int> = dao.trackCount()

    fun paged(sort: TrackSort): Flow<PagingData<Track>> =
        Pager(PagingConfig(pageSize = 60, prefetchDistance = 120, enablePlaceholders = true)) {
            when (sort) { TrackSort.Title -> dao.byTitle(); TrackSort.Added -> dao.byAdded(); TrackSort.Year -> dao.byYear() }
        }.flow.map { p -> p.map { it.model() } }

    suspend fun track(id: String): Track? = dao.track(id)?.model()

    /** In [ids] order; ids not in the mirror are skipped. */
    suspend fun tracks(ids: List<String>): List<Track> {
        val byId = ids.chunked(500).flatMap { dao.tracks(it) }.associateBy { it.id }
        return ids.mapNotNull { byId[it]?.model() }
    }

    fun albumTracks(albumId: String): Flow<List<Track>> = dao.albumTracks(albumId).map { r -> r.map { it.model() } }

    suspend fun images(ids: Collection<String>): Map<String, Image> =
        if (ids.isEmpty()) emptyMap() else ids.distinct().chunked(500).flatMap { dao.images(it) }.associate { it.id to it.model() }

    fun image(id: String): Flow<Image?> = dao.image(id).map { it?.model() }

    fun signal(trackId: String): Flow<String?> = dao.signal(trackId).map { it?.kind }

    /** Server payloads (stream chunks, autoplay) carry tracks the mirror may not have yet. */
    suspend fun remember(tracks: List<TrackOut>, images: Map<String, ImageData>) {
        val gen = db.mirror().kv(SyncEngine.GEN)?.toLong() ?: 0
        if (images.isNotEmpty()) db.mirror().images(images.values.map { it.entity(gen) })
        val missing = tracks.filter { dao.track(it.id.toString()) == null }
        if (missing.isNotEmpty()) db.mirror().tracks(missing.map { it.entity(gen) })
    }
}

private val artistsSer = ListSerializer(MapSerializer(String.serializer(), String.serializer()))

internal fun TrackEntity.model() = Track(
    id = id, title = title, artist = artist,
    artists = runCatching { ApiJson.decodeFromString(artistsSer, artistsJson).map { ArtistRef(it["id"]!!, it["name"]!!) } }.getOrDefault(emptyList()),
    albumId = albumId, album = album, year = year, genre = genre, durationMs = durationMs, trackNo = trackNo, discNo = discNo,
    coverImageId = coverImageId, addedAt = addedAt,
)

internal fun ImageEntity.model() = Image(
    id = id, blurhash = blurhash, width = width, height = height,
    palette = paletteJson?.let { runCatching {
        val o = ApiJson.parseToJsonElement(it).jsonObject
        fun s(k: String) = o[k]?.jsonPrimitive?.content
        Palette(s("dominant")!!, s("vibrant")!!, s("muted")!!, s("accentDark"), s("accentLight"))
    }.getOrNull() },
    urls = runCatching { ApiJson.decodeFromString(MapSerializer(String.serializer(), String.serializer()), urlsJson) }
        .getOrDefault(emptyMap()).mapNotNull { (k, v) -> k.toIntOrNull()?.let { it to v } }.toMap(),
)
