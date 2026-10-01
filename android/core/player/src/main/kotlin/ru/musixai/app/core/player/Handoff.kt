package ru.musixai.app.core.player

import app.musix.api.models.TransferIn
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import ru.musixai.app.core.common.AppScope
import ru.musixai.app.core.data.Realtime
import ru.musixai.app.core.network.MusixApi
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * «Слушать на…» (phase 8 §1), the app's side. It runs whether the player service is alive or
 * not:
 * - every `ready` says this phone can play;
 * - a `take` goes through the MediaController, which starts the service if needed;
 * - another device's `playback.state` is the «Играет на …» bar.
 * The service itself publishes the state and applies `release` and remote commands, because
 * it owns the queue.
 */
@Singleton
class Handoff @Inject constructor(
    private val api: MusixApi,
    private val realtime: Realtime,
    private val player: PlayerController,
    @AppScope private val scope: CoroutineScope,
) {
    data class Remote(val device: String, val trackId: String?, val playing: Boolean)
    data class Device(val id: UUID, val name: String, val platform: String, val canPlay: Boolean, val current: Boolean, val active: Boolean)

    private val _remote = MutableStateFlow<Remote?>(null)
    val remote: StateFlow<Remote?> = _remote

    fun start() {
        scope.launch { realtime.events.collect(::on) }
        scope.launch { player.state.collect { if (it.isPlaying) _remote.value = null } }  // the music is here now
    }

    private suspend fun on(msg: JsonObject) {
        when (msg["type"]?.jsonPrimitive?.contentOrNull) {
            "ready" -> realtime.send(buildJsonObject { put("type", "device.hello"); put("canPlay", true) })
            "playback.take" -> {
                _remote.value = null
                withContext(Dispatchers.Main) { player.take(msg["play"]?.jsonPrimitive?.booleanOrNull ?: true) }
            }
            "playback.state" -> {
                val device = msg["device"]?.jsonPrimitive?.contentOrNull ?: return
                _remote.value = Remote(device, msg["trackId"]?.jsonPrimitive?.contentOrNull, msg["playing"]?.jsonPrimitive?.booleanOrNull == true)
            }
        }
    }

    suspend fun devices(): List<Device> = api.call { handoff.activeDevicesApiV2DevicesActiveGet() }
        .map { Device(it.id, it.name, it.platform, it.canPlay, it.current, it.active) }

    suspend fun transfer(to: UUID) { api.call { handoff.transferApiV2PlaybackTransferPost(TransferIn(toDevice = to, play = true)) } }
}
