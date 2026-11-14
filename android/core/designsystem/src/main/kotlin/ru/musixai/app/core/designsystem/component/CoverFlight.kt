package ru.musixai.app.core.designsystem.component

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.lerp
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.layer.GraphicsLayer
import androidx.compose.ui.graphics.layer.drawLayer
import androidx.compose.ui.graphics.rememberGraphicsLayer
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.node.GlobalPositionAwareModifierNode
import androidx.compose.ui.node.ModifierNodeElement
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.round
import androidx.compose.ui.util.lerp
import ru.musixai.app.core.designsystem.rememberReducedMotion

/** The test tag of a cover in flight. */
const val CoverFlightTag = "cover-flight"

/** r1's `flyToMini` (web `player/MiniPlayer.tsx`): 560 ms on cubic-bezier(.2,.8,.2,1)… */
const val FLY_MS = 560

/** …then the mini-player's cover catches it: 1 → 1.18 → 1 in 420 ms on an overshooting curve. */
const val CATCH_MS = 420

private val Fly = CubicBezierEasing(0.2f, 0.8f, 0.2f, 1f)
private val Catch = CubicBezierEasing(0.34f, 1.56f, 0.64f, 1f)
private val LANDED = 8.dp // the mini-player cover's corners
private val LIFTED = 16.dp // the copy's shadow at take-off; it settles to 3 on landing
private val SETTLED = 3.dp

/**
 * A cover that starts playing flies into the mini-player's cover (r1's `flyToMini`, r3 §5.5).
 * The shell owns one: it provides it as [LocalCoverFlight], draws [CoverFlightLayer] over its
 * screens and tells the [dock]; the mini-player marks its cover with [coverFlightTarget]. A
 * screen marks a cover with [coverSource] and calls [launch] when it starts playing it. The
 * copy runs to the mini-player's cover, which catches it with a short swell, and is gone: at
 * rest nothing is composed, nothing draws.
 *
 * A cold start has played nothing, so there is no mini-player to aim at: the copy then heads
 * for the [dock], where the bar's cover is about to stand, and turns to the real cover the
 * frame it is laid out. With neither (or with animations off) nothing flies.
 */
@Stable
class CoverFlight {
    /** Where the mini-player's cover will stand once the bar is shown (root px): the shell's guess. */
    var dock: Rect? by mutableStateOf(null)
    internal var target: Rect? by mutableStateOf(null)
    internal var still = false
    internal val flights = mutableStateListOf<Flight>()
    private var next = 0

    /** Sends a copy of the cover [source] marks; [radius] is its corners, the copy rounds them
     *  to the mini-player's on the way. */
    fun launch(source: CoverSource, radius: Dp) {
        val from = source.bounds ?: return
        if (still || from.isEmpty || aim() == null) return
        flights += Flight(next++, from, radius, source.layer)
    }

    internal fun aim(): Rect? = target ?: dock
}

internal class Flight(val id: Int, val from: Rect, val radius: Dp, val picture: GraphicsLayer)

/**
 * A cover that can fly: what it draws is recorded as it draws (a display list, not a bitmap),
 * so the copy is the cover's own pixels — r1's canvas copy: never blank, no second load, no
 * placeholder at take-off — and where it stands.
 */
@Stable
class CoverSource internal constructor(internal val layer: GraphicsLayer) {
    internal var bounds: Rect? = null // root px; read only on a launch
}

@Composable
fun rememberCoverSource(): CoverSource {
    val layer = rememberGraphicsLayer()
    return remember(layer) { CoverSource(layer) }
}

/** Marks the cover a [CoverSource] copies (put it outermost on the cover). */
fun Modifier.coverSource(s: CoverSource): Modifier = this
    .onGloballyPositioned { s.bounds = it.boundsInRoot() }
    .drawWithContent {
        s.layer.record { this@drawWithContent.drawContent() }
        drawLayer(s.layer)
    }

/** The shell's [CoverFlight]; null outside the app (previews, tests): nothing flies. */
val LocalCoverFlight = staticCompositionLocalOf<CoverFlight?> { null }

/** Marks the mini-player's cover as where covers land; when the bar leaves, the aim falls back to the dock. */
fun Modifier.coverFlightTarget(flight: CoverFlight?): Modifier = if (flight == null) this else this then TargetElement(flight)

private class TargetElement(val flight: CoverFlight) : ModifierNodeElement<TargetNode>() {
    override fun create() = TargetNode(flight)
    override fun update(node: TargetNode) {
        node.flight = flight
    }
    override fun equals(other: Any?) = other is TargetElement && other.flight === flight
    override fun hashCode() = System.identityHashCode(flight)
}

private class TargetNode(var flight: CoverFlight) : Modifier.Node(), GlobalPositionAwareModifierNode {
    override fun onGloballyPositioned(coordinates: LayoutCoordinates) {
        flight.target = coordinates.boundsInRoot()
    }
    override fun onDetach() {
        flight.target = null
    }
}

/** Draws the covers in flight; put it over the screens and the mini-player, under the sheets. */
@Composable
fun CoverFlightLayer(flight: CoverFlight, modifier: Modifier = Modifier, reduced: Boolean = rememberReducedMotion()) {
    SideEffect { flight.still = reduced }
    if (flight.flights.isEmpty()) return
    var origin by remember { mutableStateOf(Offset.Zero) }
    Box(modifier.fillMaxSize().onGloballyPositioned { origin = it.boundsInRoot().topLeft }) {
        for (f in flight.flights) key(f.id) { Copy(f, flight, origin) { flight.flights.remove(f) } }
    }
}

/** The path: straight, as r1's (the copy is laid out at its take-off size; the layer moves it). */
internal fun flightRect(from: Rect, to: Rect, k: Float): Rect = lerp(from, to, k)

/** The catch on its linear time [u]: r1's keyframes 1 → 1.18 → 1 on the overshooting curve, so
 *  the swell settles a hair under 1 before it rests. */
private fun catchScale(u: Float): Float {
    val p = Catch.transform(u)
    return if (p <= 0.5f) 1f + 0.36f * p else 1.18f - 0.36f * (p - 0.5f)
}

@Composable
private fun Copy(f: Flight, flight: CoverFlight, origin: Offset, done: () -> Unit) {
    val k = remember { Animatable(0f) }
    val u = remember { Animatable(0f) }
    LaunchedEffect(Unit) {
        k.animateTo(1f, tween(FLY_MS, easing = Fly))
        u.animateTo(1f, tween(CATCH_MS, easing = LinearEasing))
        done()
    }
    val size = with(LocalDensity.current) { DpSize(f.from.width.toDp(), f.from.height.toDp()) }
    Box(
        Modifier
            .offset { (f.from.topLeft - origin).round() }
            .size(size)
            .graphicsLayer {
                // everything moves in the draw phase: no layout per frame
                val r = flightRect(f.from, flight.aim() ?: f.from, k.value)
                val c = catchScale(u.value)
                val sx = r.width / f.from.width * c
                val sy = r.height / f.from.height * c
                transformOrigin = TransformOrigin(0f, 0f)
                scaleX = sx
                scaleY = sy
                translationX = r.center.x - f.from.width * sx / 2 - f.from.left
                translationY = r.center.y - f.from.height * sy / 2 - f.from.top
                shape = RoundedCornerShape(lerp(f.radius.toPx(), LANDED.toPx(), k.value) / sx)
                clip = true
                shadowElevation = lerp(LIFTED.toPx(), SETTLED.toPx(), k.value)
            }
            .drawBehind { drawLayer(f.picture) }
            .testTag(CoverFlightTag),
    )
}
