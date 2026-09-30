package ru.musixai.app.core.network

import app.musix.api.infrastructure.Serializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import ru.musixai.app.core.common.ApiError

/** A /sync change before its entity is known. The generated client's `oneOf` for these is
 *  unusable (openapi-generator folds it into one class typed as the last variant), so the
 *  envelope is read here and `data` is decoded per entity with the generated models. */
@Serializable
data class RawChange(val entity: String, val op: String, val id: String, val data: JsonObject? = null)

@Serializable
data class RawPage(val changes: List<RawChange>, val cursor: String, val hasMore: Boolean)

/** The generated models' Json (UUID and OffsetDateTime adapters, unknown keys ignored). */
val ApiJson: Json get() = Serializer.kotlinxSerializationJson

suspend fun MusixApi.syncPage(cursor: String?, limit: Int = 1000): RawPage = call {
    val url = "$base/api/v2/sync".toHttpUrl().newBuilder().apply {
        cursor?.let { addQueryParameter("cursor", it) }
        addQueryParameter("limit", limit.toString())
    }.build()
    client.newCall(Request.Builder().url(url).build()).execute().use { r ->
        if (!r.isSuccessful) throw ApiError(r.code, "sync: HTTP ${r.code}")
        ApiJson.decodeFromString(RawPage.serializer(), r.body.string())
    }
}

/** POST a JSON body to a v2 path (outbox replays, where the payload is already serialized). */
suspend fun MusixApi.postJson(path: String, json: String, method: String = "POST"): String = call {
    val req = Request.Builder().url("$base$path").method(method, json.toRequestBody("application/json".toMediaType())).build()
    client.newCall(req).execute().use { r ->
        if (!r.isSuccessful) throw ApiError(r.code, "$method $path: HTTP ${r.code}")
        r.body.string()
    }
}

suspend fun MusixApi.delete(path: String) = call {
    client.newCall(Request.Builder().url("$base$path").delete().build()).execute().use { r ->
        if (!r.isSuccessful && r.code != 404) throw ApiError(r.code, "DELETE $path: HTTP ${r.code}")
    }
}
