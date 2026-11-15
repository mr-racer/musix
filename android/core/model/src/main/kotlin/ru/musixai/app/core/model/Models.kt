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
    /** The server's pre-blurred backdrop of the picture (`urls["bg"]`): a field of its colour, no blur on the phone. */
    val bg: String? = null,
) {
    /** The smallest variant at least [px] wide, else the largest. */
    fun url(px: Int): String? = urls.entries.sortedBy { it.key }.let { v -> (v.firstOrNull { it.key >= px } ?: v.lastOrNull())?.value }
}

data class Artist(val id: String, val name: String, val sortName: String?, val imageId: String?)

/** A «Настроить волну» choice (`GET /stream/presets`): a familiarity row and an optional sound row. */
data class WavePreset(val id: String, val row: String, val label: String)

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
    val dayAlbum: DayAlbum? = null,
    val weather: Weather? = null,
)

/** The instance's sky: clear | cloudy | rain | snow, and the temperature when known. */
data class Weather(val kind: String, val temperatureC: Double?)

/** «Альбом дня» (`HomeOut.dayAlbum`): one a day, the same on every device. The numbers stand
 *  as the day began; only [DayTrack.heard] moves. The phrases are written here, from them. */
data class DayAlbum(
    val kind: String,  // long | one | never
    val day: java.time.LocalDate,
    val albumId: String,
    val title: String,
    val artist: String?,
    val year: Int?,
    val coverImageId: String?,
    val tracks: List<DayTrack>,
    val plays: Int,
    val lastPlayedAt: Long?,
    val songId: String?,
    val songPlays: Int,
    val artistRank: Int?,
    val artistPlayedMin: Int,  // minutes with the album artist, before the day
    val otherAlbumsHeard: Int,
)

data class DayTrack(val id: String, val title: String, val durationMs: Long, val heard: Boolean)

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
    /** The editorial photo (a square, or a 2:1 [wide] one); null = the artist's own image. */
    val photo: Image? = null,
    val wide: Image? = null,
    /** The transparent logo, drawn instead of the name when there is one. */
    val logo: Image? = null,
    /** The editorial page colour (#rrggbb): a light one tames the photo. */
    val pageColor: String? = null,
    val grammy: Grammy? = null,
    /** «А ты знал»: short facts, at most eight. */
    val facts: List<String> = emptyList(),
    /** The listener and this artist: plays, songs heard, the place among the library's artists. */
    val you: ArtistYou? = null,
    /** albumId → songs of it the listener has heard. */
    val heard: Map<String, Int> = emptyMap(),
    /** trackId → plays (the top tracks). */
    val plays: Map<String, Int> = emptyMap(),
    /** The album shelf with original years (a reissue stands where the album was born). */
    val shelf: List<ShelfAlbum> = emptyList(),
)

/** An album as the artist's discography shows it: [year] is the original year. */
data class ShelfAlbum(val id: String, val title: String, val year: Int?, val tracks: Int, val image: Image?, val durationMs: Long)

data class Grammy(val wins: Int, val nominations: Int, val position: Int, val laureates: Int)

/** [rank] among the [artists] of the library by plays (1 = the most played); null = never played. */
data class ArtistYou(val plays: Int, val heardTracks: Int, val rank: Int?, val artists: Int)

/** A producer of an album's songs; [artistId] when the library knows them as an artist. */
data class Credit(val name: String, val artistId: String?, val songs: Int)

/** The album page (`GET /albums/{id}`): its songs in order with the listener's plays. */
data class AlbumPage(
    val id: String,
    val title: String,
    val artistId: String?,
    val artist: String?,
    /** The original year when known (a reissue keeps the album's own year). */
    val year: Int?,
    val image: Image?,
    val tracks: List<Track>,
    val durationMs: Long,
    /** trackId → plays; a song with none is «ещё не слышал». */
    val trackPlays: Map<String, Int>,
    val producers: List<Credit>,
    val label: String?,
    val lastPlayedAt: Long?,
    val images: Map<String, Image>,
)
