package ru.musixai.app.core.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** 1.0.0's player invariants (its 19 JVM tests), folded into two for the v2 test budget. */
class PlayerLogicTest {
    private val item = ListenAccumulator.Item("t1", 200_000, "unplayed", "stream")

    @Test
    fun `a listen is the time heard - not seeks, not pauses - with v1 end reasons`() {
        val a = ListenAccumulator()
        a.begin(item, 0)
        for (s in 1..10) a.tick(s * 500L, playing = true, durationMs = 200_000)  // 5 s heard
        a.tick(60_000, playing = true, durationMs = null)  // a seek jump: not listening
        a.tick(60_500, playing = false, durationMs = null)  // paused: not credited
        a.tick(61_000, playing = true, durationMs = null)
        var l = a.finish(skipped = true)!!
        assertEquals(5_500, l.playedMs)
        assertEquals("skipped", l.endReason)
        assertTrue(l.skippedEarly)  // < 30 s and < 30 %
        assertNull(a.finish(skipped = false))  // once per listen

        a.begin(item, 0)
        a.tick(400, playing = true, durationMs = null)
        assertNull(a.finish(skipped = false))  // under a second heard: no event

        a.begin(item, 198_500)
        a.tick(199_000, playing = true, durationMs = null)
        a.completeToEnd()  // the tail after the last tick counts
        a.markInteracted()
        l = a.finish(skipped = false)!!
        assertEquals(1_500, l.playedMs)
        assertEquals("stopped", l.endReason)  // 1.5 s of 200 s is not a completion
        assertTrue(l.interacted)
        val j = l.json("s1")
        assertEquals("unplayed", j["source"].toString().trim('"'))
        assertEquals("stream", j["contextType"].toString().trim('"'))

        a.begin(ListenAccumulator.Item("t2", 10_000, null, null), 0)
        for (s in 1..20) a.tick(s * 500L, playing = true, durationMs = 10_000)
        assertEquals("completed", a.finish(skipped = true)!!.endReason)  // ≥ 90 % heard wins over the skip
    }

    @Test
    fun `the queue refills early, drops the stale tail after a signal and caps history`() {
        assertFalse(QueuePolicy.needsStreamRefill(count = 5, index = 1))
        assertTrue(QueuePolicy.needsStreamRefill(count = 5, index = 3))  // one left after the current
        assertFalse(QueuePolicy.needsStreamRefill(count = 5, index = -1))
        assertTrue(QueuePolicy.needsListTopUp(count = 3, index = 2))  // as soon as the last item starts
        assertFalse(QueuePolicy.needsListTopUp(count = 0, index = -1))
        assertEquals(3 until 6, QueuePolicy.dropAfterSignal(Signal.REACTION, currentIndex = 2, count = 6))
        assertEquals(4 until 6, QueuePolicy.dropAfterSignal(Signal.SKIP, currentIndex = 2, count = 6))  // one runway track
        assertNull(QueuePolicy.dropAfterSignal(Signal.REACTION, currentIndex = 5, count = 6))
        assertEquals(0, QueuePolicy.historyOverflow(20))
        assertEquals(5, QueuePolicy.historyOverflow(25))
    }
}
