package ru.musixai.app.core.designsystem.gesture

/**
 * The give past an edge (a sheet pulled up past open, a cover past the last one): the farther
 * the finger goes, the less the thing follows, and it never travels a whole [dimension] —
 * the curve UIKit's scroll views made familiar, `(1 − 1 / (x·c / d + 1)) · d`.
 */
fun rubberBand(over: Float, dimension: Float, c: Float = 0.55f): Float {
    if (over <= 0f || dimension <= 0f) return 0f
    return (1f - 1f / (over * c / dimension + 1f)) * dimension
}

/**
 * Where a released drag goes, by its place **and** its speed (2026-11-13 spec §6.1): a fling
 * faster than [flingPx] per second decides by its direction; a slow release, by whether it
 * passed halfway. [offset] is how far it was pulled from open (px, + towards closed), [height]
 * the whole way, [velocity] px/s (+ towards closed).
 */
fun shouldClose(offset: Float, velocity: Float, height: Float, flingPx: Float): Boolean = when {
    velocity > flingPx -> true
    velocity < -flingPx -> false
    else -> offset > height / 2f
}
