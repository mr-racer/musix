package ru.musixai.app.core.data

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import ru.musixai.app.core.network.ApiJson
import ru.musixai.app.core.network.MusixApi
import ru.musixai.app.core.network.getJson
import ru.musixai.app.core.network.postJson
import javax.inject.Inject
import javax.inject.Singleton

data class QuizMode(val key: String, val available: Boolean, val inputKind: String)
data class QuizOption(val id: String, val title: String, val artist: String, val year: String?, val audioUrl: String?)
data class QuizRound(val id: String, val mode: String, val audioUrl: String?, val lengthSec: Double, val inputKind: String, val options: List<QuizOption>)
data class QuizAnswer(val correct: Boolean, val correctOptionId: String?, val score: Double, val truth: JsonObject)

/** The quiz («Игра»): rounds are server state; the snippet is a signed URL of a cut, so the
 *  question never carries the track's identity (quiz invariant I-2 keeps it off the listens). */
@Singleton
class QuizRepository @Inject constructor(private val api: MusixApi) {
    suspend fun modes(): List<QuizMode> = api.getJson("/api/v2/quiz/modes").jsonArray.map {
        val o = it.jsonObject
        QuizMode(o.s("key"), o["available"]?.jsonPrimitive?.content == "true", o.s("inputKind"))
    }

    suspend fun round(mode: String): QuizRound {
        val o = ApiJson.parseToJsonElement(api.postJson("/api/v2/quiz/rounds", buildJsonObject { put("mode", mode) }.toString())).jsonObject
        return QuizRound(o.s("roundId"), o.s("mode"), o["audioUrl"]?.jsonPrimitive?.content?.takeIf { it != "null" },
            o["lengthSec"]?.jsonPrimitive?.content?.toDoubleOrNull() ?: 3.0, o.s("inputKind"),
            o["options"]?.jsonArray.orEmpty().map { e ->
                val p = e.jsonObject
                QuizOption(p.s("option_id").ifEmpty { p.s("optionId") }, p.s("title"), p.s("artist"), p["year"]?.jsonPrimitive?.content?.takeIf { it != "null" },
                    (p["audio_url"] ?: p["audioUrl"])?.jsonPrimitive?.content?.takeIf { it != "null" })
            })
    }

    suspend fun answer(roundId: String, optionId: String?, year: Int? = null): QuizAnswer {
        val o = ApiJson.parseToJsonElement(api.postJson("/api/v2/quiz/rounds/$roundId/answer",
            buildJsonObject { optionId?.let { put("optionId", it) }; year?.let { put("year", it) } }.toString())).jsonObject
        return QuizAnswer(o["correct"]?.jsonPrimitive?.content == "true", o["correctOptionId"]?.jsonPrimitive?.content?.takeIf { it != "null" },
            o["score"]?.jsonPrimitive?.content?.toDoubleOrNull() ?: 0.0, o["truth"]?.jsonObject ?: JsonObject(emptyMap()))
    }

    private fun JsonObject.s(k: String) = this[k]?.jsonPrimitive?.content.orEmpty()
}
