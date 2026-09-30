package ru.musixai.app.core.data

import androidx.room.withTransaction
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import ru.musixai.app.core.database.MusixDatabase
import ru.musixai.app.core.database.PlaylistEntity
import ru.musixai.app.core.database.PlaylistItemEntity
import ru.musixai.app.core.model.Playlist
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/** Playlist edits apply to Room at once (the UI never waits for the network) and go out
 *  through the outbox with client ids and client order keys — the same keys the server
 *  stores, so the next /sync delta confirms the local state instead of reshuffling it. */
@Singleton
class PlaylistRepository @Inject constructor(private val db: MusixDatabase, private val outbox: Outbox) {
    private val dao = db.playlists()

    val playlists: Flow<List<Playlist>> = dao.playlists().map { rows -> rows.map { it.model() } }

    fun items(playlistId: String): Flow<List<PlaylistItemEntity>> = dao.items(playlistId)

    suspend fun create(name: String, description: String? = null): String {
        val id = UUID.randomUUID().toString()
        val now = System.currentTimeMillis()
        db.withTransaction {
            dao.upsertPlaylist(PlaylistEntity(id, name, description, null, 0, now, now, gen = Long.MAX_VALUE))
            outbox.enqueue(Outbox.PLAYLIST_CREATE, "playlist:$id", buildJsonObject {
                put("id", id); put("name", name); description?.let { put("description", it) }
            })
        }
        return id
    }

    suspend fun rename(id: String, name: String) {
        val p = dao.playlist(id) ?: return
        db.withTransaction {
            dao.upsertPlaylist(p.copy(name = name, updatedAt = System.currentTimeMillis()))
            outbox.enqueue(Outbox.PLAYLIST_PATCH, "patch:${UUID.randomUUID()}", buildJsonObject { put("id", id); put("name", name) })
        }
    }

    suspend fun delete(id: String) = db.withTransaction {
        dao.deletePlaylist(id)
        outbox.enqueue(Outbox.PLAYLIST_DELETE, "delete:$id", buildJsonObject { put("id", id) })
    }

    /** Appends [trackIds] in order; returns their item ids. */
    suspend fun add(playlistId: String, trackIds: List<String>): List<String> = db.withTransaction {
        val last = dao.itemsNow(playlistId).lastOrNull()?.position
        val keys = Fractional.append(last, trackIds.size)
        val now = System.currentTimeMillis()
        val rows = trackIds.mapIndexed { i, t -> PlaylistItemEntity(UUID.randomUUID().toString(), playlistId, t, keys[i], now, gen = Long.MAX_VALUE) }
        dao.upsertItems(rows)
        dao.recount(playlistId, now)
        outbox.enqueue(Outbox.PLAYLIST_ADD, "add:${rows[0].itemId}", buildJsonObject {
            put("playlistId", playlistId)
            put("items", JsonArray(rows.map { buildJsonObject { put("itemId", it.itemId); put("trackId", it.trackId) } }))
            put("positions", JsonArray(keys.map(::JsonPrimitive)))
        })
        rows.map { it.itemId }
    }

    /** Moves [itemId] to sit right after [afterItemId] (null = the top). */
    suspend fun move(playlistId: String, itemId: String, afterItemId: String?) = db.withTransaction {
        val items = dao.itemsNow(playlistId).filter { it.itemId != itemId }
        val i = if (afterItemId == null) -1 else items.indexOfFirst { it.itemId == afterItemId }
        val key = Fractional.between(items.getOrNull(i)?.position, items.getOrNull(i + 1)?.position)
        dao.move(itemId, key)
        outbox.enqueue(Outbox.PLAYLIST_MOVE, "move:${UUID.randomUUID()}", buildJsonObject {
            put("playlistId", playlistId); put("itemId", itemId); put("position", key)
        })
    }

    suspend fun remove(playlistId: String, itemId: String) = db.withTransaction {
        dao.deleteItem(itemId)
        dao.recount(playlistId, System.currentTimeMillis())
        outbox.enqueue(Outbox.PLAYLIST_REMOVE, "remove:$itemId", buildJsonObject { put("playlistId", playlistId); put("itemId", itemId) })
    }
}

internal fun PlaylistEntity.model() = Playlist(id, name, description, coverImageId, itemCount, updatedAt)
