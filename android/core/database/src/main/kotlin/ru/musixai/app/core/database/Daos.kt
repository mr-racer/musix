package ru.musixai.app.core.database

import androidx.paging.PagingSource
import androidx.room.Dao
import androidx.room.Query
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

@Dao
interface MirrorDao {
    @Upsert suspend fun tracks(rows: List<TrackEntity>)
    @Upsert suspend fun trackArtists(rows: List<TrackArtistEntity>)
    @Upsert suspend fun artists(rows: List<ArtistEntity>)
    @Upsert suspend fun albums(rows: List<AlbumEntity>)
    @Upsert suspend fun images(rows: List<ImageEntity>)
    @Upsert suspend fun playlists(rows: List<PlaylistEntity>)
    @Upsert suspend fun playlistItems(rows: List<PlaylistItemEntity>)
    @Upsert suspend fun signals(rows: List<SignalEntity>)

    @Query("DELETE FROM track_artists WHERE trackId IN (:ids)") suspend fun clearTrackArtists(ids: List<String>)
    @Query("DELETE FROM tracks WHERE id IN (:ids)") suspend fun deleteTracks(ids: List<String>)
    @Query("DELETE FROM artists WHERE id IN (:ids)") suspend fun deleteArtists(ids: List<String>)
    @Query("DELETE FROM albums WHERE id IN (:ids)") suspend fun deleteAlbums(ids: List<String>)
    @Query("DELETE FROM images WHERE id IN (:ids)") suspend fun deleteImages(ids: List<String>)
    @Query("DELETE FROM playlists WHERE id IN (:ids)") suspend fun deletePlaylists(ids: List<String>)
    @Query("DELETE FROM playlist_items WHERE itemId IN (:ids)") suspend fun deleteItems(ids: List<String>)
    @Query("DELETE FROM playlist_items WHERE playlistId IN (:ids)") suspend fun deleteItemsOf(ids: List<String>)
    @Query("DELETE FROM signals WHERE trackId IN (:ids)") suspend fun deleteSignals(ids: List<String>)

    // the sweep after a full resync: rows the snapshot did not carry are gone on the server
    @Query("DELETE FROM tracks WHERE gen < :gen") suspend fun sweepTracks(gen: Long)
    @Query("DELETE FROM track_artists WHERE trackId NOT IN (SELECT id FROM tracks)") suspend fun sweepTrackArtists()
    @Query("DELETE FROM artists WHERE gen < :gen") suspend fun sweepArtists(gen: Long)
    @Query("DELETE FROM albums WHERE gen < :gen") suspend fun sweepAlbums(gen: Long)
    @Query("DELETE FROM images WHERE gen < :gen") suspend fun sweepImages(gen: Long)
    @Query("DELETE FROM playlists WHERE gen < :gen") suspend fun sweepPlaylists(gen: Long)
    @Query("DELETE FROM playlist_items WHERE gen < :gen") suspend fun sweepItems(gen: Long)
    @Query("DELETE FROM signals WHERE gen < :gen") suspend fun sweepSignals(gen: Long)

    @Query("SELECT value FROM kv WHERE `key` = :key") suspend fun kv(key: String): String?
    @Query("SELECT value FROM kv WHERE `key` = :key") fun kvFlow(key: String): Flow<String?>
    @Upsert suspend fun putKv(row: KvEntity)
    @Query("DELETE FROM kv WHERE `key` = :key") suspend fun delKv(key: String)
}

@Dao
interface LibraryDao {
    @Query("SELECT COUNT(*) FROM tracks") fun trackCount(): Flow<Int>
    @Query("SELECT * FROM tracks WHERE id = :id") suspend fun track(id: String): TrackEntity?
    @Query("SELECT * FROM tracks WHERE id IN (:ids)") suspend fun tracks(ids: List<String>): List<TrackEntity>
    @Query("SELECT * FROM tracks ORDER BY sortTitle, id") fun byTitle(): PagingSource<Int, TrackEntity>
    @Query("SELECT * FROM tracks ORDER BY addedAt DESC, id") fun byAdded(): PagingSource<Int, TrackEntity>
    @Query("SELECT * FROM tracks ORDER BY year IS NULL, year DESC, sortTitle, id") fun byYear(): PagingSource<Int, TrackEntity>
    @Query("SELECT * FROM tracks WHERE albumId = :albumId ORDER BY discNo, trackNo, sortTitle") fun albumTracks(albumId: String): Flow<List<TrackEntity>>
    @Query("SELECT * FROM albums ORDER BY title") fun albums(): Flow<List<AlbumEntity>>
    @Query("SELECT * FROM images WHERE id IN (:ids)") suspend fun images(ids: List<String>): List<ImageEntity>
    @Query("SELECT * FROM images WHERE id = :id") fun image(id: String): Flow<ImageEntity?>
    @Query("SELECT * FROM signals WHERE trackId = :trackId") fun signal(trackId: String): Flow<SignalEntity?>
}

@Dao
interface PlaylistDao {
    @Query("SELECT * FROM playlists ORDER BY updatedAt DESC") fun playlists(): Flow<List<PlaylistEntity>>
    @Query("SELECT * FROM playlists WHERE id = :id") suspend fun playlist(id: String): PlaylistEntity?
    @Query("SELECT * FROM playlist_items WHERE playlistId = :id ORDER BY position COLLATE BINARY") fun items(id: String): Flow<List<PlaylistItemEntity>>
    @Query("SELECT * FROM playlist_items WHERE playlistId = :id ORDER BY position COLLATE BINARY") suspend fun itemsNow(id: String): List<PlaylistItemEntity>
    @Upsert suspend fun upsertPlaylist(row: PlaylistEntity)
    @Upsert suspend fun upsertItems(rows: List<PlaylistItemEntity>)
    @Query("DELETE FROM playlist_items WHERE itemId = :itemId") suspend fun deleteItem(itemId: String)
    @Query("UPDATE playlist_items SET position = :position WHERE itemId = :itemId") suspend fun move(itemId: String, position: String)
    @Query("DELETE FROM playlists WHERE id = :id") suspend fun deletePlaylist(id: String)
    @Query("UPDATE playlists SET itemCount = (SELECT COUNT(*) FROM playlist_items WHERE playlistId = :id), updatedAt = :now WHERE id = :id")
    suspend fun recount(id: String, now: Long)
}

@Dao
interface OutboxDao {
    /** INSERT OR IGNORE: enqueueing the same idempotency key twice is one mutation */
    @androidx.room.Insert(onConflict = androidx.room.OnConflictStrategy.IGNORE) suspend fun add(row: OutboxEntity): Long
    @Query("SELECT * FROM outbox ORDER BY seq LIMIT :n") suspend fun head(n: Int): List<OutboxEntity>
    @Query("SELECT COUNT(*) FROM outbox") fun size(): Flow<Int>
    @Query("DELETE FROM outbox WHERE seq IN (:seqs)") suspend fun done(seqs: List<Long>)
    @Query("UPDATE outbox SET attempts = attempts + 1, lastError = :error WHERE seq IN (:seqs)") suspend fun failed(seqs: List<Long>, error: String)
}
