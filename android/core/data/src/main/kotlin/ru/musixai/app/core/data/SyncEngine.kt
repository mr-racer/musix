package ru.musixai.app.core.data

import androidx.room.withTransaction
import app.musix.api.models.AlbumData
import app.musix.api.models.ArtistData
import app.musix.api.models.ImageData
import app.musix.api.models.PlaylistItemData
import app.musix.api.models.PlaylistOut
import app.musix.api.models.SettingsData
import app.musix.api.models.SignalData
import app.musix.api.models.TrackOut
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.KSerializer
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import ru.musixai.app.core.common.ApiError
import ru.musixai.app.core.database.AlbumEntity
import ru.musixai.app.core.database.ArtistEntity
import ru.musixai.app.core.database.ImageEntity
import ru.musixai.app.core.database.KvEntity
import ru.musixai.app.core.database.MusixDatabase
import ru.musixai.app.core.database.PlaylistEntity
import ru.musixai.app.core.database.PlaylistItemEntity
import ru.musixai.app.core.database.SignalEntity
import ru.musixai.app.core.database.TrackArtistEntity
import ru.musixai.app.core.database.TrackEntity
import ru.musixai.app.core.network.ApiJson
import ru.musixai.app.core.network.MusixApi
import ru.musixai.app.core.network.RawChange
import ru.musixai.app.core.network.syncPage
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Mirrors the account into Room from `/sync` (spec §2). The first run pages a snapshot;
 * after it, deltas by cursor. The cursor is saved with each page in the same transaction
 * as its rows, so a crash resumes exactly there. Changes are state-based (the server sends
 * the entity as it is now), so a replayed page is harmless.
 *
 * A snapshot stamps a new generation; when its last page lands, rows of older generations
 * are swept — they are what the server deleted while this device had no cursor. A cursor
 * the server refuses (HTTP 400/422: malformed or expired) restarts from a snapshot.
 */
@Singleton
class SyncEngine @Inject constructor(private val api: MusixApi, private val db: MusixDatabase) {
    private val mutex = Mutex()
    private val m = db.mirror()

    data class Result(val pages: Int, val changes: Int, val full: Boolean)

    suspend fun sync(limit: Int = 1000): Result = mutex.withLock {
        var cursor = m.kv(CURSOR)
        var full = cursor == null || cursor.startsWith(SNAPSHOT_MARK)
        var gen = m.kv(GEN)?.toLong() ?: 0L
        if (cursor == null) {
            gen += 1
            m.putKv(KvEntity(GEN, gen.toString()))
        }
        var pages = 0
        var changes = 0
        while (true) {
            val page = try {
                api.syncPage(cursor?.removePrefix(SNAPSHOT_MARK), limit)
            } catch (e: ApiError) {
                if ((e.status == 400 || e.status == 422) && cursor != null) {  // the cursor is refused: start over
                    gen += 1
                    db.withTransaction { m.delKv(CURSOR); m.putKv(KvEntity(GEN, gen.toString())) }
                    cursor = null
                    full = true
                    continue
                }
                throw e
            }
            // a snapshot cursor keeps its mark until the snapshot's last page: the sweep
            // must not run after a crash mid-snapshot resumes on a delta
            val snapshotting = full && page.hasMore
            db.withTransaction {
                apply(page.changes, gen)
                if (full && !page.hasMore) sweep(gen)
                m.putKv(KvEntity(CURSOR, if (snapshotting) SNAPSHOT_MARK + page.cursor else page.cursor))
            }
            pages++
            changes += page.changes.size
            cursor = if (snapshotting) SNAPSHOT_MARK + page.cursor else page.cursor
            if (!page.hasMore) break
        }
        Result(pages, changes, full)
    }

    private suspend fun apply(changes: List<RawChange>, gen: Long) {
        val del = changes.filter { it.op == "delete" || it.data == null }.groupBy({ it.entity }, { it.id })
        val up = changes.filter { it.op == "upsert" && it.data != null }.groupBy { it.entity }
        up["image"]?.let { rows -> m.images(rows.map { it.decode(ImageData.serializer()).entity(gen) }) }
        up["artist"]?.let { rows -> m.artists(rows.map { it.decode(ArtistData.serializer()).entity(gen) }) }
        up["album"]?.let { rows -> m.albums(rows.map { it.decode(AlbumData.serializer()).entity(gen) }) }
        up["track"]?.let { rows ->
            val t = rows.map { it.decode(TrackOut.serializer()) }
            m.tracks(t.map { it.entity(gen) })
            m.clearTrackArtists(t.map { it.id.toString() })
            m.trackArtists(t.flatMap { tr -> tr.artists.mapIndexed { i, a -> TrackArtistEntity(tr.id.toString(), a.id.toString(), i) } })
        }
        up["playlist"]?.let { rows -> m.playlists(rows.map { it.decode(PlaylistOut.serializer()).entity(gen) }) }
        up["playlistItem"]?.let { rows -> m.playlistItems(rows.map { it.decode(PlaylistItemData.serializer()).entity(gen) }) }
        up["signalState"]?.let { rows -> m.signals(rows.map { it.decode(SignalData.serializer()).entity(gen) }) }
        up["settings"]?.lastOrNull()?.let { m.putKv(KvEntity(SETTINGS, ApiJson.encodeToString(JsonObject.serializer(), JsonObject(it.decode(SettingsData.serializer()).value)))) }
        del["track"]?.let { m.clearTrackArtists(it); m.deleteTracks(it) }
        del["artist"]?.let { m.deleteArtists(it) }
        del["album"]?.let { m.deleteAlbums(it) }
        del["image"]?.let { m.deleteImages(it) }
        del["playlist"]?.let { m.deleteItemsOf(it); m.deletePlaylists(it) }
        del["playlistItem"]?.let { m.deleteItems(it) }
        del["signalState"]?.let { m.deleteSignals(it) }
    }

    private suspend fun sweep(gen: Long) {
        m.sweepTracks(gen); m.sweepTrackArtists(); m.sweepArtists(gen); m.sweepAlbums(gen); m.sweepImages(gen)
        m.sweepPlaylists(gen); m.sweepItems(gen); m.sweepSignals(gen)
    }

    companion object {
        const val CURSOR = "sync.cursor"
        const val GEN = "sync.gen"
        const val SETTINGS = "settings"
        private const val SNAPSHOT_MARK = "snap:"
    }
}

private fun <T> RawChange.decode(s: KSerializer<T>): T = ApiJson.decodeFromJsonElement(s, data!!)

private fun String.sortKey(): String = lowercase().trimStart('(', '[', '"', '\'', '«', ' ').removePrefix("the ")

private val artistsJson = ListSerializer(MapSerializer(String.serializer(), String.serializer()))

internal fun TrackOut.entity(gen: Long) = TrackEntity(
    id = id.toString(), title = titleDisplay ?: title, sortTitle = (titleDisplay ?: title).sortKey(), artist = artistDisplay,
    artistsJson = ApiJson.encodeToString(artistsJson, artists.map { mapOf("id" to it.id.toString(), "name" to it.name) }),
    albumId = albumId?.toString(), album = album, year = year, genre = genre, durationMs = (durationMs ?: 0).toLong(),
    trackNo = trackNo, discNo = discNo, coverImageId = coverImageId, addedAt = addedAt.toInstant().toEpochMilli(), gen = gen,
)

internal fun ArtistData.entity(gen: Long) = ArtistEntity(id.toString(), name, sortName, imageId, gen)

internal fun AlbumData.entity(gen: Long) = AlbumEntity(id.toString(), title, year, albumArtistId?.toString(), coverImageId, gen)

internal fun ImageData.entity(gen: Long) = ImageEntity(
    id = id, blurhash = blurhash, width = width, height = height,
    paletteJson = palette?.let { p ->
        ApiJson.encodeToString(JsonObject.serializer(), buildJsonObject {
            put("dominant", p.dominant); put("vibrant", p.vibrant); put("muted", p.muted)
            put("accentDark", p.accent.dark); put("accentLight", p.accent.light)
        })
    },
    urlsJson = ApiJson.encodeToString(MapSerializer(String.serializer(), String.serializer()), urls),
    gen = gen,
)

internal fun PlaylistOut.entity(gen: Long) = PlaylistEntity(
    id.toString(), name, description, coverImageId, itemCount ?: 0,
    createdAt.toInstant().toEpochMilli(), updatedAt.toInstant().toEpochMilli(), gen,
)

internal fun PlaylistItemData.entity(gen: Long) = PlaylistItemEntity(
    itemId.toString(), playlistId.toString(), trackId.toString(), position, addedAt.toInstant().toEpochMilli(), gen,
)

internal fun SignalData.entity(gen: Long) = SignalEntity(trackId.toString(), kind.value, createdAt.toInstant().toEpochMilli(), gen)
