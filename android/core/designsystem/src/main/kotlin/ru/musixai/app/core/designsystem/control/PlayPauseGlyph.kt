package ru.musixai.app.core.designsystem.control

import androidx.compose.foundation.Canvas
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path

/** ▶ ↔ ❚❚ as one shape (the accepted «Play ↔ пауза меняет форму»): the triangle's two
 *  halves flow into the two bars. [t] 0 = play, 1 = pause. The orb, the album of the day's
 *  button and the mini-player share it. */
@Composable
fun PlayPauseGlyph(t: Float, modifier: Modifier, color: Color) {
    Canvas(modifier) {
        val w = size.width
        val h = size.height
        fun mix(a: Float, b: Float) = a + (b - a) * t
        // play: a triangle from (0.22w, 0.12h) to the tip (0.92w, 0.5h), split at x = 0.57w
        // pause: bars 0.18–0.40 and 0.60–0.82 of the width, 0.12–0.88 of the height
        val left = Path().apply {
            moveTo(mix(0.22f, 0.18f) * w, 0.12f * h)
            lineTo(mix(0.57f, 0.40f) * w, mix(0.31f, 0.12f) * h)
            lineTo(mix(0.57f, 0.40f) * w, mix(0.69f, 0.88f) * h)
            lineTo(mix(0.22f, 0.18f) * w, 0.88f * h)
            close()
        }
        val right = Path().apply {
            moveTo(mix(0.57f, 0.60f) * w, mix(0.31f, 0.12f) * h)
            lineTo(mix(0.92f, 0.82f) * w, mix(0.5f, 0.12f) * h)
            lineTo(mix(0.92f, 0.82f) * w, mix(0.5f, 0.88f) * h)
            lineTo(mix(0.57f, 0.60f) * w, mix(0.69f, 0.88f) * h)
            close()
        }
        // one path, not two: the halves' shared edge of the triangle stays inside the shape, so its
        // anti-aliasing does not show as a hairline through the ▶ (seen over the cover, 2026-11-15)
        drawPath(Path().apply { addPath(left); addPath(right) }, color)
    }
}
