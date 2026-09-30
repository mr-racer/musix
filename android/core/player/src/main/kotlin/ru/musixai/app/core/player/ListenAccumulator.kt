package ru.musixai.app.core.player

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.time.Instant
import java.util.UUID

/**
 * One continuous listen produces exactly ONE listen event whose `playedMs` is the time
 * actually heard — not the playhead position (1.0.0, and the web before it). Position
 * deltas count only while playing and only when small: a seek, or a gap in ticks, is not
 * listening. The recommender must not tell a native listen from a web one.
 */
class ListenAccumulator {

    data class Listen(
        val trackId: String,
        val startedAt: Instant,
        val playedMs: Long,
        val durationMs: Long?,
        val endReason: String,
        val skippedEarly: Boolean,
        val interacted: Boolean,
        val influence: Boolean,
        val source: String?,
        val contextType: String?,
    ) {
        val clientEventId: String = UUID.randomUUID().toString()

        /** The `ListenIn` body of `POST /events/listens:batch`. */
        fun json(sessionId: String): JsonObject = JsonObject(buildMap {
            put("clientEventId", JsonPrimitive(clientEventId))
            put("sessionId", JsonPrimitive(sessionId))
            put("trackId", JsonPrimitive(trackId))
            put("startedAt", JsonPrimitive(startedAt.toString()))
            put("playedMs", JsonPrimitive(playedMs))
            durationMs?.let { put("durationMs", JsonPrimitive(it)) }
            put("endReason", JsonPrimitive(endReason))
            put("skippedEarly", JsonPrimitive(skippedEarly))
            put("interacted", JsonPrimitive(interacted))
            put("influence", JsonPrimitive(influence))
            source?.let { put("source", JsonPrimitive(it)) }
            contextType?.let { put("contextType", JsonPrimitive(it)) }
        })
    }

    data class Item(val trackId: String, val durationMs: Long?, val source: String?, val contextType: String?, val influence: Boolean = true)

    var item: Item? = null
        private set
    private var startedAt: Instant = Instant.EPOCH
    private var accMs = 0L
    private var lastPosMs = 0L
    private var durationMs: Long? = null
    private var interacted = false

    fun begin(i: Item, positionMs: Long, now: Instant = Instant.now()) {
        item = i
        startedAt = now
        accMs = 0
        lastPosMs = positionMs
        durationMs = i.durationMs
        interacted = false
    }

    /** Called every tick and on every play/pause edge. */
    fun tick(positionMs: Long, playing: Boolean, durationMs: Long?) {
        val dt = positionMs - lastPosMs
        if (playing && dt > 0 && dt < MAX_STEP_MS) accMs += dt
        lastPosMs = positionMs
        if (durationMs != null && durationMs > 0) this.durationMs = durationMs
    }

    /** The track ran out: credit the tail between the last tick and the end. */
    fun completeToEnd() {
        val d = durationMs ?: return
        val dt = d - lastPosMs
        if (dt > 0 && dt < MAX_STEP_MS) accMs += dt
        lastPosMs = d
    }

    /** Any control the listener touched: pause, seek, skip, огонёк/вода. */
    fun markInteracted() {
        if (item != null) interacted = true
    }

    /**
     * Ends the listen: null when under a second was heard (the web's rule). The end reason
     * is spec §3's: `completed` at ≥ 90 % heard, `skipped` when the listener moved on,
     * else `stopped`; an early skip is v1's (< 30 s and < 30 % of the track).
     */
    fun finish(skipped: Boolean, error: Boolean = false): Listen? {
        val i = item ?: return null
        item = null
        if (accMs < 1000) return null
        val d = durationMs?.takeIf { it > 0 }
        val reason = when {
            error -> "error"
            d != null && accMs >= 0.9 * d -> "completed"
            skipped -> "skipped"
            else -> "stopped"
        }
        val early = skipped && accMs < 30_000 && (d == null || accMs.toDouble() / d < 0.30)
        return Listen(i.trackId, startedAt, accMs, d, reason, early, interacted, i.influence, i.source, i.contextType)
    }

    companion object {
        /** The web uses 2 s at ~4 Hz ticks; the service ticks at 2 Hz. */
        const val MAX_STEP_MS = 2_000L
    }
}
