package ru.musixai.app.core.data

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import ru.musixai.app.core.common.AppScope
import ru.musixai.app.core.database.KvEntity
import ru.musixai.app.core.database.MusixDatabase
import ru.musixai.app.core.network.ApiJson
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/** Account settings (synced, `/settings`) plus the device's listening-session id. */
@Singleton
class SettingsRepository @Inject constructor(
    private val db: MusixDatabase,
    private val outbox: Outbox,
    @ApplicationContext private val ctx: Context,
    @AppScope scope: CoroutineScope,
) {
    val value: StateFlow<JsonObject> = db.mirror().kvFlow(SyncEngine.SETTINGS)
        .map { raw -> raw?.let { runCatching { ApiJson.parseToJsonElement(it).jsonObject }.getOrNull() } ?: JsonObject(emptyMap()) }
        .stateIn(scope, SharingStarted.Eagerly, JsonObject(emptyMap()))

    fun <T> field(read: (JsonObject) -> T): Flow<T> = value.map(read)

    /** Loudness normalization, on unless turned off (spec §3). */
    val normalization: Boolean get() = value.value.path("playback", "normalize")?.jsonPrimitive?.booleanOrNull ?: true

    /** Writes one key path locally at once and sends the whole value (PUT /settings is a replace). */
    suspend fun set(vararg path: String, v: JsonElement) {
        val next = value.value.with(path.toList(), v)
        db.mirror().putKv(KvEntity(SyncEngine.SETTINGS, next.toString()))
        outbox.enqueue(Outbox.SETTINGS, "settings:${UUID.randomUUID()}", buildJsonObject { put("value", next) })
    }

    /** A listening session: the same id until 30 min without playback (the server splits
     *  sessions the same way), persisted so a restarted service continues it. */
    fun sessionId(now: Long = System.currentTimeMillis()): String {
        val p = ctx.getSharedPreferences("musix_session", Context.MODE_PRIVATE)
        val id = p.getString("id", null)
        val last = p.getLong("at", 0)
        val keep = id != null && now - last < 30 * 60_000
        val out = if (keep) id!! else UUID.randomUUID().toString()
        p.edit().putString("id", out).putLong("at", now).apply()
        return out
    }
}

private fun JsonObject.path(vararg keys: String): JsonElement? {
    var cur: JsonElement? = this
    for (k in keys) cur = (cur as? JsonObject)?.get(k) ?: return null
    return cur
}

private fun JsonObject.with(path: List<String>, v: JsonElement): JsonObject {
    if (path.isEmpty()) return this
    val head = path.first()
    val child = if (path.size == 1) v else ((this[head] as? JsonObject) ?: JsonObject(emptyMap())).with(path.drop(1), v)
    return JsonObject(this + (head to child))
}

