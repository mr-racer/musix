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
