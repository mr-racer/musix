package ru.musixai.app.core.designsystem.motion

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos

/**
 * A frame loop that sleeps at rest (the home orb's membrane, r3: «в покое тихо»): [wake] starts
 * it — or starts it again — and it runs one physics step a frame until the step reports that
 * everything is still; then not one more frame is asked for.
 */
@Stable
class ParkingLoop internal constructor() {
    /** Bumped on every frame the loop runs: read it where the moving thing is drawn. */
    var frame by mutableIntStateOf(0)
        internal set
    internal var wakes by mutableIntStateOf(0)

    /** A finger, a kick, a new target: run until still. */
    fun wake() { wakes++ }
}

/**
 * [step] advances the physics by `dt` seconds and returns whether anything still moves. The
 * first frame after a wake steps 1/60 s.
 */
@Composable
fun rememberParkingLoop(step: (dt: Float) -> Boolean): ParkingLoop {
    val loop = remember { ParkingLoop() }
    val current by rememberUpdatedState(step)
    LaunchedEffect(loop.wakes) {
        if (loop.wakes == 0) return@LaunchedEffect
        var last = 0L
        while (true) {
            val moving = withFrameNanos { t ->
                val dt = if (last == 0L) 1f / 60f else (t - last) / 1e9f
                last = t
                current(dt)
            }
            loop.frame++
            if (!moving) break
        }
    }
    return loop
}
