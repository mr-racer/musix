package ru.musixai.app.feature.home

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.min

/**
 * The orb's skin: a closed ring of points on springs, after the membrane of Jelly UI
 * (github.com/jelly-org/ui, MIT) — each point pulled to the rest radius and to its
 * neighbours, a pressure that keeps the area, a press target that follows the finger,
 * one fixed-step loop. Radii are fractions of the rest radius (1 = round).
 *
 * The loop parks itself: once every point is still, [step] snaps the ring round and
 * returns false, and the caller stops asking for frames (r3: «в покое тихо»).
 */
internal class Membrane(val points: Int = 40) {
    private val r = FloatArray(points) { 1f }
    private val v = FloatArray(points)
    private var at: Float? = null  // the press angle, radians; null = no finger
    private var parked = true

    fun radius(i: Int) = r[(i % points + points) % points]

    /** The area against the round one's (1 = kept). */
    fun area(): Float = r.fold(0f) { s, x -> s + x * x } / points

    /** A finger lands at [angle]: the dent shows on this very frame, not a frame later. */
    fun press(angle: Float) {
        at = angle
        parked = false
        for (i in 0 until points) {
            val g = reach(i, angle)
            r[i] += 0.6f * g * (1f - DENT * g - r[i])
        }
    }

    fun move(angle: Float) { if (at != null) at = angle }

    fun release() { at = null; parked = false }

    /** A push of the whole ring: + out (a start's bounce), − in (a pause's short dent). */
    fun kick(strength: Float) {
        for (i in 0 until points) v[i] += KICK * strength
        parked = false
    }

    /** Advances [dt] seconds in fixed sub-steps; false once the ring is round and still. */
    fun step(dt: Float): Boolean {
        if (parked) return false
        var left = min(dt, 0.05f)
        while (left > 1e-6f) {
            val h = min(SUB, left)
            sub(h)
            left -= h
        }
        val still = at == null && (0 until points).all { abs(r[it] - 1f) < 0.0015f && abs(v[it]) < 0.01f }
        if (still) {
            r.fill(1f); v.fill(0f); parked = true
        }
        return !parked
    }

    private fun sub(h: Float) {
        val pressure = PRESSURE * (1f - area())
        val press = at
        for (i in 0 until points) {
            val lap = r[(i + points - 1) % points] + r[(i + 1) % points] - 2f * r[i]
            var a = -STIFF * (r[i] - 1f) + COUPLE * lap + pressure - DAMP * v[i]
            if (press != null) {
                val g = reach(i, press)
                a += HOLD * g * (1f - DENT * g - r[i])
            }
            v[i] += a * h
        }
        for (i in 0 until points) r[i] += v[i] * h
    }

    /** How much point [i] feels a finger at [angle]: 1 under it, ~0 a quarter turn away. */
    private fun reach(i: Int, angle: Float): Float {
        val d = (2 * PI * i / points - angle).let { x -> abs(((x % (2 * PI)) + 3 * PI) % (2 * PI) - PI) }.toFloat()
        return exp(-(d / SPREAD) * (d / SPREAD))
    }

    companion object {
        const val DENT = 0.12f  // r3 §5.2: up to 12 % of the radius
        private const val SUB = 1f / 240f
        private const val STIFF = 260f  // ≈ 2.6 Hz: the rebound settles in ≈ 0.6–0.7 s
        private const val DAMP = 11.3f  // ζ ≈ 0.35: one clear overshoot, then a fading wobble
        private const val COUPLE = 60f
        private const val PRESSURE = 120f
        private const val HOLD = 900f
        private const val KICK = 1.4f
        private const val SPREAD = 0.45f
    }
}

/** The angle of a point seen from the orb's centre (radians, 0 = right, clockwise on screen). */
internal fun angleOf(dx: Float, dy: Float): Float = kotlin.math.atan2(dy, dx)

/** The ring's outline as x/y pairs around (cx, cy) at the rest radius [rest], px. */
internal fun Membrane.outline(cx: Float, cy: Float, rest: Float): FloatArray = FloatArray(points * 2).also { out ->
    for (i in 0 until points) {
        val t = 2 * PI * i / points
        val rr = radius(i) * rest
        out[2 * i] = cx + (rr * cos(t)).toFloat()
        out[2 * i + 1] = cy + (rr * kotlin.math.sin(t)).toFloat()
    }
}
