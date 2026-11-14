package ru.musixai.app.core.designsystem.gesture

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The two decisions every gesture in the library leans on (2026-11-14 spec §6, №18–19). */
class GestureLogicTest {
    private var now = 0L
    private val gate = Debouncer(windowMs = 500) { now }

    @Test fun aSecondTapInsideTheWindowIsSwallowed() {
        assertTrue(gate.tryRun())
        now = 200
        assertFalse(gate.tryRun())
    }

    @Test fun aTapAfterTheWindowRunsAgain() {
        gate.tryRun()
        now = 501
        assertTrue(gate.tryRun())
    }

    @Test fun aSlowReleasePastHalfwayCloses() = assertTrue(shouldClose(offset = 260f, velocity = 0f, height = 500f, flingPx = 1200f))

    @Test fun aSlowReleaseShortOfHalfwayStays() = assertFalse(shouldClose(offset = 200f, velocity = 0f, height = 500f, flingPx = 1200f))

    @Test fun aFlingDownClosesFromNearTheTop() = assertTrue(shouldClose(offset = 30f, velocity = 1800f, height = 500f, flingPx = 1200f))

    @Test fun aFlingUpKeepsItEvenPastHalfway() = assertFalse(shouldClose(offset = 300f, velocity = -1800f, height = 500f, flingPx = 1200f))

    @Test fun pullingPastTheEdgeGivesLessAndLess() {
        val first = rubberBand(50f, 500f)
        val second = rubberBand(100f, 500f) - first
        assertTrue("resists: $first", first in 1f..50f)
        assertTrue("each step gives less: $first then $second", second < first)
        assertTrue("never past the bound", rubberBand(100_000f, 500f) < 500f)
    }
}
