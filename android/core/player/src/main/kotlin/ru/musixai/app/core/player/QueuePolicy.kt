package ru.musixai.app.core.player

import kotlin.math.max

enum class QueueMode(val wire: String) { LIST("list"), STREAM("stream") }

/** A strong signal during «Поток»: a reaction (огонёк/вода) or a listener skip. */
enum class Signal { REACTION, SKIP }

/**
 * Queue rules from 1.0.0 (themselves a port of the web's `fetchStreamChunk`,
 * `handleStreamSignal`, `ensureAutoplayQueue`). Pure, so the JVM tests pin them.
 * v2's «Поток» keeps its session state on the server, so no exclude list is sent there.
 */
object QueuePolicy {
    /** «Поток» keeps a 1–2 track prefetch; refill when fewer remain after the current one. */
    const val STREAM_REFILL_BELOW = 2
    const val STREAM_CHUNK = 3
    /** Played items kept before the current one, so "previous" still works. */
    const val HISTORY_KEEP = 20
    const val AUTOPLAY_LIMIT = 20
    const val PLAYED_EXCLUDE_MAX = 200

    fun upcoming(count: Int, index: Int): Int = max(0, count - 1 - index)

    fun needsStreamRefill(count: Int, index: Int): Boolean = index >= 0 && upcoming(count, index) < STREAM_REFILL_BELOW

    /** List mode tops up from autoplay as soon as the LAST item starts — no silent gap at its end. */
    fun needsListTopUp(count: Int, index: Int): Boolean = count > 0 && index >= count - 1

    /**
     * Indices to drop after a signal — the tail was chosen by the PRE-signal profile. A
     * reaction keeps only the current track; a skip keeps one runway track (the one being
     * skipped to) so the jump is instant.
     */
    fun dropAfterSignal(signal: Signal, currentIndex: Int, count: Int): IntRange? {
        val keepThrough = if (signal == Signal.SKIP) currentIndex + 1 else currentIndex
        val from = keepThrough + 1
        return if (currentIndex >= 0 && from < count) from until count else null
    }

    /** How many items to trim from the front once history outgrows [HISTORY_KEEP]. */
    fun historyOverflow(currentIndex: Int): Int = max(0, currentIndex - HISTORY_KEEP)
}
