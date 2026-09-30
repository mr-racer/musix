package ru.musixai.app.feature.player

import ru.musixai.app.core.designsystem.component.rise
import kotlinx.coroutines.delay
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.key
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.keyframes
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.ui.graphics.Brush
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import ru.musixai.app.core.designsystem.MusixIcons
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.core.designsystem.component.Empty
import ru.musixai.app.core.designsystem.component.Eyebrow
import ru.musixai.app.core.designsystem.component.Skel
import ru.musixai.app.core.designsystem.component.pressable
import ru.musixai.app.core.designsystem.component.skeButton
import ru.musixai.app.core.designsystem.component.skeInset
import ru.musixai.app.core.designsystem.oklch
import ru.musixai.app.core.model.Fact
import ru.musixai.app.core.model.PlayerContext
import ru.musixai.app.core.player.PlayerState
import kotlin.math.roundToInt

/** v1's fact classes: the most specific label names the card, its hue colours it. */
private val FACT_CLASSES = listOf(
    "sample" to ("сэмпл" to 170f), "name_origin" to ("название" to 125f), "title_origin" to ("название" to 125f),
    "trouble" to ("спор" to 15f), "record" to ("рекорд" to 45f), "award" to ("награда" to 90f), "video" to ("клип" to 335f),
    "placement" to ("где звучит" to 140f), "sound" to ("звук" to 215f), "creation" to ("создание" to 75f),
    "personal" to ("личное" to 350f), "band_history" to ("история" to 55f),
)

private fun classOf(f: Fact) = FACT_CLASSES.firstOrNull { it.first in f.labels }?.second

/** v1 `FactsRail` (player variant): song / artist tabs, a pager, the class line, the fact. */
@Composable
fun FactsRail(ctx: PlayerContext?, modifier: Modifier = Modifier) {
    val c = MusixTheme.colors
    val dark = MusixTheme.isDark
    // v1: the scope is sticky across tracks; a pinned class is per track and scope
    var artistTab by rememberSaveable { mutableStateOf(false) }
    val track = ctx?.track?.id
    var pin by remember(track, artistTab) { mutableStateOf<Pair<String, Float>?>(null) }
    var page by remember(track, artistTab, pin) { mutableIntStateOf(0) }
    Column(modifier.fillMaxWidth()) {
        if (ctx == null) {
            Skel(Modifier.fillMaxWidth().height(90.dp), 14.dp)
            return@Column
        }
        val all = if (artistTab || ctx.songFacts.isEmpty()) ctx.artistFacts else ctx.songFacts
        val facts = pin?.let { p -> all.filter { classOf(it) == p } }?.takeIf { it.isNotEmpty() } ?: all
        // v1 rotates the player's facts every 12 s (a phone has no hover to pause it)
        LaunchedEffect(track, artistTab, pin, facts.size) {
            if (facts.size < 2) return@LaunchedEffect
            while (true) { delay(12_000); page = (page + 1) % facts.size }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Row(Modifier.skeInset(RoundedCornerShape(22.dp)).padding(3.dp)) {
                for ((i, label) in listOf("ПЕСНЯ", "АРТИСТ").withIndex()) {
                    val on = (i == 1) == (artistTab || ctx.songFacts.isEmpty())
                    Box((if (on) Modifier.skeButton(20.dp) else Modifier).pressable { artistTab = i == 1 }.padding(horizontal = 16.dp, vertical = 8.dp)) {
                        Text(label, style = MusixTheme.type.mono.copy(fontSize = 12.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 0.12.em,
                            color = if (on) c.text else c.textSubtle))
                    }
                }
            }
            Spacer(Modifier.weight(1f))
            if (facts.size > 1) {
                Text("‹", Modifier.pressable { page = (page - 1 + facts.size) % facts.size }.padding(horizontal = 12.dp), style = MusixTheme.type.body.copy(fontSize = 20.sp, color = c.textMuted))
                Text("${page + 1} / ${facts.size}", style = MusixTheme.type.mono.copy(fontSize = 12.sp, color = c.textSubtle))
                Text("›", Modifier.pressable { page = (page + 1) % facts.size }.padding(horizontal = 12.dp), style = MusixTheme.type.body.copy(fontSize = 20.sp, color = c.textMuted))
            }
        }
        if (facts.isEmpty()) {
            Empty("Фактов об этом треке пока нет", Modifier.fillMaxWidth())
            return@Column
        }
        // the class line: every class on this subject with its count, the shown one lit
        val classes = all.mapNotNull { classOf(it) }.groupingBy { it }.eachCount()
        val shown = pin ?: classOf(facts[page.coerceIn(0, facts.lastIndex)])
        FlowRow(Modifier.padding(top = 12.dp, start = 4.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            for ((cls, n) in classes) {
                val hue = cls.second
                val lit = cls == shown
                // a tap pins the class (the pager then walks only its facts); a second tap frees it
                Row(Modifier.pressable { pin = if (pin == cls) null else cls }, verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(7.dp).clip(CircleShape).background(oklch(if (dark) 78f else 48f, 0.13f, hue)))
                    Spacer(Modifier.width(7.dp))
                    Text(cls.first, style = MusixTheme.type.mono.copy(fontSize = 12.sp, letterSpacing = 0.04.em,
                        color = if (lit) oklch(if (dark) 78f else 48f, 0.13f, hue) else c.textMuted))
                    if (n > 1) Text("  $n", style = MusixTheme.type.mono.copy(fontSize = 11.sp, color = c.textSubtle))
                }
            }
        }
        Box(Modifier.padding(start = 6.dp, top = 12.dp).width(48.dp).height(1.dp).background(c.border))
        val f = facts[page.coerceIn(0, facts.lastIndex)]
        // v1 `factIn`: every new fact rises 8 dp out of a 2 dp blur over 550 ms
        key(track, artistTab, pin, page) {
            Text(f.text, Modifier.rise(distance = 8.dp, blur = 2.dp, durationMs = 550).padding(horizontal = 6.dp, vertical = 12.dp),
                style = MusixTheme.type.serif.copy(fontSize = 17.sp, lineHeight = 1.5.em, color = c.text.copy(alpha = if (f.confirmed) 1f else 0.82f)))
        }
    }
}

/** Producer and sample badges (v1's «Связи песен» under the cover). */
@Composable
fun Credits(ctx: PlayerContext?, modifier: Modifier = Modifier) {
    val c = MusixTheme.colors
    val items = ctx?.let { it.producers.map { r -> "продюсер" to r.text } + it.samples.map { r -> "сэмпл" to r.text } + it.sampledBy.map { r -> "сэмплировали" to r.text } }.orEmpty()
    if (items.isEmpty()) return
    FlowRow(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        for ((kind, text) in items.take(8)) {
            Row(Modifier.clip(RoundedCornerShape(999.dp)).background(if (MusixTheme.isDark) Color(0x12FFFFFF) else Color(0x0D000000)).padding(horizontal = 12.dp, vertical = 6.dp)) {
                Text("$kind · ", style = MusixTheme.type.mono.copy(fontSize = 11.sp, color = c.textSubtle))
                Text(text, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MusixTheme.type.body.copy(fontSize = 12.5.sp, color = c.textMuted))
            }
        }
    }
}

/** v1's phone queue entry under the facts: «ОЧЕРЕДЬ · N ›» opens the full-screen drawer. */
@Composable
fun QueueButton(count: Int, onOpen: () -> Unit, modifier: Modifier = Modifier) {
    val c = MusixTheme.colors
    val dark = MusixTheme.isDark
    Row(
        modifier.fillMaxWidth().height(48.dp).clip(RoundedCornerShape(14.dp))
            .background(if (dark) Color(0x0DFFFFFF) else Color(0x0A161620))
            .border(1.dp, if (dark) Color(0x14FFFFFF) else Color(0x1A161620), RoundedCornerShape(14.dp))
            .pressable(onClick = onOpen).padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("ОЧЕРЕДЬ · $count", Modifier.weight(1f), style = MusixTheme.type.body.copy(fontSize = 11.sp, letterSpacing = 0.16.em, color = c.text))
        Icon(MusixIcons.ChevronRight, null, Modifier.size(18.dp), tint = c.text)
    }
}

/**
 * v1's queue drawer on a phone: full screen, sliding up over 300 ms, a × to close; the
 * header «ОЧЕРЕДЬ · N ТРЕКОВ»; the playing row lit with the equalizer; tap = jump,
 * long-press + drag (or the ⋮⋮ grip) = reorder, × = remove.
 */
@Composable
fun QueueDrawer(open: Boolean, p: PlayerState, onClose: () -> Unit, onJump: (Int) -> Unit, onMove: (Int, Int) -> Unit, onRemove: (Int) -> Unit) {
    val c = MusixTheme.colors
    val dark = MusixTheme.isDark
    val k by animateFloatAsState(if (open) 1f else 0f, tween(300, easing = CubicBezierEasing(0.22f, 0.9f, 0.3f, 1f)), label = "queue")
    if (k <= 0f) return
    androidx.activity.compose.BackHandler(open, onClose)
    Column(
        Modifier.fillMaxSize().graphicsLayer { translationY = size.height * (1f - k) }
            .background(if (dark) Color(0xFA0E0E14) else Color(0xFAF8F7FC))
            .pointerInput(Unit) { detectTapGestures { } }  // the player underneath takes no taps
            .statusBarsPadding().navigationBarsPadding().padding(horizontal = 14.dp, vertical = 10.dp),
    ) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            Icon(MusixIcons.Close, "Закрыть", Modifier.size(44.dp).clip(CircleShape).pressable(onClick = onClose).padding(13.dp), tint = c.text)
        }
        Text("ОЧЕРЕДЬ · ${p.queue.size} ТРЕКОВ", Modifier.padding(start = 4.dp, bottom = 10.dp),
            style = MusixTheme.type.body.copy(fontSize = 10.sp, letterSpacing = 0.2.em, color = if (dark) Color(0xFF888888) else Color(0xFF5A5A66)))
        if (p.queue.isEmpty()) {
            Text("Очередь пуста", Modifier.fillMaxWidth().padding(30.dp), textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                style = MusixTheme.type.body.copy(fontSize = 13.sp, color = if (dark) Color(0xFF888888) else Color(0xFF5A5A66)))
            return@Column
        }
        var dragging by remember { mutableIntStateOf(-1) }
        var dy by remember { mutableFloatStateOf(0f) }
        val rowPx = with(androidx.compose.ui.platform.LocalDensity.current) { 60.dp.toPx() }
        val list = rememberLazyListState(initialFirstVisibleItemIndex = (p.index - 1).coerceAtLeast(0))
        LazyColumn(Modifier.fillMaxWidth().weight(1f), state = list) {
            items(p.queue, key = { it.index }) { e ->
                val here = e.index == p.index
                val past = e.index < p.index
                Row(
                    Modifier.fillMaxWidth().height(60.dp).animateItem()
                        .graphicsLayer { if (dragging == e.index) { translationY = dy; shadowElevation = 14f }; alpha = if (past) 0.5f else 1f }
                        .clip(RoundedCornerShape(12.dp))
                        .background(if (here) Brush.horizontalGradient(listOf(c.amber.copy(alpha = 0.16f), c.amber.copy(alpha = 0.05f))) else Brush.horizontalGradient(listOf(Color.Transparent, Color.Transparent)))
                        .border(1.dp, if (here) c.amber.copy(alpha = 0.22f) else Color.Transparent, RoundedCornerShape(12.dp))
                        .pointerInput(e.index) {
                            detectDragGesturesAfterLongPress(
                                onDragStart = { dragging = e.index; dy = 0f },
                                onDragEnd = {
                                    val to = (e.index + (dy / rowPx).roundToInt()).coerceIn(0, p.queue.lastIndex)
                                    if (to != e.index) onMove(e.index, to)
                                    dragging = -1; dy = 0f
                                },
                                onDragCancel = { dragging = -1; dy = 0f },
                            ) { _, d -> dy += d.y }
                        }
                        .pressable { onJump(e.index) }
                        .padding(horizontal = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(Modifier.size(26.dp), contentAlignment = Alignment.Center) {
                        if (here) EqBars(c.accent) else Text(if (e.index > p.index) "${e.index - p.index}" else "",
                            style = MusixTheme.type.body.copy(fontSize = 12.sp, color = c.textSubtle))
                    }
                    AsyncImage(e.artUri, null, Modifier.padding(start = 6.dp).size(42.dp).clip(RoundedCornerShape(8.dp)).background(c.surface2))
                    Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                        Text(e.title, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MusixTheme.type.body.copy(fontSize = 14.sp, fontWeight = if (here) FontWeight.SemiBold else FontWeight.Medium, color = c.text))
                        Text(e.artist, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MusixTheme.type.body.copy(fontSize = 12.5.sp, color = c.textMuted))
                    }
                    if (!here && !past) {
                        Icon(MusixIcons.Close, "Убрать", Modifier.size(36.dp).pressable { onRemove(e.index) }.padding(10.dp), tint = c.textSubtle)
                        Icon(MusixIcons.Drag, "Перетащить", Modifier.size(36.dp).padding(8.dp), tint = c.textSubtle)
                    }
                }
            }
        }
    }
}

/** v1 `.player-eq-bar`: three accent bars bouncing out of phase (0.8 / 0.6 / 0.7 s). */
@Composable
fun EqBars(accent: Color, modifier: Modifier = Modifier) {
    val t = rememberInfiniteTransition(label = "eq")
    val h = listOf(800 to (4f to 14f), 600 to (8f to 16f), 700 to (6f to 12f)).map { (ms, r) ->
        t.animateFloat(r.first, r.first, infiniteRepeatable(keyframes { durationMillis = ms; r.first at 0; r.second at ms / 2; r.first at ms }), label = "bar")
    }
    Row(modifier.height(16.dp), horizontalArrangement = Arrangement.spacedBy(1.dp), verticalAlignment = Alignment.Bottom) {
        for (b in h) {
            Box(Modifier.size(3.dp, b.value.dp).clip(RoundedCornerShape(2.dp))
                .background(Brush.verticalGradient(listOf(accent, accent.copy(alpha = 0.25f), accent))))
        }
    }
}
