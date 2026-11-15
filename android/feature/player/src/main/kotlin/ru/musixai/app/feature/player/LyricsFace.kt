package ru.musixai.app.feature.player

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.layout
import androidx.compose.ui.layout.onPlaced
import androidx.compose.ui.layout.positionInParent
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import ru.musixai.app.core.designsystem.MusixFontFamilies
import ru.musixai.app.core.designsystem.MusixIcons
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.core.designsystem.gesture.HapticCue
import ru.musixai.app.core.designsystem.gesture.LocalMusixHaptics
import ru.musixai.app.core.designsystem.gesture.Press
import ru.musixai.app.core.designsystem.gesture.pressable
import ru.musixai.app.core.designsystem.surface.GlassTone
import ru.musixai.app.core.designsystem.surface.glassSource
import ru.musixai.app.core.designsystem.surface.liquidGlass
import ru.musixai.app.core.designsystem.surface.rememberGlassSource
import ru.musixai.app.core.designsystem.text
import ru.musixai.app.core.model.PlayerContext
import ru.musixai.app.core.model.TrackSound
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

/** A line of the words: when it is sung (synced words only) and which part of the song it belongs to. */
internal data class Line(val text: String, val at: Float?, val part: Int)

/** The words as lines: synced when the library has the timing, plain otherwise; an empty line parts them. */
internal fun linesOf(ctx: PlayerContext?): List<Line> {
    if (ctx == null) return emptyList()
    val out = ArrayList<Line>()
    var part = 0
    var gap = false
    if (ctx.synced.isNotEmpty()) {
        for (l in ctx.synced) {
            if (l.text.isBlank()) { gap = true; continue }
            if (gap && out.isNotEmpty()) part++
            gap = false
            out += Line(l.text.trim(), l.atMs / 1000f, part)
        }
    } else {
        for (raw in ctx.lyrics.orEmpty().lines()) {
            if (raw.isBlank()) { gap = true; continue }
            if (gap && out.isNotEmpty()) part++
            gap = false
            out += Line(raw.trim(), null, part)
        }
    }
    return out
}

/** The mock's `pickLine`: a line, or up to four neighbours in the same part; a second tap on a lone line lets it go. */
internal fun pick(sel: List<Int>, i: Int, lines: List<Line>): List<Int> {
    val near = sel.isNotEmpty() && sel.size < 4 && lines[i].part == lines[sel[0]].part && (i == sel[0] - 1 || i == sel.last() + 1)
    return when {
        sel.size == 1 && sel[0] == i -> emptyList()
        near -> if (i < sel[0]) listOf(i) + sel else sel + i
        else -> listOf(i)
    }
}

/**
 * The back of the cover: the words over the cover softened and dimmed. Synced words follow the song —
 * the sung line lights up and stands 30 % from the top — until the reader scrolls (then they wait 4 s).
 * A tap picks a line (up to four neighbours); a glass capsule opens a line of room under the pick:
 * «Спросить о строчке» and, with synced words, «Отсюда». A pick let go folds its room and capsule away
 * (the owner, 2026-11-15: «сейчас резко убирается»); the capsule is clear glass over the words themselves.
 */
@Composable
internal fun LyricsFace(
    ctx: PlayerContext?, sound: TrackSound?, clock: Clock, playing: Boolean, accent: Color, artUri: String?, cover: Dp,
    onAsk: (List<String>) -> Unit, onFrom: (Float) -> Unit, tip: Hint,
) {
    val haptics = LocalMusixHaptics.current
    val density = LocalDensity.current
    val lines = remember(ctx?.track?.id, ctx?.synced?.size, ctx?.lyrics?.length) { linesOf(ctx) }
    val sync = lines.isNotEmpty() && lines[0].at != null
    var sel by remember(lines) { mutableStateOf(emptyList<Int>()) }
    val scroll = rememberScrollState()
    val tops = remember(lines) { mutableStateMapOf<Int, Float>() }
    var hold by remember { mutableLongStateOf(0L) }
    // the sung line, as an index that changes a few times a minute (not the clock's every frame)
    val now by remember(lines) { derivedStateOf { if (!sync) -1 else lines.indexOfLast { (it.at ?: 0f) <= clock.sec + 0.2f } } }

    // the rooms under picks: the open one, and the ones a pick let go of, folding away. `was` keeps the last
    // pick's room in place until the effect below has moved it to `leaving` — no frame without it
    val capAt = sel.lastOrNull() ?: -1
    var was by remember(lines) { mutableIntStateOf(-1) }
    val leaving = remember(lines) { mutableStateListOf<Int>() }
    val held = remember(lines) { HashMap<Int, CapRoom>() }
    fun room(i: Int) = held.getOrPut(i) { CapRoom() }
    val rooms = buildList {
        if (capAt >= 0) add(capAt)
        if (was >= 0 && was != capAt) add(was)
        for (j in leaving) if (j != capAt && j != was) add(j)
    }
    if (capAt >= 0) room(capAt).n = sel.size
    LaunchedEffect(capAt) {
        if (was >= 0 && was != capAt && was !in leaving) leaving += was
        leaving -= capAt
        was = capAt
    }
    // the words, recorded for the capsule's glass: it floats beside them, never inside its own picture
    val words = rememberGlassSource()
    val top = if (sync) cover * 0.28f else 20.dp

    Box(Modifier.fillMaxSize().background(Color(0xFF0E0E12))) {
      Box(Modifier.fillMaxSize().then(if (rooms.isNotEmpty()) Modifier.glassSource(words) else Modifier)) {
        Image(rememberSoftCover(artUri, DIM_WORDS), null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
        if (lines.isEmpty()) {
            Text(if (ctx == null) "" else "Слов этой песни пока нет", Modifier.align(Alignment.Center).padding(28.dp),
                style = MusixTheme.text.reading.copy(fontSize = 16.sp, color = Color.White.copy(alpha = 0.6f)))
            return@Box
        }
        Column(
            Modifier.fillMaxSize().pointerInput(Unit) {
                // the reader takes over: the follow waits 4 s after the last touch
                awaitPointerEventScope { while (true) { awaitPointerEvent(PointerEventPass.Initial); hold = System.currentTimeMillis() + 4000 } }
            }.verticalScroll(scroll).padding(start = 28.dp, end = 28.dp, bottom = 130.dp, top = top),
        ) {
            lines.forEachIndexed { i, l ->
                // a part keeps its wide gap (18 + the rows' 2 × 7 = 32 dp, as before); lines inside it sit closer
                if (i > 0 && lines[i - 1].part != l.part) Spacer(Modifier.height(18.dp))
                val on = i == now
                val picked = i in sel
                val color by animateColorAsState(when {
                    picked -> Color.White
                    sel.isNotEmpty() -> Color.White.copy(alpha = if (sync) 0.18f else 0.34f)
                    !sync -> Color.White.copy(alpha = 0.8f)
                    on -> Color.White
                    else -> Color.White.copy(alpha = 0.42f)
                }, tween(300), label = "ln")
                val grow by animateFloatAsState(if (on && sel.isEmpty()) 1.035f else 1f, springKcm(260f, 30f), label = "lnS")
                val bg by animateColorAsState(if (picked) Color.White.copy(alpha = 0.13f) else Color.Transparent, tween(250), label = "lnB")
                Text(
                    l.text,
                    Modifier.bleed(10.dp).onPlaced { tops[i] = it.positionInParent().y }
                        .clip(RoundedCornerShape(12.dp)).background(bg)
                        .pressable(role = Press.Row) {
                            haptics.perform(HapticCue.Tick, fromUser = true)
                            sel = pick(sel, i, lines)
                            tip.hide(false)
                        }
                        .padding(horizontal = 10.dp, vertical = 7.dp)
                        .graphicsLayer { transformOrigin = TransformOrigin(0f, 0.5f); scaleX = grow; scaleY = grow },
                    style = MusixTheme.text.body.copy(fontFamily = MusixFontFamilies.Geist, fontWeight = FontWeight.SemiBold, fontSize = if (cover < 340.dp) 18.sp else 20.sp, lineHeight = 1.3.em, letterSpacing = (-0.015).em, color = color),
                )
                // the capsule opens a line of room for itself: the words below slide down, the next line stays free to tap
                if (i in rooms) Room(room(i), open = i == capAt) { leaving.remove(i); held.remove(i) }
            }
        }
      }
        // the capsules over the rooms, outside the recorded words
        for (i in rooms) key(i) {
            val r = room(i)
            val open = i == capAt
            Capsule(r, open, sync,
                at = { IntOffset(28.dp.roundToPx(), (top.toPx() + r.top - scroll.value + 3.dp.toPx()).roundToInt()) },
                glass = Modifier.liquidGlass(RoundedCornerShape(999.dp), GlassTone.Clear, source = words, onArt = true),
                onAsk = {
                    if (!open) return@Capsule
                    haptics.perform(HapticCue.Tick, fromUser = true)
                    onAsk(sel.map { lines[it].text })
                }, onFrom = {
                    if (!open) return@Capsule
                    val at = lines[sel[0]].at ?: return@Capsule
                    sel = emptyList(); hold = 0L
                    if (playing) haptics.perform(HapticCue.Tick, fromUser = true)
                    onFrom(at)
                })
        }
    }

    // the follow: the sung line 30 % from the top, unless the reader holds the words
    LaunchedEffect(now, sel.isEmpty()) {
        if (now < 0 || sel.isNotEmpty() || System.currentTimeMillis() < hold) return@LaunchedEffect
        val y = ((tops[now] ?: 0f) - with(density) { (cover * 0.3f).toPx() }).coerceAtLeast(0f).toInt()
        scroll.animateScrollTo(y, springOf(0.5f))
    }
    // the pick must not stand under the edge: make room for the capsule
    LaunchedEffect(sel) {
        val last = sel.lastOrNull() ?: return@LaunchedEffect
        val bottom = (tops[last] ?: return@LaunchedEffect) + with(density) { (44 + 66).dp.toPx() }
        val need = bottom - (scroll.value + scroll.viewportSize)
        if (need > 0) scroll.animateScrollTo(scroll.value + need.toInt(), springOf(0.45f))
    }
}

/** A pick's room and its capsule: how open they are and where the room stands among the words. */
private class CapRoom {
    val room = Animatable(0f)
    val cap = Animatable(0f)
    var top by mutableFloatStateOf(0f)
    /** How many lines the capsule speaks of — kept while it folds away, after the pick is gone. */
    var n = 1
}

/** The room under a pick: opens with it, and folds away (the words below slide back up) when it is let go. */
@Composable
private fun Room(r: CapRoom, open: Boolean, onGone: () -> Unit) {
    LaunchedEffect(open) {
        coroutineScope {
            if (open) {
                launch { r.room.animateTo(1f, springOf(0.34f)) }
                launch { r.cap.animateTo(1f, springKcm(300f, 22f)) }
            } else {
                launch { r.cap.animateTo(0f, tween(180, easing = FastOutSlowInEasing)) }
                launch { r.room.animateTo(0f, tween(300, delayMillis = 40, easing = FastOutSlowInEasing)) }
            }
        }
        if (!open) onGone()
    }
    // the height in the layout pass: the words below move without a recomposition per frame
    Spacer(Modifier.fillMaxWidth().onPlaced { r.top = it.positionInParent().y }.layout { m, c ->
        val h = (54.dp.toPx() * r.room.value).roundToInt().coerceAtLeast(0)
        val p = m.measure(Constraints.fixed(c.maxWidth, h))
        layout(c.maxWidth, h) { p.place(0, 0) }
    })
}

@Composable
private fun Capsule(r: CapRoom, open: Boolean, sync: Boolean, at: androidx.compose.ui.unit.Density.() -> IntOffset, glass: Modifier, onAsk: () -> Unit, onFrom: () -> Unit) {
    Row(
        Modifier.offset(at).graphicsLayer {
            val k = r.cap.value
            alpha = k.coerceIn(0f, 1f); transformOrigin = TransformOrigin(0.18f, 0f)
            val s = 0.9f + 0.1f * k; scaleX = s; scaleY = s; translationY = (1f - k) * -8.dp.toPx()
        }.then(glass).clip(RoundedCornerShape(999.dp)).padding(4.dp),
    ) {
        CapButton(MusixIcons.Sparkles, if (r.n > 1) "Спросить о ${r.n} строчках" else "Спросить о строчке", onAsk)
        if (sync) {
            Box(Modifier.padding(vertical = 8.dp).width(1.dp).height(24.dp).background(Color.White.copy(alpha = 0.16f)))
            CapButton(MusixIcons.Play, "Отсюда", onFrom)
        }
    }
}

@Composable
private fun CapButton(icon: androidx.compose.ui.graphics.vector.ImageVector, text: String, onClick: () -> Unit) {
    Row(Modifier.height(40.dp).clip(RoundedCornerShape(999.dp)).pressable(role = Press.Chip) { onClick() }.padding(horizontal = 14.dp),
        verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, null, Modifier.size(16.dp), tint = Color.White)
        Spacer(Modifier.width(7.dp))
        Text(text, style = MusixTheme.text.label.copy(fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = Color.White))
    }
}

/** As wide as the column plus [by] on each side (the CSS `margin: 0 -10px`): the pick's tint reaches past the words. */
internal fun Modifier.bleed(by: Dp): Modifier = layout { m, c ->
    val extra = (by * 2).roundToPx()
    val p = m.measure(c.copy(minWidth = c.maxWidth + extra, maxWidth = c.maxWidth + extra))
    layout(c.maxWidth, p.height) { p.place(-extra / 2, 0) }
}
