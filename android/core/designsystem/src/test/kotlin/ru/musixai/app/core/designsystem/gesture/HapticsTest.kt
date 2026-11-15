package ru.musixai.app.core.designsystem.gesture

import android.view.HapticFeedbackConstants
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class HapticsTest {
    @Test fun backgroundAndDisabledEventsAreSilentWithoutConsumingTheNextGesture() {
        val gate = HapticGate { 0L }
        assertFalse(gate.accept(HapticCue.Confirm, enabled = true, fromUser = false))
        assertFalse(gate.accept(HapticCue.Confirm, enabled = false, fromUser = true))
        assertTrue(gate.accept(HapticCue.Confirm, enabled = true, fromUser = true))
    }

    @Test fun draggingTicksAreLimitedAndDifferentControlsShareTheGate() {
        var now = 0L
        val gate = HapticGate { now }
        assertTrue(gate.accept(HapticCue.Tick, true, true))
        now = 44
        assertFalse(gate.accept(HapticCue.Tick, true, true))
        now = 45
        assertTrue(gate.accept(HapticCue.Tick, true, true))
        assertTrue(gate.accept(HapticCue.Lift, true, true))
        now = 90
        assertTrue(gate.accept(HapticCue.Drop, true, true))
        assertFalse(gate.accept(HapticCue.Lift, true, true))
        now = 165
        assertTrue(gate.accept(HapticCue.Lift, true, true))
    }

    @Test fun olderPhonesUseSupportedPlatformConstants() {
        assertEquals(HapticFeedbackConstants.VIRTUAL_KEY, legacyHaptic(HapticCue.Confirm, 24))
        assertEquals(HapticFeedbackConstants.LONG_PRESS, legacyHaptic(HapticCue.Reject, 29))
        assertEquals(HapticFeedbackConstants.CONFIRM, legacyHaptic(HapticCue.Confirm, 30))
        assertEquals(HapticFeedbackConstants.GESTURE_END, legacyHaptic(HapticCue.Drop, 33))
        // play and pause on the cover: a click every phone plays, not the faint toggle tick
        assertEquals(HapticFeedbackConstants.CONTEXT_CLICK, legacyHaptic(HapticCue.Press, 26))
    }
}
