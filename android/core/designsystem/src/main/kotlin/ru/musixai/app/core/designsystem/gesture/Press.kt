package ru.musixai.app.core.designsystem.gesture

import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.graphics.graphicsLayer

/**
 * How far a control gives under the finger (`motion-and-performance.md`, «Press»): icon buttons
 * 0.9, tabs 0.94, chips and segments 0.96, rows 0.99. [Card] is the 1-px dip every control had
 * before the library (v1 `:active`) — the default, so nothing that exists changes its feel.
 */
enum class Press(internal val scale: Float) { Icon(0.9f), Tab(0.94f), Chip(0.96f), Row(0.99f), Card(0.98f) }

/**
 * A click with the house press feel instead of a Material ripple: the control gives to its
 * [role]'s scale and springs back (a little overshoot for every role but [Press.Card], whose
 * critically damped return is v1's). [haptic] plays on the click — only for the deliberate few
 * (a toggle, a confirm), never for a plain tap.
 */
fun Modifier.pressable(
    enabled: Boolean = true,
    role: Press = Press.Card,
    haptic: HapticCue? = null,
    onClick: () -> Unit,
): Modifier = composed {
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    val spec = remember(role) { if (role == Press.Card) spring<Float>() else spring(dampingRatio = 0.55f, stiffness = Spring.StiffnessMediumLow * 1.8f) }
    val s by animateFloatAsState(if (pressed) role.scale else 1f, spec, label = "press")
    val haptics = LocalMusixHaptics.current
    graphicsLayer { scaleX = s; scaleY = s }
        .clickable(interactionSource = source, indication = null, enabled = enabled) {
            if (haptic != null) haptics.perform(haptic, fromUser = true)
            onClick()
        }
}
