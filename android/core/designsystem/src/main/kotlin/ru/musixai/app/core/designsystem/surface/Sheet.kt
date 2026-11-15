package ru.musixai.app.core.designsystem.surface

import androidx.activity.compose.PredictiveBackHandler
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalContext
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.State
import androidx.compose.runtime.currentCompositionLocalContext
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.kyant.backdrop.backdrops.LayerBackdrop
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.core.designsystem.float
import ru.musixai.app.core.designsystem.gesture.HapticCue
import ru.musixai.app.core.designsystem.gesture.LocalMusixHaptics
import ru.musixai.app.core.designsystem.gesture.rubberBand
import ru.musixai.app.core.designsystem.gesture.shouldClose
import ru.musixai.app.core.designsystem.motion.Leave
import ru.musixai.app.core.designsystem.motion.MusixSprings
import ru.musixai.app.core.designsystem.motion.rememberReducedMotion

const val SheetTag = "musix-sheet"

/** [locals] are the caller's: a sheet drawn by the shell still wears the theme, the haptics and
 *  the motion setting of the place that declared it (as Popup and Dialog do). */
internal class SheetEntry(val id: Any, val onClose: () -> Unit, val locals: State<CompositionLocalContext>, val look: State<SheetLook>, val content: @Composable ColumnScope.() -> Unit)

/** [glass] — the sheet is liquid glass of that tone over the screen (null: the solid float);
 *  [scrim] — how dark the screen behind it goes. */
internal data class SheetLook(val glass: GlassTone?, val scrim: Float)

/** The shell's sheet slot: one sheet at a time (`surfaces.md`) — a new one closes the one before. */
@Stable
class SheetHostState internal constructor() {
    internal var entry by mutableStateOf<SheetEntry?>(null)
        private set

    internal fun show(e: SheetEntry) {
        val before = entry
        if (before != null && before.id !== e.id) before.onClose()
        entry = e
    }

    internal fun hide(id: Any) { if (entry?.id === id) entry = null }
}

val LocalSheetHost = staticCompositionLocalOf<SheetHostState?> { null }

/** The shell puts its screens inside: sheets declared anywhere below are drawn over all of it. */
@Composable
fun SheetHost(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    val state = remember { SheetHostState() }
    val source = rememberGlassSource()
    CompositionLocalProvider(LocalSheetHost provides state) {
        Box(modifier.fillMaxSize()) {
            // everything on screen is the picture a glass sheet is made of
            Box(Modifier.fillMaxSize().glassSource(source)) { content() }
            SheetLayer(state.entry, source)
        }
    }
}

/**
 * A sheet («шит», 2026-11-14 spec §6, №24), declared where it belongs and drawn by the shell's
 * [SheetHost] over everything: as tall as its content up to 74 % of the screen, a 42 % scrim,
 * a float surface rounded on top. It follows the finger down 1:1 and gives past open
 * ([rubberBand]); let go, it closes or springs back by its place **and** speed ([shouldClose]),
 * the spring carrying the finger's velocity. Back — the predictive gesture too — pulls it down
 * with the finger; a tap on the scrim closes it. Crossing the halfway mark gives a threshold
 * tick (the finger's only haptic here). Outside a host (previews, tests) it draws in place.
 */
@Composable
fun Sheet(open: Boolean, onClose: () -> Unit, glass: GlassTone? = null, scrim: Float = 0.42f, content: @Composable ColumnScope.() -> Unit) {
    val host = LocalSheetHost.current
    val id = remember { Any() }
    val close by rememberUpdatedState(onClose)
    val body by rememberUpdatedState(content)
    val locals = rememberUpdatedState(currentCompositionLocalContext)
    val look = rememberUpdatedState(SheetLook(glass, scrim))
    val entry = remember(id) { SheetEntry(id, { close() }, locals, look) { body() } }
    if (host == null) {
        Box(Modifier.fillMaxSize()) { SheetLayer(if (open) entry else null) }
        return
    }
    DisposableEffect(open, host) {
        if (open) host.show(entry) else host.hide(id)
        onDispose { host.hide(id) }
    }
}

@Composable
internal fun SheetLayer(entry: SheetEntry?, source: LayerBackdrop? = null) {
    var shown by remember { mutableStateOf<SheetEntry?>(null) }
    val p = remember { Animatable(0f) }      // 0 closed … 1 open
    val drag = remember { Animatable(0f) }   // px pulled down from open
    var height by remember { mutableFloatStateOf(0f) }
    val reduced = rememberReducedMotion()
    val scope = rememberCoroutineScope()
    val density = LocalDensity.current
    LaunchedEffect(entry) {
        if (entry != null) {
            shown = entry
            if (reduced) p.snapTo(1f) else p.animateTo(1f, spring(dampingRatio = .9f, stiffness = 380f))
        } else if (shown != null) {
            if (reduced) p.snapTo(0f) else p.animateTo(0f, tween(220, easing = Leave))
            shown = null
            drag.snapTo(0f)
        }
    }
    val e = shown ?: return
    CompositionLocalProvider(e.locals.value) {
    val c = MusixTheme.colors
    val haptics = LocalMusixHaptics.current
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val maxH = with(density) { (constraints.maxHeight * 0.74f).toDp() }
        Box(
            Modifier.fillMaxSize()
                .drawBehind {
                    val pulled = if (height > 0f) (drag.value / height).coerceIn(0f, 1f) else 0f
                    drawRect(Color.Black, alpha = e.look.value.scrim * p.value.coerceIn(0f, 1f) * (1f - pulled))
                }
                .pointerInput(e) { detectTapGestures { e.onClose() } },
        )
        PredictiveBackHandler(enabled = entry != null) { progress ->
            try {
                progress.collect { drag.snapTo(height * 0.35f * it.progress) }
                e.onClose()
            } catch (x: CancellationException) {
                scope.launch { drag.animateTo(0f, MusixSprings.gesture()) }
                throw x
            }
        }
        Column(
            Modifier.align(Alignment.BottomCenter).fillMaxWidth().heightIn(max = maxH)
                .onSizeChanged { height = it.height.toFloat() }
                .graphicsLayer {
                    alpha = if (height == 0f) 0f else 1f  // unmeasured: not a frame drawn open
                    translationY = (1f - p.value) * height + drag.value
                }
                .sheetSurface(e.look.value.glass, source)
                .testTag(SheetTag)
                .pointerInput(e) {
                    val tracker = VelocityTracker()
                    var raw = 0f
                    var past = false
                    detectVerticalDragGestures(
                        onDragStart = { raw = drag.value; past = false; tracker.resetTracking() },
                        onDragEnd = {
                            val v = tracker.calculateVelocity().y
                            if (shouldClose(drag.value, v, height, flingPx = 600.dp.toPx())) e.onClose()
                            else scope.launch { drag.animateTo(0f, MusixSprings.gesture(), initialVelocity = v) }
                        },
                        onDragCancel = { scope.launch { drag.animateTo(0f, MusixSprings.gesture()) } },
                    ) { change, dy ->
                        raw += dy
                        // the sheet moves under the finger: its local positions barely change,
                        // so the velocity comes from the finger's own path
                        tracker.addPosition(change.uptimeMillis, Offset(0f, raw))
                        val shownAt = if (raw >= 0f) raw else -rubberBand(-raw, height)
                        val nowPast = shownAt > height / 2f
                        if (nowPast != past) {
                            haptics.perform(if (nowPast) HapticCue.Threshold else HapticCue.ThresholdOff, fromUser = true)
                            past = nowPast
                        }
                        scope.launch { drag.snapTo(shownAt) }
                        change.consume()
                    }
                }
                .pointerInput(Unit) { detectTapGestures { } }  // a tap inside is not the scrim's
                .navigationBarsPadding()
                .imePadding(),
        ) {
            Box(Modifier.fillMaxWidth().height(22.dp), contentAlignment = Alignment.Center) {
                Box(Modifier.size(36.dp, 4.dp).background(c.textSubtle.copy(alpha = 0.35f), RoundedCornerShape(2.dp)))
            }
            e.content(this)
        }
    }
    }
}

private val SheetShape = RoundedCornerShape(topStart = 26.dp, topEnd = 26.dp)

/** The solid float, or liquid glass of [glass]'s tone made of the screen behind ([source]). */
private fun Modifier.sheetSurface(glass: GlassTone?, source: LayerBackdrop?): Modifier =
    if (glass == null) float(SheetShape) else liquidGlass(SheetShape, glass, source = source)
