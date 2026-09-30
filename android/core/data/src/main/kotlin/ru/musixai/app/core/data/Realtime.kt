package ru.musixai.app.core.data

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import ru.musixai.app.core.common.AppScope
import ru.musixai.app.core.network.ApiJson
import ru.musixai.app.core.network.MusixApi
import ru.musixai.app.core.network.SessionStore
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.math.min

/**
 * The foreground WebSocket (`/api/v2/ws`): `sync.changed` pulls a delta at once, other
 * events (assistant stages, import progress) go to [events]. Connected only while the app
 * is visible — background freshness is the periodic SyncWorker's job. A close with 4401
 * (expired token) refreshes the session with one API call and reconnects.
 */
@Singleton
class Realtime @Inject constructor(
    private val api: MusixApi,
    private val sessions: SessionStore,
    private val sync: SyncEngine,
    @AppScope private val scope: CoroutineScope,
) {
    private val _events = MutableSharedFlow<JsonObject>(extraBufferCapacity = 64)
    val events: SharedFlow<JsonObject> = _events
    private var job: Job? = null
    private var ws: WebSocket? = null
    private var lastSeq: Long? = null
    private var syncJob: Job? = null

    fun start() {
        if (job?.isActive == true) return
        job = scope.launch {
            var backoff = 1_000L
            while (true) {
                if (!sessions.current.signedIn) { delay(5_000); continue }
                val closed = kotlinx.coroutines.CompletableDeferred<Int>()
                ws = connect(closed)
                val code = closed.await()
                if (code == 4401) runCatching { api.call { identity.getSettingsApiV2SettingsGet() } }  // the authenticator refreshes
                delay(backoff)
                backoff = min(backoff * 2, 60_000)
                if (code == 1000) backoff = 1_000
            }
        }
    }

    fun stop() {
        job?.cancel(); job = null
        ws?.close(1000, "background"); ws = null
    }

    private fun connect(closed: kotlinx.coroutines.CompletableDeferred<Int>): WebSocket {
        val url = api.base.replaceFirst("http", "ws") + "/api/v2/ws"
        return api.client.newWebSocket(Request.Builder().url(url).build(), object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                webSocket.send(buildJsonObject {
                    put("type", "auth"); put("token", sessions.current.accessToken ?: ""); lastSeq?.let { put("lastSeq", it) }
                }.toString())
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                val msg = runCatching { ApiJson.parseToJsonElement(text).jsonObject }.getOrNull() ?: return
                when (msg["type"]?.jsonPrimitive?.content) {
                    "ready" -> { msg["seq"]?.jsonPrimitive?.content?.toLongOrNull()?.let { lastSeq = it }; pull() }
                    "sync.changed" -> { msg["seq"]?.jsonPrimitive?.content?.toLongOrNull()?.let { lastSeq = it }; pull() }
                    "ping" -> Unit
                    else -> _events.tryEmit(msg)
                }
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) { closed.complete(code) }
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) { closed.complete(-1) }
        })
    }

    /** Coalesces bursts: one sync in flight, one queued. */
    private fun pull() {
        if (syncJob?.isActive == true) return
        syncJob = scope.launch { delay(300); runCatching { sync.sync() } }
    }
}
