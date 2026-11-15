package ru.musixai.app.core.data

import android.util.LruCache
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import ru.musixai.app.core.model.SoundMoment
import ru.musixai.app.core.model.SoundRatings
import ru.musixai.app.core.model.SoundSection
import ru.musixai.app.core.model.SoundTag
import ru.musixai.app.core.model.StemPlace
import ru.musixai.app.core.model.TrackSound
import ru.musixai.app.core.network.MusixApi
import ru.musixai.app.core.network.getJson
import javax.inject.Inject
import javax.inject.Singleton

/** The sound of a track: the form and moments of the seek line, the parts of the «Звук» side.
 *  A 404 means the server has not measured the track yet: null, and the player goes without. */
@Singleton
class SoundRepository @Inject constructor(private val api: MusixApi) {
    private val cache = LruCache<String, TrackSound>(40)

    fun cached(trackId: String): TrackSound? = cache.get(trackId)

    suspend fun sound(trackId: String): TrackSound? {
        cache.get(trackId)?.let { return it }
        val json = runCatching { api.getJson("/api/v2/tracks/$trackId/sound") }.getOrNull() ?: return null
        val s = runCatching { parse(json.jsonObject) }.getOrNull() ?: return null
        cache.put(trackId, s)
        return s
    }

    companion object {
        private fun JsonObject.str(k: String) = this[k]?.takeIf { it !is JsonNull }?.jsonPrimitive?.content.orEmpty()
        private fun JsonObject.num(k: String) = this[k]?.takeIf { it !is JsonNull }?.jsonPrimitive?.doubleOrNull ?: 0.0
        private fun JsonElement?.tag(): SoundTag? = (this as? JsonObject)?.let { SoundTag(it.str("key"), it.str("label")) }
        private fun JsonObject.list(k: String): JsonArray = (this[k] as? JsonArray) ?: JsonArray(emptyList())

        fun parse(o: JsonObject): TrackSound {
            val r = o["ratings"]?.jsonObject
            return TrackSound(
                sections = o.list("sections").map { val x = it.jsonObject; SoundSection(x.num("start"), x.num("end"), x.str("kind"), x.str("label")) },
                moments = o.list("moments").map { val x = it.jsonObject; SoundMoment(x.num("t"), x.str("kind"), x.str("label"), x.str("section")) },
                stems = o.list("stems").map { val x = it.jsonObject
                    StemPlace(x.str("stem"), x["name"].tag() ?: SoundTag(x.str("stem"), x.str("stem")), x["side"].tag() ?: SoundTag("", ""), x.num("pan").toFloat(), x.num("width").toFloat()) },
                instruments = o.list("instruments").mapNotNull { it.tag() },
                drums = o["drums"].tag(), vocals = o["vocals"].tag(),
                echo = o["echo"].tag() ?: SoundTag("", ""), width = o["width"].tag(),
                feel = o["feel"].tag(), pace = o["pace"].tag(),
                ratings = SoundRatings(
                    tech = r?.get("tech")?.jsonPrimitive?.intOrNull ?: 0,
                    space = r?.get("space")?.takeIf { it !is JsonNull }?.jsonPrimitive?.intOrNull,
                    odd = r?.get("odd")?.jsonPrimitive?.intOrNull ?: 0,
                    facets = (r?.get("facets") as? JsonObject).orEmpty().mapValues { (_, v) ->
                        (v as? JsonObject).orEmpty().mapValues { (_, n) -> n.jsonPrimitive.intOrNull ?: 0 } },
                ),
                hasStage = o["hasStage"]?.jsonPrimitive?.booleanOrNull ?: false,
            )
        }
    }
}
