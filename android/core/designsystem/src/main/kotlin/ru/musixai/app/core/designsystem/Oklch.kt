package ru.musixai.app.core.designsystem

import androidx.compose.ui.graphics.Color
import kotlin.math.cos
import kotlin.math.pow
import kotlin.math.sin

/** CSS `oklch(L% C h / a)` → sRGB, for the colors v1 computes at runtime (cover-fallback
 *  hues, stats hues). The static tokens are converted at build time (design/gen). */
fun oklch(lightnessPct: Float, chroma: Float, hueDeg: Float, alpha: Float = 1f): Color {
    val l0 = lightnessPct / 100f
    val h = Math.toRadians(hueDeg.toDouble())
    val a = chroma * cos(h)
    val b = chroma * sin(h)
    val l = (l0 + 0.3963377774 * a + 0.2158037573 * b).pow(3)
    val m = (l0 - 0.1055613458 * a - 0.0638541728 * b).pow(3)
    val s = (l0 - 0.0894841775 * a - 1.2914855480 * b).pow(3)
    fun gamma(x: Double) = (if (x > 0.0031308) 1.055 * x.pow(1 / 2.4) - 0.055 else 12.92 * x).coerceIn(0.0, 1.0).toFloat()
    return Color(
        gamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
        gamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
        gamma(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s),
        alpha,
    )
}

/** "#rrggbb" → Color (the server palette), null when malformed. */
fun hexColor(hex: String?): Color? = hex?.removePrefix("#")?.takeIf { it.length == 6 }?.toLongOrNull(16)?.let { Color(0xFF000000 or it) }
