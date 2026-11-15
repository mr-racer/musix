package ru.musixai.app.feature.player

import androidx.compose.runtime.mutableLongStateOf
import ru.musixai.app.core.model.StageFrames
import kotlin.math.exp
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow

/*
 * The «Звук» side alive, as on the computer (web `StageScene.tsx`, the owner's rules of 2026-10-25):
 * a part stands on the stage only around the time it plays, lights with its own level, moves to where
 * it sits right now, and sends a ring across the floor when it comes in after a pause. All of it is a
 * function of the playhead: paused, the stage holds the moment and stops.
 */

private const val GATE = -38f        // dB under the loudest stem frame: below it, silence or another part's bleed
private const val MIN_ON = 6f        // s a part plays in the whole song to stand on the stage
private const val HOLD = 2.5f        // s it stays after it stops
private const val MERGE = 4f         // s: a shorter pause keeps it standing instead of blinking
private const val FADE_IN = 0.35f
private const val FADE_OUT = 0.9f

/** A stem's life over the song: its light per frame, the windows it stands in, its entries, its gate. */
internal class StemLife(val lit: FloatArray, val wins: List<FloatArray>, val entries: FloatArray, val gate: Float)

/** The web's `life()`: where a stem plays and how bright, from the live frames; null when it barely plays. */
internal fun life(st: StageFrames, i: Int): StemLife? {
    val f = st.frames; val fps = st.fps
    if (f <= 1) return null
    val db = FloatArray(f) { st.level(it, i) }
    val over = db.filter { it > GATE }.sorted()
    if (over.size < fps * MIN_ON) return null
    val loud = over[(over.size * 0.9f).toInt().coerceAtMost(over.lastIndex)]
    val gate = max(GATE, loud - 24f)
    // runs over the gate; gaps under a second closed (beats, breaths), blips under 0.3 s dropped
    val segs = ArrayList<IntArray>()
    for (x in 0 until f) {
        if (db[x] <= gate) continue
        val s = segs.lastOrNull()
        if (s != null && x - s[1] < fps) s[1] = x + 1 else segs += intArrayOf(x, x + 1)
    }
    val kept = segs.filter { it[1] - it[0] >= fps * 0.3f }
    if (kept.sumOf { it[1] - it[0] } < fps * MIN_ON) return null
    val levels = ArrayList<Float>()
    for (s in kept) for (x in s[0] until s[1]) if (db[x] > gate) levels += db[x]
    levels.sort()
    val lo = levels[(levels.size * 0.15f).toInt().coerceAtMost(levels.lastIndex)]
    val hi = max(lo + 6f, levels[(levels.size * 0.97f).toInt().coerceAtMost(levels.lastIndex)])
    val lit = FloatArray(f)
    val wins = ArrayList<FloatArray>()
    val entries = ArrayList<Float>()
    var end = Int.MIN_VALUE / 2
    for (s in kept) {
        val a = s[0]; val b = s[1]
        for (x in a until b) {
            // 0.2 s held, so a beat's gaps do not black it out between hits
            val d = max(db[x], db[max(0, x - 1)])
            lit[x] = 0.1f + 0.9f * ((d - lo) / (hi - lo)).coerceIn(0f, 1f).pow(1.3f)
        }
        if (a - end >= 2 * fps) entries += a.toFloat() / fps
        end = b
        if (b - a < fps) continue      // a blip lights a part already there, it does not call one up
        val w = wins.lastOrNull(); val w0 = a.toFloat() / fps; val w1 = b.toFloat() / fps + HOLD
        if (w != null && w0 - w[1] < MERGE) w[1] = w1 else wins += floatArrayOf(w0, w1)
    }
    if (wins.isEmpty()) return null
    return StemLife(lit, wins, entries.toFloatArray(), gate)
}

private fun ease(v: Float): Float { val x = v.coerceIn(0f, 1f); return x * x * (3 - 2 * x) }

/** 0…1: on the stage at second [t] (a soft rise from its window's start, a soft fall after it). */
internal fun shownAt(wins: List<FloatArray>, t: Float): Float {
    for (w in wins) if (t >= w[0] && t < w[1] + FADE_OUT) return ease((t - w[0]) / FADE_IN) * (1 - ease((t - w[1]) / FADE_OUT))
    return 0f
}

/** The stems a part of the stage plot listens to: the drums as one, or as their pieces in newer frames. */
private fun stemsOf(stem: String, all: List<String>): IntArray = when (stem) {
    "drums" -> all.indexOf("drums").takeIf { it >= 0 }?.let { intArrayOf(it) }
        ?: listOf("kick", "snare", "hats", "hh", "toms", "cym").map(all::indexOf).filter { it >= 0 }.toIntArray()
    else -> all.indexOf(stem).takeIf { it >= 0 }?.let { intArrayOf(it) } ?: IntArray(0)
}

/** A ring running out from a part that came in. */
internal class Ripple(val part: Int, val t0: Long)

/**
 * The parts of [parts] driven by [st]: per part its presence ([vis]), its light ([glow]) and its place
 * ([pan], −1…1). [tick] changes every step, for the draw phase to read; nothing recomposes.
 */
internal class LiveStage(private val st: StageFrames, parts: List<Part>) {
    private val idx = parts.map { stemsOf(it.stem, st.stems) }
    private val lives = idx.map { ix -> ix.map { life(st, it) } }
    /** A part moves only when its stem is its own: two parts of one stem would meet in one place. */
    private val moves = idx.map { ix -> ix.size == 1 && idx.count { it.contentEquals(ix) } == 1 }
    val alive = lives.any { l -> l.any { it != null } }

    val vis = FloatArray(parts.size)
    val glow = FloatArray(parts.size) { 0.45f }
    val pan = FloatArray(parts.size) { parts[it].pan }
    private val target = FloatArray(parts.size) { parts[it].pan }
    val ripples = ArrayList<Ripple>()
    val tick = mutableLongStateOf(0L)
    /** The last step's time, ms (the rings' age is counted from it). */
    var now = 0L
        private set
    private var lastT = -1f

    /** One step towards the playhead [t] (s); true while anything still moves. */
    fun step(t: Float, dtMs: Float, playing: Boolean, nowMs: Long): Boolean {
        now = nowMs
        var moving = false
        val f = (t * st.fps).coerceIn(0f, st.frames - 1.001f)
        val i0 = floor(f).toInt(); val k = f - i0
        for (p in vis.indices) {
            val ls = lives[p]
            var want = 0f; var light = 0f
            ls.forEach { l -> if (l != null) { want = max(want, shownAt(l.wins, t)); light = max(light, l.lit[i0] * (1 - k) + l.lit[i0 + 1] * k) } }
            vis[p] += (want - vis[p]) * (1 - exp(-dtMs / 140f))
            // the light answers at once and lets go slower, so it breathes with the part
            glow[p] += (light - glow[p]) * (1 - exp(-dtMs / (if (light > glow[p]) 50f else 220f)))
            if (moves[p] && playing) {
                val s = idx[p][0]; val l = ls[0]
                val level = st.level(i0, s) * (1 - k) + st.level(i0 + 1, s) * k
                if (l != null && level > l.gate) target[p] = st.pan(i0, s) * (1 - k) + st.pan(i0 + 1, s) * k
            }
            pan[p] += (target[p] - pan[p]) * (1 - exp(-dtMs / 420f))
            // an entry after a pause passed under the playhead (not a seek over it): a ring
            if (playing && t > lastT && t - lastT < 0.5f && ls.any { l -> l != null && l.entries.any { it > lastT && it <= t } }) ripples += Ripple(p, nowMs)
            if (kotlin.math.abs(want - vis[p]) > 0.002f || kotlin.math.abs(light - glow[p]) > 0.004f || kotlin.math.abs(target[p] - pan[p]) > 0.004f) moving = true
        }
        ripples.removeAll { nowMs - it.t0 > RIPPLE_MS }
        lastT = t
        tick.longValue++
        return moving || playing || ripples.isNotEmpty()
    }

    companion object { const val RIPPLE_MS = 1100L }
}

/** The step's time since the last one, ms, held under 64 (a frame after a pause does not jump). */
internal fun stepMs(last: Long, now: Long): Float = if (last == 0L) 16f else min(64f, (now - last) / 1e6f)
