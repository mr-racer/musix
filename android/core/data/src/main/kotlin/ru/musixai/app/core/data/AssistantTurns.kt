package ru.musixai.app.core.data

import app.musix.api.models.ImageData
import app.musix.api.models.TrackOut
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import ru.musixai.app.core.model.Image
import ru.musixai.app.core.model.Track
import ru.musixai.app.core.network.ApiJson
import ru.musixai.app.core.network.MusixApi
import ru.musixai.app.core.network.delete
import ru.musixai.app.core.network.getJson
import ru.musixai.app.core.network.postJson
import javax.inject.Inject
import javax.inject.Singleton

/*
 * The assistant page's turns in v1's payload shape (`result` of GET /assistant/turns/{id}):
 * three result kinds that read as three things (playlist, search, answer), plus the two
 * questions back (clarify, disambiguate). Track rows resolve through the turn's `tracks`
 * side-table, so a row always has v2's cover and ids.
 */

/** One row of a result: v1's track dict, resolved to the library's track when it names one. */
data class AsxTrack(val id: String?, val title: String, val artist: String, val reason: String?, val track: Track?, val cover: Image?)
data class AsxPlaylist(val title: String?, val tracks: List<AsxTrack>)
data class AsxHit(val track: AsxTrack, val matchedOn: String?, val matchedLine: String?, val lyrics: String?)
data class AsxSearch(val message: String?, val best: AsxHit?, val hits: List<AsxHit>)
data class AsxEvidence(val n: Int, val kind: String?, val source: String?, val url: String?, val text: String, val used: Boolean)
data class AsxSubject(val kind: String, val title: String?, val subtitle: String?, val trackId: String?, val artistSlug: String?, val image: Image?)
data class AsxAnswer(
    val text: String, val evidence: List<AsxEvidence>, val subject: AsxSubject?, val focusFact: String?, val focusKind: String?,
    val explained: Boolean?, val grounded: Boolean?, val followUps: List<String>, val related: List<AsxTrack>,
)
data class AsxChoice(val intent: String, val label: String)
data class AsxWho(val title: String, val subtitle: String?, val trackId: String?, val artistSlug: String?, val cover: Image?)

data class AsxTurn(
    val intent: String?, val playlist: AsxPlaylist?, val search: AsxSearch?, val answer: AsxAnswer?,
    val clarify: List<AsxChoice>, val disambiguate: List<AsxWho>, val slots: JsonObject?, val contextId: String?, val error: String?,
) {
    /** v1 `asxTurnEmpty`: the branch ran but has nothing to show — the orb goes red for that. */
    val empty: Boolean get() = when {
        clarify.isNotEmpty() || disambiguate.isNotEmpty() -> false
        playlist != null -> playlist.tracks.isEmpty()
        search != null -> search.best == null && search.hits.isEmpty()
        answer != null -> answer.text.isBlank()
        else -> true
    }
}

/** A progress frame: `route` carries the intent (~200 ms in), the rest a human line. */
data class AsxFrame(val stage: String?, val human: String?, val intent: String?)

/** What a pre-written turn pins (v1 `send(text, opts)`). */
data class AsxOptions(
    val intent: String? = null, val subjectTrackId: String? = null, val subjectArtistSlug: String? = null,
    val focusFact: String? = null, val focusKind: String? = null, val contextId: String? = null, val allowWeb: Boolean? = null,
)

/** «Интересное в вашей музыке»: a fact line, what pins its explanation, its picture. */
data class AsxIdea(val fact: String, val kind: String, val title: String?, val artist: String?, val trackId: String?, val artistSlug: String?, val image: Image?)
/** «Что зашито в битах»: a samples hook card (a turn to send). */
data class AsxSampleCard(val prompt: String, val intent: String?, val trackId: String?, val badge: String?, val cover: Image?)

@Singleton
class AssistantTurns @Inject constructor(private val api: MusixApi, private val realtime: Realtime, private val assistant: AssistantRepository) {

    suspend fun send(message: String, opts: AsxOptions, history: List<Pair<String, String>>, slots: JsonObject?, nowPlaying: String?, onFrame: (AsxFrame) -> Unit): AsxTurn {
        val body = buildJsonObject {
            put("message", message); put("lang", "ru"); put("limit", 20)
            put("history", JsonArray(history.map { (r, c) -> buildJsonObject { put("role", r); put("content", c) } }))
            slots?.let { put("slots", it) }
            opts.intent?.let { put("intent", it) }
            opts.subjectTrackId?.let { put("subjectTrackId", it) }
            opts.subjectArtistSlug?.let { put("subjectArtistSlug", it) }
            opts.focusFact?.let { put("focusFact", it.take(600)) }
            opts.focusKind?.let { put("focusKind", it) }
            opts.contextId?.let { put("contextId", it) }
            opts.allowWeb?.let { put("allowWeb", it) }
            nowPlaying?.let { put("nowPlayingTrackId", it) }
        }
        val turn = ApiJson.parseToJsonElement(api.postJson("/api/v2/assistant/turns", body.toString())).jsonObject["turnId"]!!.jsonPrimitive.content
        return parse(assistant.awaitTurn(turn) { f ->
            onFrame(AsxFrame(f.str("stage"), f.str("human"), f.str("intent")))
        })
    }

    /** Frees the pages a turn read (v1 resetTurn): a no-op server-side, fire and forget. */
    suspend fun release(contextId: String) { runCatching { api.delete("/api/v2/assistant/contexts/$contextId") } }

    /** The assistant names artists by slug; pages open by id. */
    suspend fun artistId(slug: String): String? = runCatching {
        (api.getJson("/api/v2/artists/by-slug/${java.net.URLEncoder.encode(slug, "UTF-8")}").jsonObject["id"] as? JsonPrimitive)?.content
    }.getOrNull()

    suspend fun ideas(): List<AsxIdea> = runCatching {
        val o = api.getJson("/api/v2/assistant/ideas?lang=ru&limit=6").jsonObject
        val images = o.images()
        (o["ideas"] as? JsonArray).orEmpty().mapNotNull { e ->
            val i = e as? JsonObject ?: return@mapNotNull null
            AsxIdea(i.str("fact") ?: return@mapNotNull null, i.str("kind") ?: "song", i.str("title"), i.str("artist"),
                i.str("trackId"), i.str("artistSlug"), i.str("imageId")?.let { images[it] })
        }.filter { it.fact.length <= 220 }.take(3)
    }.getOrDefault(emptyList())

    /** v1 took only the «samples» kind for the page (the name-cards carried nothing to read). */
    suspend fun samples(): List<AsxSampleCard> = runCatching {
        val o = api.getJson("/api/v2/assistant/discoveries?lang=ru&limit=16").jsonObject
        val images = o.images()
        val tracks = o.tracks(images)
        (o["cards"] as? JsonArray).orEmpty().mapNotNull { it as? JsonObject }.filter { it.str("kind") == "samples" }.take(4).mapNotNull { c ->
            val first = (c["items"] as? JsonArray)?.firstOrNull() as? JsonObject
            val tid = c.str("track_id") ?: first?.str("track_id")
            AsxSampleCard(c.str("prompt") ?: return@mapNotNull null, c.str("intent"), tid, c.str("badge"),
                tid?.let { tracks[it] }?.coverImageId?.let { images[it] })
        }
    }.getOrDefault(emptyList())

    private fun parse(t: JsonObject): AsxTurn {
        val r = t["result"] as? JsonObject
        val images = t.images()
        val tracks = t.tracks(images)
        fun row(e: JsonElement?): AsxTrack? {
            val o = e as? JsonObject ?: return null
            val id = o.str("track_id")
            val lib = id?.let { tracks[it] }
            return AsxTrack(id, o.str("title_display") ?: lib?.title ?: o.str("title") ?: "—", lib?.artist ?: o.str("artist") ?: "—",
                o.str("reason"), lib, lib?.coverImageId?.let { images[it] })
        }
        fun hit(e: JsonElement?): AsxHit? {
            val o = e as? JsonObject ?: return null
            val tr = row(o["track"]) ?: return null
            return AsxHit(tr, o.str("matched_on"), o.str("matched_line"), (o["track"] as? JsonObject)?.str("lyrics") ?: o.str("lyrics"))
        }
        val playlist = (r?.get("playlist") as? JsonObject)?.let { p -> AsxPlaylist(p.str("title"), (p["tracks"] as? JsonArray).orEmpty().mapNotNull(::row)) }
        val search = (r?.get("search") as? JsonObject)?.let { s ->
            AsxSearch(s.str("message"), hit(s["best_hit"]), (s["hits"] as? JsonArray).orEmpty().mapNotNull(::hit))
        }
        val answer = (r?.get("answer") as? JsonObject)?.let { a ->
            val sub = (a["subject"] as? JsonObject)?.let { s ->
                val tid = s.str("track_id")
                AsxSubject(s.str("kind") ?: "track", s.str("title"), s.str("subtitle"), tid, s.str("artist_slug"),
                    s.str("image_id")?.let { images[it] } ?: tid?.let { tracks[it] }?.coverImageId?.let { images[it] })
            }
            AsxAnswer(
                a.str("answer").orEmpty(),
                (a["evidence"] as? JsonArray).orEmpty().mapNotNull { it as? JsonObject }.mapNotNull { e ->
                    AsxEvidence(e.str("n")?.toIntOrNull() ?: return@mapNotNull null, e.str("kind"), e.str("source"), e.str("url"), e.str("text").orEmpty(), e.str("used") == "true")
                },
                sub, a.str("focus_fact"), a.str("focus_kind"), a.str("explained")?.toBooleanStrictOrNull(), a.str("grounded")?.toBooleanStrictOrNull(),
                (a["follow_ups"] as? JsonArray).orEmpty().mapNotNull { (it as? JsonPrimitive)?.content },
                (a["related_tracks"] as? JsonArray).orEmpty().mapNotNull(::row),
            )
        }
        val clarify = (r?.get("clarify") as? JsonArray).orEmpty().mapNotNull { it as? JsonObject }.mapNotNull { c ->
            AsxChoice(c.str("intent") ?: return@mapNotNull null, c.str("label") ?: return@mapNotNull null)
        }
        val who = (r?.get("disambiguate") as? JsonArray).orEmpty().mapNotNull { it as? JsonObject }.mapNotNull { d ->
            val tid = d.str("track_id")
            AsxWho(d.str("title") ?: return@mapNotNull null, d.str("subtitle"), tid, d.str("artist_slug"), tid?.let { tracks[it] }?.coverImageId?.let { images[it] })
        }
        return AsxTurn(r?.str("intent"), playlist, search, answer, clarify, who, r?.get("slots") as? JsonObject, r?.str("context_id"), t.str("error"))
    }
}

private fun JsonObject.str(k: String) = (this[k] as? JsonPrimitive)?.content?.takeIf { it != "null" && it.isNotBlank() }

private fun JsonObject.images(): Map<String, Image> = (this["images"] as? JsonObject).orEmpty()
    .mapNotNull { (k, v) -> runCatching { k to ApiJson.decodeFromJsonElement(ImageData.serializer(), v).model() }.getOrNull() }.toMap()

private fun JsonObject.tracks(images: Map<String, Image>): Map<String, Track> = (this["tracks"] as? JsonObject).orEmpty()
    .mapNotNull { (k, v) -> runCatching { k to ApiJson.decodeFromJsonElement(TrackOut.serializer(), v).model() }.getOrNull() }.toMap()
