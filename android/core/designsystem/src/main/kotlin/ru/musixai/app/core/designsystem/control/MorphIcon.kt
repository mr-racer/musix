package ru.musixai.app.core.designsystem.control

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.snap
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.core.designsystem.motion.rememberReducedMotion

/**
 * The glyphs a [MorphIcon] flows between. Each is two strokes on the 24-grid, written so the
 * ends travel the short way: plus → cross turns clockwise, plus → minus lays the upright down,
 * plus → check bends both strokes into the tick.
 */
enum class Glyph(internal val p: FloatArray) {
    Plus(floatArrayOf(12f, 5f, 12f, 19f, 5f, 12f, 19f, 12f)),
    Cross(floatArrayOf(18f, 6f, 6f, 18f, 6f, 6f, 18f, 18f)),
    Check(floatArrayOf(19f, 7f, 10f, 17.5f, 5f, 12.5f, 10f, 17.5f)),
    Minus(floatArrayOf(19f, 12f, 5f, 12f, 5f, 12f, 19f, 12f)),
}

/**
 * «Перетекающий значок» (2026-11-14 spec §6, №12): «добавить» becomes «готово», «открыть»
 * becomes «закрыть» — not a swap of two pictures but the same two strokes moving, eight ends
 * each on its own spring (a little give at the end). Drawn only: the springs touch no layout,
 * and at rest nothing is redrawn. Without motion it changes at once.
 */
@Composable
fun MorphIcon(glyph: Glyph, modifier: Modifier = Modifier, color: Color = MusixTheme.colors.text, size: Dp = 22.dp, stroke: Dp = 2.dp, description: String? = null) {
    val reduced = rememberReducedMotion()
    val spec = if (reduced) snap() else spring<Float>(dampingRatio = .62f, stiffness = 520f)
    val ends: List<State<Float>> = List(8) { i -> animateFloatAsState(glyph.p[i], spec, label = "end$i") }
    Canvas(modifier.size(size).then(if (description != null) Modifier.semantics { contentDescription = description } else Modifier)) {
        val k = this.size.minDimension / 24f
        val w = stroke.toPx()
        fun at(i: Int) = Offset(ends[i].value * k, ends[i + 1].value * k)
        drawLine(color, at(0), at(2), w, StrokeCap.Round)
        drawLine(color, at(4), at(6), w, StrokeCap.Round)
    }
}
