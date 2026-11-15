package ru.musixai.app.core.designsystem.motion

import android.os.SystemClock
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.Easing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalContext
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.currentCompositionLocalContext
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.layer.GraphicsLayer
import androidx.compose.ui.graphics.layer.drawLayer
import androidx.compose.ui.graphics.GraphicsContext
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.AlignmentLine
import androidx.compose.ui.layout.FirstBaseline
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalGraphicsContext
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.isSpecified
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * «Что коснулся, то и летит» (SourceFlight, spec §6; the artist and album pages, 2026-11-15):
 * a page opens out of what the finger touched and goes back into it — a picture becomes the
 * picture (a cover flies into the album's slot, a photo grows into the artist's frame), a word
 * becomes the word (a title flies into the album's heading, a name into the artist's name).
 *
 * A screen marks the pictures and words that open pages with [flightSpot] under a shared
 * [FlightKey]; the same key on another screen is the same thing (an album's cover on the
 * library's grid and on the artist's axis), so a page can go back into wherever its source is
 * now. A spot records what it draws as it draws (a display list, never blank) and keeps its
 * coordinates, so its place is read on demand — the layers above it included, while a page
 * still settles. The shell owns one [FlightSources] ([LocalFlightSources]) and draws
 * [FlightLayer] over its screens: flyers launched there stay sharp while the pages change focus
 * under them. At rest nothing is composed there.
 */
enum class FlightKind { Picture, Word }

/** The shared keys of spots: an album's cover and title, an artist's photo and name. */
object FlightKey {
    fun albumCover(id: String): Any = Key("album.cover", id)
    fun albumTitle(id: String): Any = Key("album.title", id)
    fun artistPhoto(id: String): Any = Key("artist.photo", id)
    fun artistName(id: String): Any = Key("artist.name", id)
    private data class Key(val what: String, val id: String)
}

@Stable
class FlightSpot internal constructor(
    val key: Any,
    val kind: FlightKind,
    internal val layer: GraphicsLayer,
    private val graphics: GraphicsContext,
) {
    internal var coords: LayoutCoordinates? = null
    internal var pressedAt = 0L
    private var holds = 0
    private var gone = false

    /**
     * A flyer keeps the spot's picture while it flies: the page the spot stood on may go first (an
     * album closes while its artist's name is still flying), and its layer must outlive it.
     */
    fun hold() { holds++ }
    fun drop() { holds--; if (holds <= 0 && gone) graphics.releaseGraphicsLayer(layer) }
    internal fun leave() { gone = true; if (holds <= 0) graphics.releaseGraphicsLayer(layer) }

    /** Its corner on screen (px): a flight out of it starts with this corner and lands back on it. */
    var radius: Float = 0f
        internal set

    /** What the spot draws, recorded as it draws: a flyer is the spot's own pixels. */
    val picture: GraphicsLayer get() = layer

    /** A word's first baseline below its top (px); NaN for a picture. A word lands letter on letter by it. */
    var baseline: Float = Float.NaN
        internal set

    /** A word's font size (px), 0 when not given: then a word flight scales by the boxes' heights. */
    var fontPx: Float = 0f
        internal set

    /** Where it stands now (root px), the transforms of the layers above it included; null once gone. */
    fun rect(): Rect? {
        val c = coords?.takeIf { it.isAttached } ?: return null
        val a = c.localToRoot(Offset.Zero)
        val b = c.localToRoot(Offset(c.size.width.toFloat(), c.size.height.toFloat()))
        return Rect(min(a.x, b.x), min(a.y, b.y), max(a.x, b.x), max(a.y, b.y))
    }

    /** The part of it the screen shows (clipped by its scroller), for «is it on screen». */
    fun visible(): Rect? = coords?.takeIf { it.isAttached }?.boundsInRoot()?.takeIf { it.width > 1f && it.height > 1f }
}

@Stable
class FlightSources {
    private val spots = HashMap<Any, FlightSpot>()
    private val faded = mutableStateMapOf<Any, Float>()
    private var last: FlightSpot? = null
    internal val flyers = mutableStateListOf<Flyer>()
    private var next = 0

    /** Animations off: callers open and close in place. */
    var still: Boolean = false
        internal set

    fun spot(key: Any): FlightSpot? = spots[key]?.takeIf { it.coords?.isAttached == true }

    /** The spot the finger came down on last, if it is one of [keys] and it was a moment ago. */
    fun pressed(vararg keys: Any, withinMs: Long = 1500): FlightSpot? =
        last?.takeIf { s -> s.key in keys && SystemClock.uptimeMillis() - s.pressedAt < withinMs && s.coords?.isAttached == true }

    /** A page stands in for the spot it flew out of: the spot is not drawn until [show]. */
    fun hide(key: Any) { faded[key] = 0f }
    fun show(key: Any) { faded.remove(key) }
    fun isHidden(key: Any): Boolean = faded[key] == 0f

    /** A spot half-shown: a word flight hands over to its target by this. */
    fun fade(key: Any, alpha: Float) { if (alpha >= 1f) faded.remove(key) else faded[key] = alpha.coerceAtLeast(0f) }

    /** How much of the spot is drawn now (read in the draw phase). */
    fun alphaOf(key: Any): Float = faded[key] ?: 1f

    /** Draws [content] in the [FlightLayer] until it calls its `done`. [locals] are the caller's. */
    fun launch(locals: CompositionLocalContext, content: @Composable (done: () -> Unit) -> Unit) {
        flyers += Flyer(next++, locals, content)
    }

    internal fun attach(s: FlightSpot) { spots[s.key] = s }
    internal fun detach(s: FlightSpot) {
        if (spots[s.key] === s) spots.remove(s.key)
        if (last === s) last = null
    }
    internal fun press(s: FlightSpot) { s.pressedAt = SystemClock.uptimeMillis(); last = s }
}

internal class Flyer(val id: Int, val locals: CompositionLocalContext, val content: @Composable (done: () -> Unit) -> Unit)

/** The shell's [FlightSources]; null outside the app (previews, tests): nothing flies, pages open in place. */
val LocalFlightSources = staticCompositionLocalOf<FlightSources?> { null }

/** The caller's locals, to [FlightSources.launch] a flyer from a callback. */
@Composable
fun rememberFlightLocals(): CompositionLocalContext = currentCompositionLocalContext

/**
 * Marks a picture or a word that opens a page (or that a page goes back into) under [key].
 * It records what it draws, notes the finger coming down on it, and is not drawn while a page
 * that flew out of it stands in for it. A word goes straight on its `Text` (its baseline is read
 * from the layout) with its font size in [text]: a word flight then lands letter on letter.
 */
fun Modifier.flightSpot(key: Any, kind: FlightKind = FlightKind.Picture, radius: Dp = 0.dp, text: TextUnit = TextUnit.Unspecified): Modifier = composed {
    val sources = LocalFlightSources.current ?: return@composed this
    val graphics = LocalGraphicsContext.current
    val spot = remember(key) { FlightSpot(key, kind, graphics.createGraphicsLayer(), graphics) }
    val layer = spot.layer
    with(LocalDensity.current) {
        spot.radius = radius.toPx()
        spot.fontPx = if (text.isSpecified) text.toPx() else 0f
    }
    DisposableEffect(spot) {
        sources.attach(spot)
        onDispose { sources.detach(spot); spot.leave() }
    }
    this
        .onGloballyPositioned {
            spot.coords = it
            val b = it[FirstBaseline]
            spot.baseline = if (b == AlignmentLine.Unspecified) Float.NaN else b.toFloat()
        }
        .pointerInput(spot) { awaitEachGesture { awaitFirstDown(requireUnconsumed = false); sources.press(spot) } }
        .graphicsLayer { alpha = sources.alphaOf(key) }
        .drawWithContent {
            layer.record { this@drawWithContent.drawContent() }
            drawLayer(layer)
        }
}

/** Draws the flyers; put it over the screens (and the album over them), under the sheets. */
@Composable
fun FlightLayer(sources: FlightSources, modifier: Modifier = Modifier, reduced: Boolean = rememberReducedMotion()) {
    SideEffect { sources.still = reduced }
    if (sources.flyers.isEmpty()) return
    var origin by remember { mutableStateOf(Offset.Zero) }
    Box(modifier.fillMaxSize().onGloballyPositioned { origin = it.boundsInRoot().topLeft }) {
        Box(Modifier.offset { IntOffset(-origin.x.roundToInt(), -origin.y.roundToInt()) }) {
            for (f in sources.flyers) key(f.id) {
                CompositionLocalProvider(f.locals) { f.content { sources.flyers.remove(f) } }
            }
        }
    }
}

/** A word's way: quick out, a long soft landing (the album's `Arrive`). */
val WordArrive: Easing = CubicBezierEasing(0.22f, 0.9f, 0.3f, 1f)

/**
 * The hand-over of a word flight at linear time [u]: how much of the target shows (the flyer
 * shows the rest) — over the last 30 %, where the way left is a few per cent, so the two words
 * are never seen apart.
 */
fun wordHandOver(u: Float): Float {
    val x = ((u - 0.7f) / 0.3f).coerceIn(0f, 1f)
    return x * x * (3f - 2f * x)
}

/**
 * A word flying into a word (the owner, 2026-11-15: the name «просто превращается в страницу»):
 * [spot]'s own pixels, from where it stood into the spot [into] — found every frame, so it follows a
 * page still settling. It scales by the two font sizes and travels baseline to baseline, so it
 * lands on the target's letters, not on its box (a body line and a trimmed heading have boxes of
 * different shapes). The target is hidden while it flies and comes in under the flyer's last stretch
 * as the flyer goes out ([wordHandOver]); [onLand] when it is all the target's. Use inside
 * [FlightSources.launch].
 */
@Composable
fun WordFlight(
    spot: FlightSpot,
    from: Rect,
    into: Any,
    sources: FlightSources,
    durationMs: Int = 460,
    easing: Easing = WordArrive,
    onLand: () -> Unit = {},
    done: () -> Unit,
) {
    val u = remember { Animatable(0f) }
    val fromBase = spot.baseline.takeIf { !it.isNaN() } ?: (from.height * 0.8f)
    DisposableEffect(spot) { spot.hold(); onDispose { spot.drop() } }
    LaunchedEffect(Unit) {
        sources.hide(into)
        try {
            u.animateTo(1f, tween(durationMs, easing = LinearEasing)) { sources.fade(into, wordHandOver(value)) }
        } finally {
            sources.show(into)
        }
        onLand()
        done()
    }
    val size = with(LocalDensity.current) { DpSize(from.width.toDp(), from.height.toDp()) }
    Box(
        Modifier.offset { IntOffset(from.left.roundToInt(), from.top.roundToInt()) }.size(size).graphicsLayer {
            val t = easing.transform(u.value)
            val target = sources.spot(into)
            val b = target?.rect() ?: from
            val s1 = if (target != null && spot.fontPx > 0f && target.fontPx > 0f) target.fontPx / spot.fontPx
            else b.height / from.height.coerceAtLeast(1f)
            val toBase = target?.baseline?.takeIf { !it.isNaN() } ?: (b.height * 0.8f)
            val s = mixF(1f, s1, t)
            // the baseline travels straight; the word grows about its own baseline's left end
            val base = mixF(from.top + fromBase, b.top + toBase, t)
            transformOrigin = TransformOrigin(0f, 0f)
            scaleX = s; scaleY = s
            translationX = mixF(0f, b.left - from.left, t)
            translationY = base - s * fromBase - from.top
            alpha = 1f - wordHandOver(u.value)
        }.drawBehind { drawLayer(spot.picture) },
    )
}

private fun mixF(a: Float, b: Float, t: Float) = a + (b - a) * t
