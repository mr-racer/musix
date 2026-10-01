package ru.musixai.app.core.player

import android.os.Bundle
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withTimeoutOrNull
import ru.musixai.app.core.data.HomeRepository
import ru.musixai.app.core.data.LibraryRepository
import ru.musixai.app.core.data.PlaylistRepository
import ru.musixai.app.core.data.SearchRepository

/**
 * Android Auto's browse tree (phase 8 §2), built from the mirror, so it works offline too:
 * - «Поток»: playable; it starts the wave;
 * - «Недавнее»: the home screen's recent tracks;
 * - «Плейлисты», «Альбомы», «Исполнители»: each opens its tracks;
 * - «Вайбики»: each plays its tracks, and autoplay continues.
 * A track carries its list in its id (`t:<track>|<parent>`), so picking one plays the whole
 * album, playlist or artist from that track.
 */
class AutoBrowse(
    private val packageName: String,
    private val library: LibraryRepository,
    private val playlists: PlaylistRepository,
    private val home: HomeRepository,
    private val search: SearchRepository,
) {
    private var lastSearch: List<String> = emptyList()

    fun root(): MediaItem = node(ROOT, "MusiX", browsable = true)

    suspend fun children(parent: String): List<MediaItem> = when {
        parent == ROOT -> listOf(
            node(STREAM, "Поток", "Волна под твой вкус", playable = true),
            node(RECENT, "Недавнее", browsable = true),
            node(PLAYLISTS, "Плейлисты", browsable = true),
            node(ALBUMS, "Альбомы", browsable = true),
            node(ARTISTS, "Исполнители", browsable = true),
            node(VIBES, "Вайбики", "То, что держит тебя сейчас", browsable = true),
        )
        parent == RECENT -> tracks(homeNow()?.recent?.map { it.id }.orEmpty(), RECENT)
        parent == PLAYLISTS -> playlists.playlists.first().map { node("pl:${it.id}", it.name, plural(it.itemCount), browsable = true, art = it.coverImageId) }
        parent == ALBUMS -> library.recentAlbums().map { node("al:${it.id}", it.title, listOfNotNull(it.artist, it.year?.toString()).joinToString(" · "), browsable = true, art = it.imageId) }
        parent == ARTISTS -> library.topArtists().map { node("ar:${it.id}", it.title, plural(it.tracks), browsable = true, art = it.imageId) }
        parent == VIBES -> homeNow()?.vibes.orEmpty().map { v -> node("vibe:${v.id}", v.name ?: v.tracks.firstOrNull()?.title ?: "Вайб", playable = true, art = v.tracks.firstOrNull()?.coverImageId) }
        parent.startsWith("pl:") || parent.startsWith("al:") || parent.startsWith("ar:") -> tracks(ids(parent), parent)
        else -> emptyList()
    }

    /** The ids a parent plays, in its order. */
    suspend fun ids(parent: String): List<String> = when {
        parent.startsWith("pl:") -> library.playlistTrackIds(parent.drop(3))
        parent.startsWith("al:") -> library.albumTrackIds(parent.drop(3))
        parent.startsWith("ar:") -> library.artistTrackIds(parent.drop(3))
        parent == RECENT -> homeNow()?.recent?.map { it.id }.orEmpty()
        parent.startsWith("vibe:") -> homeNow()?.vibes?.firstOrNull { it.id == parent.drop(5) }?.tracks?.map { it.id }.orEmpty()
        parent == SEARCH -> lastSearch
        else -> emptyList()
    }

    suspend fun search(query: String): List<MediaItem> {
        val r = runCatching { search.search(query, "catalog", limit = 30) }.getOrNull() ?: return emptyList()
        lastSearch = r.tracks.map { it.id }
        return tracks(lastSearch, SEARCH)
    }

    private suspend fun tracks(ids: List<String>, parent: String): List<MediaItem> =
        library.tracks(ids).map { t -> node("t:${t.id}|$parent", t.title, t.artist, playable = true, art = t.coverImageId) }

    private suspend fun homeNow() = withTimeoutOrNull(1_000) { home.home.first() }

    private fun node(id: String, title: String, subtitle: String? = null, browsable: Boolean = false, playable: Boolean = false, art: String? = null): MediaItem =
        MediaItem.Builder().setMediaId(id).setMediaMetadata(
            MediaMetadata.Builder().setTitle(title).setSubtitle(subtitle).setArtist(subtitle)
                .setIsBrowsable(browsable).setIsPlayable(playable)
                .setArtworkUri(ArtworkProvider.uri(packageName, art))
                .setMediaType(if (browsable) MediaMetadata.MEDIA_TYPE_FOLDER_MIXED else MediaMetadata.MEDIA_TYPE_MUSIC)
                .setExtras(Bundle())
                .build(),
        ).build()

    companion object {
        const val ROOT = "musix.root"
        const val STREAM = "musix.stream"
        const val RECENT = "musix.recent"
        const val PLAYLISTS = "musix.playlists"
        const val ALBUMS = "musix.albums"
        const val ARTISTS = "musix.artists"
        const val VIBES = "musix.vibes"
        const val SEARCH = "musix.search"

        /** `t:<track>|<parent>` → (track, parent); a bare id is a track with no list. */
        fun parse(mediaId: String): Pair<String, String?> =
            if (mediaId.startsWith("t:")) mediaId.drop(2).substringBefore('|') to mediaId.substringAfter('|', "").ifEmpty { null } else mediaId to null

        private fun plural(n: Int): String {
            val m10 = n % 10; val m100 = n % 100
            val w = if (m10 == 1 && m100 != 11) "трек" else if (m10 in 2..4 && m100 !in 12..14) "трека" else "треков"
            return "$n $w"
        }
    }
}
