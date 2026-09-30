package ru.musixai.app.core.designsystem.component

import android.os.Build
import android.os.SystemClock
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.graphics.BlurEffect
import androidx.compose.ui.graphics.TileMode
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay

/** v1's `cubic-bezier(.22,.9,.3,1)`: the house ease-out for everything that arrives. */
val Arrive = CubicBezierEasing(0.22f, 0.9f, 0.3f, 1f)

/**
 * A moment a screen (or a tab of it) was entered. Lazy lists compose their rows again as
 * they scroll back into view, so a row only plays its entrance when it first appears
 * shortly after the entry — the opening cascade, like v1's non-virtual grids; later rows
 * are simply there.
 */
@JvmInline
value class Entry(val atMs: Long) {
    fun fresh(windowMs: Long = 700): Boolean = SystemClock.uptimeMillis() - atMs < windowMs
}

/** A new [Entry] each time [key] changes (the tab, the screen's visit). */
@Composable
fun rememberEntry(vararg key: Any?): Entry = remember(*key) { Entry(SystemClock.uptimeMillis()) }

/**
 * The v1 entrance family, one-shot, on the layer only (no relayout):
 * - `libRise` — rise(26 dp, blur 5 dp, 650 ms), the library/artist section cascade;
 * - `libCardIn` — rise(18 dp, scale .97, 550 ms, 45 ms × i), album cards;
 * - `tabFadeIn` — rise(10 dp, 450 ms, +50 ms), a tab's pane.
 * With [entry] given, it plays only while that entry is fresh.
 */
fun Modifier.rise(
    delayMs: Int = 0,
    distance: Dp = 26.dp,
    blur: Dp = 0.dp,
    scaleFrom: Float = 1f,
    durationMs: Int = 650,
    entry: Entry? = null,
): Modifier = composed {
    // keyed on the entry: a lazy slot reused by the next tab starts its own entrance
    val t = remember(entry) { Animatable(if (entry == null || entry.fresh()) 0f else 1f) }
    LaunchedEffect(entry) {
        if (t.value < 1f) { delay(delayMs.toLong()); t.animateTo(1f, tween(durationMs, easing = Arrive)) }
    }
    graphicsLayer {
        val k = t.value
        if (k >= 1f) return@graphicsLayer
        alpha = k
        translationY = distance.toPx() * (1f - k)
        val s = scaleFrom + (1f - scaleFrom) * k
        scaleX = s; scaleY = s
        val r = blur.toPx() * (1f - k)
        if (r > 0.5f && Build.VERSION.SDK_INT >= 31) renderEffect = BlurEffect(r, r, TileMode.Decal)
    }
}

/** v1 `.lib-album-card`: 18 dp up from .97, 550 ms, 45 ms apart (the first 18 cascade). */
fun Modifier.cardIn(index: Int, entry: Entry): Modifier =
    rise(delayMs = minOf(index, 18) * 45, distance = 18.dp, scaleFrom = 0.97f, durationMs = 550, entry = entry)
