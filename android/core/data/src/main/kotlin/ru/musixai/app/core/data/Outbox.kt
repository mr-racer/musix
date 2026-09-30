package ru.musixai.app.core.data

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import ru.musixai.app.core.common.ApiError
import ru.musixai.app.core.database.OutboxDao
import ru.musixai.app.core.database.OutboxEntity
import ru.musixai.app.core.network.ApiJson
import ru.musixai.app.core.network.MusixApi
import ru.musixai.app.core.network.delete
import ru.musixai.app.core.network.postJson
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Mutations made on the device (spec §2): each is a Room row with the client id the server
 * dedupes on as its key, replayed in order by [flush]. A crash between "sent" and "deleted"
 * replays the row, and the server answers the replay as a duplicate — never a second copy.
 *
 * Failures: a network error, 429 or 5xx stops the flush (the rest waits, in order, for the
 * next attempt); any other 4xx is permanent — the row is dropped, or it would block every
 * mutation behind it forever.
 */
@Singleton
class Outbox @Inject constructor(private val dao: OutboxDao, private val api: MusixApi) {
    private val mutex = Mutex()
    val pending: Flow<Int> = dao.size()
    /** Called after an enqueue so the platform can schedule a flush (WorkManager). */
    var onEnqueue: () -> Unit = {}

    suspend fun enqueue(kind: String, key: String, payload: JsonObject) {
        dao.add(OutboxEntity(kind = kind, key = key, payload = payload.toString(), createdAt = System.currentTimeMillis()))
        onEnqueue()
    }

    sealed interface Flush {
        data object Done : Flush
        data class Retry(val reason: String) : Flush
    }

    suspend fun flush(): Flush = mutex.withLock { drain() }

    private suspend fun drain(): Flush {
        while (true) {
            val head = dao.head(100)
            if (head.isEmpty()) return Flush.Done
            // consecutive listens go as one batch; anything else goes alone, in order
            val batch = if (head[0].kind == LISTEN) head.takeWhile { it.kind == LISTEN } else head.take(1)
            try {
                send(batch)
                dao.done(batch.map { it.seq })
            } catch (e: ApiError) {
                if (e.status == 401 || e.status == 408 || e.status == 429 || e.status >= 500) {
                    dao.failed(batch.map { it.seq }, "HTTP ${e.status}")
                    return Flush.Retry("HTTP ${e.status}")
                }
                dao.done(batch.map { it.seq })  // permanent: the server will never take it
            } catch (e: IOException) {
                dao.failed(batch.map { it.seq }, e.javaClass.simpleName)
                return Flush.Retry(e.javaClass.simpleName)
            }
        }
    }

    private suspend fun send(batch: List<OutboxEntity>) {
        val first = batch[0]
        val p = ApiJson.parseToJsonElement(first.payload).jsonObject
        fun s(k: String) = p[k]!!.jsonPrimitive.content
        when (first.kind) {
            LISTEN -> api.postJson("/api/v2/events/listens:batch",
                JsonObject(mapOf("events" to JsonArray(batch.map { ApiJson.parseToJsonElement(it.payload) }))).toString())
            SIGNAL -> api.postJson("/api/v2/tracks/${s("trackId")}/signals",
                buildJsonObject { put("kind", s("kind")); put("clientEventId", s("clientEventId")); p["sessionId"]?.let { put("sessionId", it) } }.toString())
            PLAYLIST_CREATE -> api.postJson("/api/v2/playlists", first.payload)
            PLAYLIST_PATCH -> api.postJson("/api/v2/playlists/${s("id")}", JsonObject(p - "id").toString(), "PATCH")
            PLAYLIST_DELETE -> api.delete("/api/v2/playlists/${s("id")}")
            PLAYLIST_ADD -> api.postJson("/api/v2/playlists/${s("playlistId")}/items", JsonObject(p - "playlistId").toString())
            PLAYLIST_MOVE -> api.postJson("/api/v2/playlists/${s("playlistId")}/items/${s("itemId")}",
                buildJsonObject { put("position", s("position")) }.toString(), "PATCH")
            PLAYLIST_REMOVE -> api.delete("/api/v2/playlists/${s("playlistId")}/items/${s("itemId")}")
            SETTINGS -> api.postJson("/api/v2/settings", first.payload, "PUT")
            else -> Unit  // an unknown kind from a newer build: dropped
        }
    }

    companion object {
        const val LISTEN = "listen"
        const val SIGNAL = "signal"
        const val PLAYLIST_CREATE = "playlist.create"
        const val PLAYLIST_PATCH = "playlist.patch"
        const val PLAYLIST_DELETE = "playlist.delete"
        const val PLAYLIST_ADD = "playlist.add"
        const val PLAYLIST_MOVE = "playlist.move"
        const val PLAYLIST_REMOVE = "playlist.remove"
        const val SETTINGS = "settings"
    }
}
