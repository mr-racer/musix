package ru.musixai.app.feature.home

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.PI
import kotlin.math.abs

/** The orb's membrane (Jelly UI's model): a dent under the finger at once, the volume kept,
 *  and a loop that parks itself once the ring is still. */
class MembraneTest {
    private val frame = 1f / 60f

    private fun Membrane.run(seconds: Float): Boolean {
        var moving = true
        repeat((seconds / frame).toInt()) { moving = step(frame) }
        return moving
    }

    @Test fun `at rest the ring is parked and round`() {
        val m = Membrane()
        assertFalse(m.step(frame))
        assertTrue((0 until m.points).all { m.radius(it) == 1f })
    }

    @Test fun `a press dents the ring under the finger on the first frame`() {
        val m = Membrane()
        m.press(0f)
        assertTrue(m.step(frame))
        assertTrue("dent ${m.radius(0)}", m.radius(0) <= 1f - Membrane.DENT / 2)
        assertTrue("dent ${m.radius(0)}", m.radius(0) >= 1f - Membrane.DENT - 0.02f)
        assertTrue("far side ${m.radius(m.points / 2)}", m.radius(m.points / 2) >= 0.995f)
    }

    @Test fun `a held press keeps the area and bulges the far side`() {
        val m = Membrane()
        m.press(0f)
        m.run(0.4f)
        assertEquals(1f, m.area(), 0.03f)
        assertTrue(m.radius(m.points / 2) > 1f)
    }

    @Test fun `the dent follows the finger`() {
        val m = Membrane()
        m.press(0f)
        m.run(0.1f)
        m.move((PI / 2).toFloat())
        m.run(0.3f)
        val deepest = (0 until m.points).minBy { m.radius(it) }
        assertTrue("deepest at $deepest", abs(deepest - m.points / 4) <= 1)
    }

    @Test fun `a release rebounds past round, then parks within a second and a half`() {
        val m = Membrane()
        m.press(0f)
        m.run(0.3f)
        m.release()
        var over = false
        repeat(30) { m.step(frame); if (m.radius(0) > 1.005f) over = true }
        assertTrue("no overshoot", over)
        assertFalse(m.run(1.5f))
        assertTrue((0 until m.points).all { it -> m.radius(it) == 1f })
    }

    @Test fun `a kick inward is a short dent of the whole ring`() {
        val m = Membrane()
        m.kick(-1f)
        m.step(frame)
        m.step(frame)
        assertTrue((0 until m.points).all { m.radius(it) < 1f })
        assertFalse(m.run(1.5f))
    }
}
