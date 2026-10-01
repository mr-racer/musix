package ru.musixai.app.core.model

/** The domain models every surface renders (immutable; declared stable for Compose in
 *  compose-stability.conf). Ids are the server's UUID strings. */

data class ArtistRef(val id: String, val name: String)

data class Track(
    val id: String,
    val title: String,
    val artist: String,  // the display line ("A feat. B")
    val artists: List<ArtistRef>,
    val albumId: String?,
    val album: String?,
    val year: Int?,
    val genre: String?,
    val durationMs: Long,
    val trackNo: Int?,
    val discNo: Int?,
    val coverImageId: String?,
    val addedAt: Long,
)

/** The server palette (cover colors; the player's ambient field and accent). Hex strings. */
data class Palette(val dominant: String, val vibrant: String, val muted: String, val accentDark: String?, val accentLight: String?)

data class Image(
    val id: String,
    val blurhash: String?,
    val width: Int?,
    val height: Int?,
    val palette: Palette?,
    /** variant px (96/256/512/1024) → signed URL */
    val urls: Map<Int, String>,
) {
    /** The smallest variant at least [px] wide, else the largest. */
    fun url(px: Int): String? = urls.entries.sortedBy { it.key }.let { v -> (v.firstOrNull { it.key >= px } ?: v.lastOrNull())?.value }
}

data class Artist(val id: String, val name: String, val sortName: String?, val imageId: String?)

/** One line of a browse list (Android Auto): an album or an artist with its counts. */
data class BrowseEntry(val id: String, val title: String, val year: Int?, val artist: String?, val tracks: Int, val imageId: String?)

data class Album(val id: String, val title: String, val year: Int?, val albumArtistId: String?, val coverImageId: String?)

data class Playlist(
    val id: String,
    val name: String,
    val description: String?,
    val coverImageId: String?,
    val itemCount: Int,
    val updatedAt: Long,
)

data class PlaylistEntry(val itemId: String, val playlistId: String, val position: String, val track: Track)

enum class SignalKind(val wire: String) { Fire("fire"), Water("water") }

/** A «вайбик»: the days-scale mood the stream spec §4 derives; a tap plays its queue. */
data class Vibe(val id: String, val name: String?, val tracks: List<Track>, val weight: Double)

data class Counts(val tracks: Int, val albums: Int, val artists: Int, val playlists: Int)

data class WeeklyPulse(val playedMs: Long, val dailyMs: List<Long>, val discoveries: Int, val topGenre: String?)

data class Home(
    val vibes: List<Vibe>,
    val wavePhrase: String?,
    val counts: Counts,
    val pulse: WeeklyPulse?,
    val recent: List<Track>,
    val recentlyAdded: List<Track>,
    val playlists: List<Playlist>,
    val images: Map<String, Image>,
)

data class LyricLine(val atMs: Long, val text: String)

data class Fact(val text: String, val labels: List<String>, val confirmed: Boolean)

data class Relation(val text: String, val kind: String, val trackId: String?, val artistId: String?)

/** What the player shows about the current track (`GET /player/context`). */
data class PlayerContext(
    val track: Track,
    val image: Image?,
    val lyrics: String?,
    val synced: List<LyricLine>,
    val songFacts: List<Fact>,
    val artistFacts: List<Fact>,
    val producers: List<Relation>,
    val samples: List<Relation>,
    val sampledBy: List<Relation>,
    val vibe: String?,
    val codec: String?,
    val lossless: Boolean,
    val plays: Int,
)

data class AlbumCard(val id: String, val title: String, val artist: String?, val year: Int?, val tracks: Int, val addedAt: Long, val image: Image?, val plays: Int)

data class LibrarySummary(val counts: Counts, val genres: Int, val plays: Int, val playedMs: Long, val firstAddedAt: Long?, val albumPlays: Map<String, Int>)

data class TopItem(val type: String, val id: String, val name: String, val artist: String?)

data class SearchResult(
    val query: String,
    val top: List<TopItem>,
    val tracks: List<Track>,
    val albums: List<Album>,
    val artists: List<Artist>,
    val lyrics: List<Track>,
    val sound: List<Track>,
    val images: Map<String, Image>,
    val degraded: List<String>,
)

data class ArtistPage(
    val artist: Artist,
    val trackCount: Int,
    val topTracks: List<Track>,
    val albums: List<AlbumCard>,
    val appearsOn: List<Track>,
    val images: Map<String, Image>,
    val bio: String?,
    val facets: Map<String, String>,
    val cutout: Image? = null,  // the transparent figure for the hero (v1 «cutout» mode)
    val country: String? = null,
    val countryCode: String? = null,
)
