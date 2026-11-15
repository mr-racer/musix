package ru.musixai.app.core.designsystem.motion

import androidx.compose.animation.core.SpringSpec
import androidx.compose.animation.core.spring
import androidx.compose.ui.graphics.GraphicsLayerScope
import androidx.compose.ui.graphics.TransformOrigin
import kotlin.math.PI

/**
 * «Петля» (Hinge, spec §6 — the album's page under its cover; later the playlist's): a leaf hinged
 * on its top edge. [open] 1 = flat, 0 = folded edge-on *into* the screen, so nothing ever crosses
 * the camera. Only a rotation and the leaf's own shade ([hingeShade]) change — no layout.
 * `cameraDistance` is in Skia inches of 72 device px (`android.md`), [perspective] in dp like the
 * mock's CSS `perspective`.
 */
fun GraphicsLayerScope.hinge(open: Float, perspective: Float = 1200f, pivotY: Float = 0f) {
    val a = (1f - open) * 90f
    // [pivotY]: where the hinge line is, as a fraction of the layer's height (a leaf inside a scroller)
    transformOrigin = TransformOrigin(0.5f, pivotY)
    rotationX = -a
    cameraDistance = perspective * density / 72f
    if (open < 0.004f) alpha = 0f
}

/** How dark the folding leaf is: its shade darkens a little ahead of the angle. */
fun hingeShade(open: Float): Float = ((1f - open) * 1.25f).coerceIn(0f, 1f)

/**
 * A spring by its feel, as the mocks write it (`SPR(response, damping)`): [response] is the
 * period in seconds, [damping] 1 = critically damped. Unit mass.
 */
fun <T> springOf(response: Float, damping: Float = 1f): SpringSpec<T> =
    spring(dampingRatio = damping, stiffness = ((2 * PI / response) * (2 * PI / response)).toFloat())

/** The album's motion: a cover's flight (0.42 s, no bounce) and the leaf on its hinge (0.36 s, a hair of give). */
object EnvelopeSprings {
    fun <T> flight(): SpringSpec<T> = springOf(0.42f)
    fun <T> hinge(): SpringSpec<T> = springOf(0.36f, 0.9f)
}
