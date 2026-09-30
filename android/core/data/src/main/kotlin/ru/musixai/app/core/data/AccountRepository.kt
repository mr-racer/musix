package ru.musixai.app.core.data

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import ru.musixai.app.core.network.MusixApi
import ru.musixai.app.core.network.delete
import ru.musixai.app.core.network.getJson
import ru.musixai.app.core.network.patchBytes
import ru.musixai.app.core.network.postJson
import ru.musixai.app.core.network.ApiJson
import java.io.InputStream
import java.security.MessageDigest
import javax.inject.Inject
import javax.inject.Singleton

data class Device(val id: String, val name: String, val platform: String, val current: Boolean, val lastSeenAt: String)
data class YandexLink(val linked: Boolean, val login: String?)
data class YandexAuth(val sessionId: String, val userCode: String, val verificationUrl: String, val status: String, val reason: String?)
data class YandexSource(val title: String, val trackCount: Int, val raw: JsonElement)
data class Release(val versionCode: Int, val versionName: String, val url: String, val sha256: String, val notes: String)

/** Devices, the Yandex import, uploads and the app update — the account's side screens. */
@Singleton
class AccountRepository @Inject constructor(private val api: MusixApi) {
    suspend fun devices(): List<Device> = api.getJson("/api/v2/devices").jsonArray.map {
        val o = it.jsonObject
        Device(o.s("id"), o.s("name"), o.s("platform"), o["current"]?.jsonPrimitive?.content == "true", o.s("lastSeenAt"))
    }

    suspend fun signOutDevice(id: String) = api.delete("/api/v2/devices/$id")

    suspend fun yandexLink(): YandexLink = api.getJson("/api/v2/imports/yandex").jsonObject.let {
        YandexLink(it["linked"]?.jsonPrimitive?.content == "true", it["login"]?.jsonPrimitive?.contentOrNullSafe())
    }

    suspend fun yandexStart(): YandexAuth = ApiJson.parseToJsonElement(api.postJson("/api/v2/imports/yandex/auth", "{}")).jsonObject.auth()
    suspend fun yandexPoll(session: String): YandexAuth = api.getJson("/api/v2/imports/yandex/auth/$session").jsonObject.auth()
    suspend fun yandexUnlink() = api.delete("/api/v2/imports/yandex")

    suspend fun yandexSources(): List<YandexSource> = api.getJson("/api/v2/imports/yandex/sources").jsonArray.map {
        val o = it.jsonObject
        YandexSource(o.s("title"), o["trackCount"]?.jsonPrimitive?.content?.toIntOrNull() ?: 0, o["source"]!!)
    }

    suspend fun yandexImport(sources: List<YandexSource>): String =
        ApiJson.parseToJsonElement(api.postJson("/api/v2/imports/yandex/import", JsonObject(mapOf("sources" to JsonArray(sources.map { it.raw }))).toString()))
            .jsonObject.s("jobId")

    suspend fun latest(): Release? = runCatching {
        api.getJson("/api/v2/app/android/latest").jsonObject.let { o ->
            Release(o.s("versionCode").toInt(), o.s("versionName"), o.s("url"), o.s("sha256"), o.s("notes"))
        }
    }.getOrNull()

    /**
     * A local file → sha256 → `POST /uploads` (the server may already have those bytes:
     * then nothing is sent) → PATCH chunks from the server's offset, so an interrupted
     * upload resumes where it stopped (phase 1 §5.2).
     */
    suspend fun upload(name: String, size: Long, open: () -> InputStream, progress: (Long) -> Unit): String {
        val md = MessageDigest.getInstance("SHA-256")
        open().use { s -> val buf = ByteArray(1 shl 16); while (true) { val n = s.read(buf); if (n < 0) break; md.update(buf, 0, n) } }
        val sha = md.digest().joinToString("") { "%02x".format(it) }
        val created = ApiJson.parseToJsonElement(api.postJson("/api/v2/uploads",
            buildJsonObject { put("filename", name); put("sha256", sha); put("size", size) }.toString())).jsonObject
        if (created["exists"]?.jsonPrimitive?.content == "true") { progress(size); return "exists" }
        val id = created.s("id")
        var offset = created["offset"]?.jsonPrimitive?.content?.toLongOrNull() ?: 0L
        open().use { s ->
            s.skip(offset)
            val buf = ByteArray(4 shl 20)
            while (offset < size) {
                var n = 0
                while (n < buf.size) { val r = s.read(buf, n, buf.size - n); if (r < 0) break; n += r }
                if (n == 0) break
                val out = ApiJson.parseToJsonElement(api.patchBytes("/api/v2/uploads/$id", offset, buf, n)).jsonObject
                offset = out["offset"]?.jsonPrimitive?.content?.toLongOrNull() ?: (offset + n)
                progress(offset)
            }
        }
        return id
    }

    private fun JsonObject.s(k: String) = this[k]?.jsonPrimitive?.content.orEmpty()
    private fun JsonPrimitive.contentOrNullSafe() = content.takeIf { it != "null" }
    private fun JsonObject.auth() = YandexAuth(s("sessionId"), s("userCode"), s("verificationUrl"), s("status"), this["reason"]?.jsonPrimitive?.content?.takeIf { it != "null" })

}
