package ru.musixai.app.core.designsystem.motion

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedContentScope
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.AnimatedVisibilityScope
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.SizeTransform
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandHorizontally
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.shrinkHorizontally
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.graphics.graphicsLayer

/** The short ease-in everything leaves on (`principles.md` 10: springs in, a short ease-in out). */
val Leave = CubicBezierEasing(0.4f, 0f, 1f, 1f)

/** How a [Reveal] comes and goes. */
enum class RevealStyle {
    /** Rises 1/10 of its height from .96 and fades in on a spring; leaves smaller, fading. */
    Rise,
    /** Grows out of its width and folds back into it (the album of the day's «Слушать»). */
    Fold,
    /** Opens its height (what lies below slides, never jumps); closing, it fades first, then draws in. */
    Collapse,
    /** Only fades. */
    Fade,
}

/** The enter and exit of [style]; reduced motion: a 120 ms fade either way. */
fun revealTransitions(style: RevealStyle, reduced: Boolean): Pair<EnterTransition, ExitTransition> {
    if (reduced) return fadeIn(tween(120)) to fadeOut(tween(120))
    return when (style) {
        RevealStyle.Rise -> (fadeIn(tween(220)) + scaleIn(spring(dampingRatio = .8f, stiffness = 420f), initialScale = .96f) +
            slideInVertically(spring(dampingRatio = .8f, stiffness = 420f)) { it / 10 }) to
            (fadeOut(tween(160, easing = Leave)) + scaleOut(tween(160, easing = Leave), targetScale = .96f))
        RevealStyle.Fold -> (expandHorizontally(spring(dampingRatio = .82f, stiffness = 420f), expandFrom = Alignment.End) +
            fadeIn(tween(200, delayMillis = 60)) + scaleIn(spring(dampingRatio = .7f, stiffness = 420f), initialScale = .8f)) to
            (shrinkHorizontally(tween(220, easing = Leave), shrinkTowards = Alignment.End) + fadeOut(tween(140, easing = Leave)) +
                scaleOut(tween(220, easing = Leave), targetScale = .8f))
        RevealStyle.Collapse -> (expandVertically(spring(dampingRatio = 1f, stiffness = 400f), expandFrom = Alignment.Top) +
            fadeIn(tween(220, delayMillis = 80))) to
            (fadeOut(tween(160, easing = Leave)) + shrinkVertically(tween(220, delayMillis = 100, easing = Leave), shrinkTowards = Alignment.Top))
        RevealStyle.Fade -> fadeIn(tween(220)) to fadeOut(tween(160, easing = Leave))
    }
}

/**
 * Appearing and hiding, the house way: nothing pops in or vanishes (`principles.md` 10). The
 * content is gone from composition once hidden, so at rest it costs nothing.
 */
@Composable
fun Reveal(
    visible: Boolean,
    modifier: Modifier = Modifier,
    style: RevealStyle = RevealStyle.Rise,
    content: @Composable AnimatedVisibilityScope.() -> Unit,
) {
    val reduced = rememberReducedMotion()
    val (enter, exit) = remember(style, reduced) { revealTransitions(style, reduced) }
    AnimatedVisibility(visible, modifier, enter, exit, label = "reveal", content = content)
}

/**
 * A change of content in one place (a label, a fact, a favourite): the old leaves quickly and
 * upwards, the new arrives a beat later from below; the box's size follows on a spring.
 */
@Composable
fun <T> Swap(
    target: T,
    modifier: Modifier = Modifier,
    contentAlignment: Alignment = Alignment.TopStart,
    content: @Composable AnimatedContentScope.(T) -> Unit,
) {
    val reduced = rememberReducedMotion()
    AnimatedContent(
        target, modifier,
        transitionSpec = {
            if (reduced) fadeIn(tween(120)) togetherWith fadeOut(tween(120))
            else (fadeIn(tween(240, delayMillis = 70)) + slideInVertically(spring(dampingRatio = .85f, stiffness = 420f)) { it / 4 }) togetherWith
                (fadeOut(tween(110, easing = Leave)) + slideOutVertically(tween(160, easing = Leave)) { -it / 6 }) using
                SizeTransform(clip = false)
        },
        contentAlignment = contentAlignment, label = "swap", content = content,
    )
}

private class PopGate { var seen = false }

/**
 * «Впрыгивание»: each time [key] changes after the first, the element drops to .86 and springs
 * back with one overshoot (the mini-player's cover catching a new song, a check landing, a new
 * album on the wall). Nothing on the first composition; nothing with reduced motion.
 */
fun Modifier.popIn(key: Any?): Modifier = composed {
    val reduced = rememberReducedMotion()
    val s = remember { Animatable(1f) }
    val gate = remember { PopGate() }
    LaunchedEffect(key) {
        if (!gate.seen) { gate.seen = true; return@LaunchedEffect }
        if (reduced) return@LaunchedEffect
        s.snapTo(.86f)
        s.animateTo(1f, MusixSprings.pop())
    }
    graphicsLayer { scaleX = s.value; scaleY = s.value }
}
