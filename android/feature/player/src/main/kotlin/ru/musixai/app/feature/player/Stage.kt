package ru.musixai.app.feature.player

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.dropShadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.shadow.Shadow
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
import coil3.compose.AsyncImage
import kotlinx.coroutines.launch
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.core.designsystem.control.PlayPauseGlyph
import ru.musixai.app.core.designsystem.gesture.HapticCue
import ru.musixai.app.core.designsystem.gesture.LocalMusixHaptics
import ru.musixai.app.core.designsystem.surface.GlassTone
import ru.musixai.app.core.designsystem.surface.liquidGlass
import ru.musixai.app.core.designsystem.surface.ProvideGlassSource
import ru.musixai.app.core.designsystem.surface.glassSource
import ru.musixai.app.core.designsystem.surface.rememberGlassSource
import ru.musixai.app.core.designsystem.content.Spinner
import ru.musixai.app.core.designsystem.content.ProgressiveImage
import ru.musixai.app.core.player.QueueEntry
import kotlin.math.abs
import kotlin.math.hypot

internal enum class Side { Cover, Text, Sound }

internal val CardShape = RoundedCornerShape(10.dp)

/**
 * The cameras of the stage: the mock's `perspective` — 1300 px for the turning pages, 1400 px for the
 * sides' flip. Compose hands `cameraDistance` to Skia, which counts it in inches of 72 device pixels,
 * so a distance in dp becomes `dp × density / 72` (the old `dp / 160 × density` stood the camera 2.2×
 * too close, and a turning page swelled over the whole player).
 */
private const val CAMERA_TURN = 1300f
private const val CAMERA_FLIP = 1400f
private fun camera(dp: Float, density: Float) = dp * density / 72f

/** What the stage is told: the queue around the song, how it plays, where its side is. */
internal class StageInput(
    val queue: List<QueueEntry>,
    val index: Int,
    val playing: Boolean,
    val side: Side,
    val blocked: Boolean,
    /** The song is on its way (buffering): the cover says so instead of looking paused. */
    val loading: Boolean = false,
)

/**
 * The stage: one pointer, three meanings. A tap pauses, a sideways drag turns the page (on the cover
 * side; on the words and the sound a flick past 56 dp changes the song), a pull down folds the player
 * (not on the words: there a vertical move scrolls them). The cover side tilts a little towards the
 * finger and gives under it.
 */
@Composable
internal fun Stage(
    input: StageInput,
    turn: PageTurn,
    size: Dp,
    light: PlayerLight,
    onToggle: () -> Unit,
    onChange: (dir: Int) -> Unit,
    onFold: FoldDrag,
    modifier: Modifier = Modifier,
    /** The sharp variant of a page's cover (its media art is the light 256 px one). */
    art: (QueueEntry) -> String? = { null },
    /** 0 open … 1 folded into the bar: a paused page clears up on the way. */
    folding: () -> Float = { 0f },
    back: @Composable () -> Unit,
    soundFace: @Composable () -> Unit,
    overlay: @Composable () -> Unit,
) {
    val haptics = LocalMusixHaptics.current
    val density = LocalDensity.current
    val scope = rememberCoroutineScope()
    val w = with(density) { size.toPx() }
    turn.width = w
    val current by rememberUpdatedState(input)
    // the gesture below lives as long as the stage: it must call the latest handlers, not the first ones
    val toggleNow by rememberUpdatedState(onToggle)
    val changeNow by rememberUpdatedState(onChange)
    val stageGlass = rememberGlassSource()
    val flick = with(density) { 56.dp.toPx() }

    // the side of the stage: the cover turns its back to show the words (a little wobble at the end)
    val flip by animateFloatAsState(if (input.side == Side.Text) 180f else 0f, springKcm(120f, 13.5f), label = "flip")
    // which way the page turns: the cards change their order only when it does, not every frame
    val way by remember { derivedStateOf { turn.sx.value.let { if (abs(it) < 0.05f) 0 else if (it < 0) -1 else 1 } } }
    val soundOn by animateFloatAsState(if (input.side == Side.Sound) 1f else 0f, tween(320), label = "sound")

    Box(
        modifier.size(size)
            .pointerInput(Unit) {
                awaitEachGesture {
                    val down = awaitFirstDown(requireUnconsumed = false)
                    val s = current
                    if (s.blocked) return@awaitEachGesture
                    // the words and the sound pools take their own taps; the stage still sees the move
                    val onFace = s.side != Side.Cover
                    val tracker = VelocityTracker()
                    tracker.addPosition(down.uptimeMillis, down.position)
                    val base = turn.sx.value
                    scope.launch { turn.sx.stop() }                     // grab it mid-flight
                    if (!onFace) turn.down(down.position.x / w, down.position.y / w)
                    var dir: Char? = null
                    var x0 = 0f; var y0 = 0f
                    var over = false
                    var lastDx = 0f
                    var ended = false
                    var cancelled = false
                    var lastUp: androidx.compose.ui.input.pointer.PointerInputChange = down
                    while (!ended) {
                        val ev = awaitPointerEvent(PointerEventPass.Main)
                        val ch = ev.changes.firstOrNull { it.id == down.id } ?: break
                        lastUp = ch
                        if (!ch.pressed) { ended = true; break }
                        tracker.addPosition(ch.uptimeMillis, ch.position)
                        val dx = ch.position.x - down.position.x
                        val dy = ch.position.y - down.position.y
                        lastDx = dx
                        if (dir == null) {
                            if (hypot(dx, dy) < 10.dp.toPx()) continue
                            // someone below took it (the words scroll, a pool was pressed and moved)
                            if (ch.isConsumed && onFace) { cancelled = true; break }
                            dir = if (abs(dx) > abs(dy)) (if (onFace) 'f' else 'x') else if (dy > 0 && s.side != Side.Text) 'd' else 'n'
                            x0 = dx; y0 = dy
                            turn.up()
                            if (dir == 'd') onFold.grab()
                            if (dir == 'n') break
                        }
                        when (dir) {
                            'x' -> {
                                ch.consume()
                                val hasPrev = s.index > 0
                                val hasNext = s.index < s.queue.lastIndex
                                turn.drag(base + dx - x0, hasPrev, hasNext)
                                val x = base + dx - x0
                                val nb = s.queue.getOrNull(s.index + if (x < 0) 1 else -1)
                                light.peek(nb?.artUri, abs(x) / w)
                                val now = abs(x) > turn.commitAt
                                if (now != over) { over = now; haptics.perform(if (now) HapticCue.Threshold else HapticCue.ThresholdOff, fromUser = true) }
                            }
                            'f' -> ch.consume()
                            'd' -> { ch.consume(); onFold.drag(dy - y0) }
                        }
                    }
                    turn.up()
                    val v = tracker.calculateVelocity()
                    val s2 = current
                    when (dir) {
                        null -> {
                            // a tap: on the cover it pauses; on the sound side only the empty floor does
                            if (ended && !cancelled && !lastUp.isConsumed) toggleNow()
                            turn.back()
                        }
                        'x' -> {
                            val land = turn.sx.value + project(v.x, 0.992f)
                            val go = when {
                                ended && land < -turn.commitAt && s2.index < s2.queue.lastIndex -> 1
                                ended && land > turn.commitAt && s2.index > 0 -> -1
                                else -> 0
                            }
                            if (go != 0) { changeNow(go); turn.shown = s2.index + go; turn.turn(go, v.x) }
                            else { scope.launch { light.settle() }; turn.back(v.x) }
                        }
                        'f' -> if (ended && abs(lastDx) > flick) {
                            val go = if (lastDx < 0) 1 else -1
                            if ((go > 0 && s2.index < s2.queue.lastIndex) || (go < 0 && s2.index > 0)) { changeNow(go); turn.shown = s2.index + go; turn.turn(go, 0f) }
                        }
                        'd' -> onFold.release(v.y, !ended)
                        else -> {}
                    }
                }
            },
    ) {
        // both sides, recorded for the glass that floats over them (the hint)
        Box(Modifier.fillMaxSize().glassSource(stageGlass)) {
        // the front: the covers and the sound's cast over them
        Box(Modifier.fillMaxSize().graphicsLayer {
            rotationY = flip; cameraDistance = camera(CAMERA_FLIP, density.density)
            alpha = if (flip > 90f) 0f else 1f
        }) {
            for (slot in -1..1) {
                val i = turn.shown + slot
                val entry = if (slot == -1 && turn.away != null && way > 0) input.queue.getOrNull(turn.away!!) else input.queue.getOrNull(i)
                val still = !input.playing && !input.loading && !input.blocked
                CoverCard(entry, slot, turn, z = zOf(slot, way), art = entry?.let(art), folding = folding,
                    paused = slot == 0 && still && input.side == Side.Cover,
                    loading = slot == 0 && input.loading && !input.blocked && input.side == Side.Cover,
                    soft = slot == 0 && (input.side == Side.Sound || still))
            }
            if (soundOn > 0.01f) Box(Modifier.fillMaxSize().zIndex(4f).clip(CardShape).graphicsLayer { alpha = soundOn; val k = 0.96f + 0.04f * soundOn; scaleX = k; scaleY = k }) { soundFace() }
        }
        // the back: the words
        if (flip > 1f) Box(Modifier.fillMaxSize().graphicsLayer {
            rotationY = flip - 180f; cameraDistance = camera(CAMERA_FLIP, density.density)
            alpha = if (flip > 90f) 1f else 0f
        }.dropShadow(CardShape, Shadow(radius = 30.dp, color = Color.Black.copy(alpha = 0.6f), offset = DpOffset(0.dp, 20.dp))).clip(CardShape)) { back() }
        }
        ProvideGlassSource(stageGlass) { overlay() }
    }

    // a song that changed without the finger (the end of a song, the queue, the notification) turns the page too
    LaunchedEffect(input.index) {
        val now = input.index
        val was = turn.shown
        if (was < 0 || now < 0) { turn.shown = now; light.arrive(input.queue.getOrNull(now)?.artUri, instant = true); return@LaunchedEffect }
        if (now != was) {
            val dir = if (now > was) 1 else -1
            if (abs(now - was) > 1) turn.away = was
            turn.shown = now
            turn.turn(dir, 0f)
        }
        light.arrive(input.queue.getOrNull(now)?.artUri, instant = false)
    }
    LaunchedEffect(input.playing, input.loading, input.side) { turn.paused(!input.playing && !input.loading && input.side == Side.Cover && !input.blocked) }
}

/** The finger's way into the fold (the shell's [PlayerFold] behind it). */
internal interface FoldDrag {
    fun grab()
    fun drag(dy: Float)
    fun release(vy: Float, cancel: Boolean)
}

@Composable
private fun CoverCard(entry: QueueEntry?, slot: Int, turn: PageTurn, z: Float, art: String?, folding: () -> Float, paused: Boolean, loading: Boolean, soft: Boolean) {
    if (entry == null) return
    val density = LocalDensity.current
    val dark = MusixTheme.isDark
    val softA by animateFloatAsState(if (soft) 1f else 0f, tween(300), label = "soft")
    val shown = paused || loading
    val ppi = remember { Animatable(0f) }
    LaunchedEffect(shown) { ppi.animateTo(if (shown) 1f else 0f, if (shown) springKcm(260f, 20f) else tween(280)) }
    val glass = rememberGlassSource()
    Box(
        Modifier.fillMaxSize().zIndex(z).graphicsLayer {
            val pz = turn.pose(slot)
            cameraDistance = camera(CAMERA_TURN, density.density)
            transformOrigin = if (pz.hinge) TransformOrigin(0f, 0.5f) else TransformOrigin(0.5f, 0.55f)
            rotationY = -pz.rotationY + pz.tiltY
            rotationX = pz.tiltX
            scaleX = pz.scale; scaleY = pz.scale
            translationY = pz.lift * density.density
            alpha = pz.alpha
        }.dropShadow(CardShape, Shadow(radius = 30.dp, color = Color.Black.copy(alpha = if (dark) 0.62f else 0.3f), spread = (-11).dp, offset = DpOffset(0.dp, 28.dp)))
            // an opaque body under the plate: a cover still on its way never lets the shaded page under it show through
            .clip(CardShape).background(MusixTheme.colors.bg).background(MusixTheme.colors.plate),
    ) {
        // the picture the button's glass reads: the light art at once, the sharp one over it when it is decoded
        Box(Modifier.fillMaxSize().then(if (slot == 0) Modifier.glassSource(glass) else Modifier)) {
            // 256 px at once, the stage's 1024 over it once decoded
            ProgressiveImage(entry.artUri, art, Modifier.fillMaxSize())
            // a paused page clears up while it flies into the bar, so the bar's sharp cover takes over the same picture
            if (softA > 0.01f) Image(rememberSoftCover(entry.artUri, DIM_PAUSED), null, Modifier.fillMaxSize().graphicsLayer { alpha = softA * (1f - folding() * 1.25f).coerceIn(0f, 1f) }, contentScale = ContentScale.Crop)
        }
        // the page in shadow while it turns, and the one under it until it is out
        Box(Modifier.fillMaxSize().graphicsLayer { alpha = turn.pose(slot).shade }.background(Color.Black))
        if (slot == 0 && ppi.value > 0.01f) Box(
            Modifier.align(Alignment.Center).size(76.dp).graphicsLayer {
                val k = ppi.value; alpha = k.coerceIn(0f, 1f) * (1f - folding() * 2f).coerceIn(0f, 1f)
                val sc = if (shown) 0.6f + 0.4f * k else 1.25f - 0.25f * k; scaleX = sc; scaleY = sc
            }.liquidGlass(CircleShape, GlassTone.Chip, shadow = false, source = glass, onArt = true),
            contentAlignment = Alignment.Center,
        ) {
            if (loading) Spinner(28.dp, Color.White.copy(alpha = 0.92f))
            else PlayPauseGlyph(0f, Modifier.size(30.dp).graphicsLayer { translationX = 3.dp.toPx() }, Color.White.copy(alpha = 0.92f))
        }
    }
}

/** The order of the cards for the way the page turns ([way] −1 to the next song, +1 back, 0 at rest). */
private fun zOf(slot: Int, way: Int): Float = when {
    way < 0 && slot == 0 -> 3f
    way > 0 && slot == -1 -> 3f
    slot == 0 -> 2f
    way != 0 -> 1f
    else -> 0f
}
