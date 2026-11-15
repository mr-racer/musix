package ru.musixai.app.core.designsystem.gesture

import android.os.Build
import android.os.SystemClock
import android.view.HapticFeedbackConstants
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Stable
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalView

/** Only deliberate gestures use this vocabulary; navigation and automatic events are silent. */
enum class HapticCue {
    Tick, ToggleOn, ToggleOff, Threshold, ThresholdOff, Lift, Drop, Confirm, Reject,
    /** A short, clearly felt click under a press that acts at once (play and pause on the cover):
     *  the toggle cues are too faint on many phones for it. */
    Press,
}

/** A shared gate prevents separate controls from producing a burst of haptics. */
internal class HapticGate(private val clock: () -> Long) {
    private val previous = mutableMapOf<HapticCue, Long>()

    fun accept(cue: HapticCue, enabled: Boolean, fromUser: Boolean): Boolean {
        if (!enabled || !fromUser) return false
        val now = clock()
        val interval = if (cue == HapticCue.Tick) 45L else 120L
        if (previous[cue]?.let { now - it < interval } == true) return false
        previous[cue] = now
        return true
    }
}

@Stable
class Haptics internal constructor(private val emit: (HapticCue, Boolean) -> Unit) {
    fun perform(cue: HapticCue, fromUser: Boolean) = emit(cue, fromUser)
}

val LocalMusixHaptics = staticCompositionLocalOf { Haptics { _, _ -> } }

/** Platform haptics honour system settings. No vibrator permission or DND workaround. */
@Composable
fun ProvideMusixHaptics(enabled: Boolean, content: @Composable () -> Unit) {
    val platform = LocalHapticFeedback.current
    val view = LocalView.current
    val currentEnabled = rememberUpdatedState(enabled)
    val gate = remember { HapticGate(SystemClock::uptimeMillis) }
    val haptics = remember(platform, view, gate) {
        Haptics { cue, fromUser ->
            if (gate.accept(cue, currentEnabled.value && view.hasWindowFocus(), fromUser)) {
                if (Build.VERSION.SDK_INT >= 34) {
                    // Compose exposes activation, but not its paired deactivation cue.
                    if (cue == HapticCue.ThresholdOff) view.performHapticFeedback(HapticFeedbackConstants.GESTURE_THRESHOLD_DEACTIVATE)
                    else platform.performHapticFeedback(when (cue) {
                        HapticCue.Tick -> HapticFeedbackType.SegmentTick
                        HapticCue.ToggleOn -> HapticFeedbackType.ToggleOn
                        HapticCue.ToggleOff -> HapticFeedbackType.ToggleOff
                        HapticCue.Threshold -> HapticFeedbackType.GestureThresholdActivate
                        HapticCue.ThresholdOff -> error("Handled by the platform view")
                        HapticCue.Lift -> HapticFeedbackType.LongPress
                        HapticCue.Drop -> HapticFeedbackType.GestureEnd
                        HapticCue.Confirm -> HapticFeedbackType.Confirm
                        HapticCue.Reject -> HapticFeedbackType.Reject
                        HapticCue.Press -> HapticFeedbackType.ContextClick
                    })
                } else {
                    view.performHapticFeedback(legacyHaptic(cue, Build.VERSION.SDK_INT))
                }
            }
        }
    }
    CompositionLocalProvider(LocalMusixHaptics provides haptics, content = content)
}

internal fun legacyHaptic(cue: HapticCue, sdk: Int): Int = when (cue) {
    HapticCue.Confirm -> if (sdk >= 30) HapticFeedbackConstants.CONFIRM else HapticFeedbackConstants.VIRTUAL_KEY
    HapticCue.Reject -> if (sdk >= 30) HapticFeedbackConstants.REJECT else HapticFeedbackConstants.LONG_PRESS
    HapticCue.Lift -> HapticFeedbackConstants.LONG_PRESS
    HapticCue.Threshold -> if (sdk >= 30) HapticFeedbackConstants.GESTURE_START else HapticFeedbackConstants.LONG_PRESS
    HapticCue.Drop -> if (sdk >= 30) HapticFeedbackConstants.GESTURE_END else HapticFeedbackConstants.VIRTUAL_KEY
    HapticCue.ToggleOn -> HapticFeedbackConstants.VIRTUAL_KEY
    HapticCue.Press -> HapticFeedbackConstants.CONTEXT_CLICK
    HapticCue.Tick, HapticCue.ToggleOff, HapticCue.ThresholdOff -> HapticFeedbackConstants.CLOCK_TICK
}
