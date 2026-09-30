package ru.musixai.app.core.data

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import app.musix.api.models.ImageData
import app.musix.api.models.TrackOut
import ru.musixai.app.core.model.Image
import ru.musixai.app.core.model.Track
import ru.musixai.app.core.network.ApiJson
import ru.musixai.app.core.network.MusixApi
import ru.musixai.app.core.network.getJson
import ru.musixai.app.core.network.postJson
import javax.inject.Inject
import javax.inject.Singleton

data class AssistantAnswer(val text: String?, val tracks: List<Track>, val images: Map<String, Image>, val contextId: String?, val error: String?)

/** Assistant turns (phase 2): `POST /assistant/turns` → 202, stages and `assistant.done` over
 *  the WebSocket, the result from `GET /assistant/turns/{id}`; polled if the socket is down. */
@Singleton
class AssistantRepository @Inject constructor(private val api: MusixApi, private val realtime: Realtime) {
    suspend fun ask(message: String, history: List<Pair<String, String>>, contextId: String?, nowPlaying: String?, onStage: (String) -> Unit): AssistantAnswer {
        val body = buildJsonObject {
            put("message", message); put("lang", "ru"); put("limit", 20)
            put("history", JsonArray(history.map { (r, c) -> buildJsonObject { put("role", r); put("content", c) } }))
            contextId?.let { put("contextId", it) }
            nowPlaying?.let { put("nowPlayingTrackId", it) }
        }
        val turn = ApiJson.parseToJsonElement(api.postJson("/api/v2/assistant/turns", body.toString())).jsonObject["turnId"]!!.jsonPrimitive.content
        return await(turn, onStage)
    }

    /** `track-chat`: questions about the playing track; `lyric_explain` explains a line. */
    suspend fun trackChat(trackId: String, message: String, line: String?, history: List<Pair<String, String>>, onStage: (String) -> Unit): AssistantAnswer {
        val body = buildJsonObject {
            put("trackId", trackId); put("message", message); put("lang", "ru"); put("mode", if (line != null) "lyric_explain" else "song")
            line?.let { put("selectedLine", it) }
            put("history", JsonArray(history.map { (r, c) -> buildJsonObject { put("role", r); put("content", c) } }))
        }
        val turn = ApiJson.parseToJsonElement(api.postJson("/api/v2/track-chat/turns", body.toString())).jsonObject["turnId"]!!.jsonPrimitive.content
        return await(turn, onStage)
    }

    private suspend fun await(turn: String, onStage: (String) -> Unit): AssistantAnswer {
        val done = CompletableDeferred<Unit>()
        val watcher = kotlinx.coroutines.coroutineScope {
            val job = launch {
                realtime.events.collect { e ->
                    if (e["turn"]?.jsonPrimitive?.content != turn) return@collect
                    when (e["type"]?.jsonPrimitive?.content) {
                        "assistant.stage" -> e["frame"]?.jsonObject?.get("human")?.jsonPrimitive?.content?.let(onStage)
                        "assistant.done" -> done.complete(Unit)
                    }
                }
            }
            // the socket is the fast path; a poll every 3 s covers a dropped socket
            withTimeoutOrNull(180_000) {
                while (!done.isCompleted) {
                    val t = api.getJson("/api/v2/assistant/turns/$turn").jsonObject
                    val st = t["status"]?.jsonPrimitive?.content
                    if (st == "done" || st == "error") break
                    withTimeoutOrNull(3_000) { done.await() }
                }
            }
            job.cancel()
            api.getJson("/api/v2/assistant/turns/$turn").jsonObject
        }
        return parse(watcher)
    }

    private fun parse(t: JsonObject): AssistantAnswer {
        val r = t["result"] as? JsonObject
        val tracks = (t["tracks"] as? JsonObject).orEmpty().mapNotNull { (_, v) -> runCatching { ApiJson.decodeFromJsonElement(TrackOut.serializer(), v).model() }.getOrNull() }
        val images = (t["images"] as? JsonObject).orEmpty().mapNotNull { (k, v) -> runCatching { k to ApiJson.decodeFromJsonElement(ImageData.serializer(), v).model() }.getOrNull() }.toMap()
        fun str(o: JsonObject?, k: String) = (o?.get(k) as? JsonPrimitive)?.content?.takeIf { it != "null" && it.isNotBlank() }
        val text = str(r, "answer") ?: str(r?.get("search") as? JsonObject, "message") ?: str(r?.get("clarify") as? JsonObject, "question")
            ?: str(r?.get("playlist") as? JsonObject, "title") ?: str(r?.get("facts") as? JsonObject, "answer")
        return AssistantAnswer(text, tracks, images, str(r, "context_id"), str(t, "error"))
    }
}
