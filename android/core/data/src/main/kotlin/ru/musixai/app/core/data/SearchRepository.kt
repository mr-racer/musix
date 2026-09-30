package ru.musixai.app.core.data

import ru.musixai.app.core.model.Album
import ru.musixai.app.core.model.Artist
import ru.musixai.app.core.model.SearchResult
import ru.musixai.app.core.model.TopItem
import ru.musixai.app.core.network.MusixApi
import javax.inject.Inject
import javax.inject.Singleton

/** `GET /search`: catalog, lyric-line and sound search in one call, by section. */
@Singleton
class SearchRepository @Inject constructor(private val api: MusixApi) {
    /** The filter chips: decades («1990s») and sonic tags, with counts. */
    suspend fun facets(): Pair<List<Pair<String, Int>>, List<Pair<String, Int>>> {
        val f = api.call { search.facetsApiV2LibraryFacetsGet() }
        return f.decades.map { it.value to it.count } to f.tags.map { it.value to it.count }
    }

    suspend fun search(q: String, sections: String, limit: Int = 12, years: Set<String> = emptySet(), tags: Set<String> = emptySet()): SearchResult {
        val o = api.call { search.searchApiV2SearchGet(q, limit, sections, years.takeIf { it.isNotEmpty() }?.sorted()?.joinToString(","), tags.takeIf { it.isNotEmpty() }?.joinToString(",")) }
        return SearchResult(
            query = o.query,
            top = o.top.map { TopItem(it.type.value, it.id.toString(), it.name, it.artist) },
            tracks = o.tracks.map { it.model() },
            albums = o.albums.map { Album(it.id.toString(), it.title, it.year, it.albumArtist?.id?.toString(), it.coverImageId) },
            artists = o.artists.map { Artist(it.id.toString(), it.name, it.sortName, it.imageId) },
            lyrics = o.lyrics.map { it.track.model() },
            sound = o.sound.map { it.track.model() },
            images = o.images.mapValues { it.value.model() },
            degraded = o.degraded.orEmpty(),
        )
    }
}
