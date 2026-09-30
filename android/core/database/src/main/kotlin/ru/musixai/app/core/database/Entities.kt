package ru.musixai.app.core.database

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/** The local mirror of /sync (spec §2: Room is the source of truth). Every mirrored row
 *  carries `gen`: a full resync stamps a new generation and sweeps the rows it did not
 *  see, so a server-side delete made while the cursor was lost still disappears. */

@Entity(tableName = "tracks", indices = [Index("albumId"), Index("addedAt"), Index("sortTitle")])
data class TrackEntity(
    @PrimaryKey val id: String,
    val title: String,
    val sortTitle: String,
    val artist: String,
    val artistsJson: String,  // [{"id","name"}], main artist first
    val albumId: String?,
    val album: String?,
    val year: Int?,
    val genre: String?,
    val durationMs: Long,
    val trackNo: Int?,
    val discNo: Int?,
    val coverImageId: String?,
    val addedAt: Long,
    val gen: Long,
)

@Entity(tableName = "track_artists", primaryKeys = ["trackId", "artistId"], indices = [Index("artistId")])
data class TrackArtistEntity(val trackId: String, val artistId: String, val position: Int)

@Entity(tableName = "artists")
data class ArtistEntity(@PrimaryKey val id: String, val name: String, val sortName: String?, val imageId: String?, val gen: Long)

@Entity(tableName = "albums")
data class AlbumEntity(@PrimaryKey val id: String, val title: String, val year: Int?, val albumArtistId: String?, val coverImageId: String?, val gen: Long)

@Entity(tableName = "images")
data class ImageEntity(
    @PrimaryKey val id: String,
    val blurhash: String?,
    val width: Int?,
    val height: Int?,
    val paletteJson: String?,
    val urlsJson: String,
    val gen: Long,
)

@Entity(tableName = "playlists")
data class PlaylistEntity(
    @PrimaryKey val id: String,
    val name: String,
    val description: String?,
    val coverImageId: String?,
    val itemCount: Int,
    val createdAt: Long,
    val updatedAt: Long,
    val gen: Long,
)

@Entity(tableName = "playlist_items", indices = [Index(value = ["playlistId", "position"])])
data class PlaylistItemEntity(
    @PrimaryKey val itemId: String,
    val playlistId: String,
    val trackId: String,
    val position: String,  // a fractional key, compared bytewise (as the server's COLLATE "C")
    val addedAt: Long,
    val gen: Long,
)

/** The latest огонёк/вода per track. */
@Entity(tableName = "signals")
data class SignalEntity(@PrimaryKey val trackId: String, val kind: String, val createdAt: Long, val gen: Long)

@Entity(tableName = "kv")
data class KvEntity(@PrimaryKey val key: String, val value: String)

/** A mutation made on the device, sent by the outbox worker. `key` is its idempotency key
 *  (the client id the server dedupes on), so a replay after a crash is harmless. */
@Entity(tableName = "outbox", indices = [Index(value = ["key"], unique = true)])
data class OutboxEntity(
    @androidx.room.PrimaryKey(autoGenerate = true) val seq: Long = 0,
    val kind: String,
    val key: String,
    val payload: String,
    val createdAt: Long,
    val attempts: Int = 0,
    val lastError: String? = null,
)
