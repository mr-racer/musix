package ru.musixai.app.core.designsystem.motion

import android.os.Build
import androidx.compose.animation.AnimatedVisibilityScope
import androidx.compose.animation.EnterExitState
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.slideOutVertically
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.graphics.BlurEffect
import androidx.compose.ui.graphics.TileMode
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp

/** Which way a page change reads (`motion-and-performance.md`, «Page changes»). */
enum class PageDirection {
    /** Between sections: a column, 34 dp. */
    Column,
    /** Between a screen's tabs: a row, 30 dp. */
    Row,
    /** A page that is not a section comes forward (from 1.03). */
    Forward,
    /** Back to a section: it steps back (from .975). */
    Back,
    /** A new grouping or a filter settles in place (16 dp up; the old one shrinks to .985). */
    InPlace,
}

/** The enter and exit of one page change; [sign] + forwards along the axis, − back. */
class PageFocus(val enter: EnterTransition, val exit: ExitTransition)

/**
 * The web's «focus» page change for the phone (2026-10-11): **nothing slides across the screen**.
 * What leaves goes out of focus — fades, blurs 8 dp, drifts a little the other way, 0.2 s
 * ease-in; what arrives comes into focus 70 ms later from a short way off — fade 0.26 s, blur
 * off 0.38 s ([pageFocusBlur]), travel 0.56 s, critically damped. Reduced motion: a fade.
 */
@Composable
fun rememberPageFocus(direction: PageDirection, sign: Int = 1): PageFocus {
    val density = LocalDensity.current
    val reduced = rememberReducedMotion()
    return remember(direction, sign, density, reduced) {
        if (reduced) return@remember PageFocus(fadeIn(tween(120)), fadeOut(tween(120)))
        val travel = with(density) { (if (direction == PageDirection.Row) 30.dp else if (direction == PageDirection.InPlace) 16.dp else 34.dp).roundToPx() } * sign
        val inFade = fadeIn(tween(260, delayMillis = 70))
        val outFade = fadeOut(tween(200, easing = Leave))
        val page = MusixSprings.page<IntOffset>()
        val pageF = MusixSprings.page<Float>()
        when (direction) {
            PageDirection.Column -> PageFocus(inFade + slideInVertically(page) { travel }, outFade + slideOutVertically(tween(200, easing = Leave)) { -travel / 3 })
            PageDirection.Row -> PageFocus(inFade + slideInHorizontally(page) { travel }, outFade + slideOutHorizontally(tween(200, easing = Leave)) { -travel / 3 })
            PageDirection.Forward -> PageFocus(inFade + scaleIn(pageF, initialScale = 1.03f), outFade + scaleOut(tween(200, easing = Leave), targetScale = .975f))
            PageDirection.Back -> PageFocus(inFade + scaleIn(pageF, initialScale = .975f), outFade + scaleOut(tween(200, easing = Leave), targetScale = 1.03f))
            PageDirection.InPlace -> PageFocus(inFade + slideInVertically(page) { travel }, outFade + scaleOut(tween(200, easing = Leave), targetScale = .985f))
        }
    }
}

/**
 * The blur half of the focus change (API 31+; below, the fade alone): 8 dp while a page is
 * entering or leaving, sharp once it has arrived. Put it on the page inside the
 * `AnimatedContent` / `NavHost` that runs [rememberPageFocus]'s transitions.
 */
fun Modifier.pageFocusBlur(scope: AnimatedVisibilityScope): Modifier = composed {
    if (Build.VERSION.SDK_INT < 31) return@composed this
    val blur by scope.transition.animateFloat(
        transitionSpec = { if (targetState == EnterExitState.Visible) tween(380, delayMillis = 70) else tween(200, easing = Leave) },
        label = "focus",
    ) { if (it == EnterExitState.Visible) 0f else 8f }
    graphicsLayer {
        val r = blur.dp.toPx()
        renderEffect = if (r > 0.5f) BlurEffect(r, r, TileMode.Decal) else null
    }
}
