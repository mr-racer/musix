package ru.musixai.app.feature.player

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
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
    var artistTab by remember(ctx?.track?.id) { mutableStateOf(false) }
    var page by remember(ctx?.track?.id, artistTab) { mutableIntStateOf(0) }
    Column(modifier.fillMaxWidth()) {
        if (ctx == null) {
            Skel(Modifier.fillMaxWidth().height(90.dp), 14.dp)
            return@Column
        }
        val facts = if (artistTab || ctx.songFacts.isEmpty()) ctx.artistFacts else ctx.songFacts
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
        val classes = facts.mapNotNull { classOf(it) }.groupingBy { it }.eachCount()
        val shown = classOf(facts[page.coerceIn(0, facts.lastIndex)])
        FlowRow(Modifier.padding(top = 12.dp, start = 4.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            for ((cls, n) in classes) {
                val hue = cls.second
                val lit = cls == shown
                Row(verticalAlignment = Alignment.CenterVertically) {
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
        Text(f.text, Modifier.padding(horizontal = 6.dp, vertical = 12.dp),
            style = MusixTheme.type.serif.copy(fontSize = 17.sp, lineHeight = 1.5.em, color = c.text.copy(alpha = if (f.confirmed) 1f else 0.82f)))
    }
}

/** Synced LRC: the current line lit and larger; a tap seeks there. Plain text otherwise. */
@Composable
fun LyricsPanel(ctx: PlayerContext?, positionMs: Long, onSeek: (Long) -> Unit, modifier: Modifier = Modifier) {
    val c = MusixTheme.colors
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Eyebrow("Текст песни", Modifier.padding(bottom = 6.dp))
        when {
            ctx == null -> Skel(Modifier.fillMaxWidth().height(120.dp), 12.dp)
            ctx.synced.isNotEmpty() -> {
                val cur = ctx.synced.indexOfLast { it.atMs <= positionMs + 250 }
                val window = ctx.synced.withIndex().toList().let { all -> all.subList((cur - 3).coerceAtLeast(0), (cur + 9).coerceAtMost(all.size)) }
                for ((i, line) in window) {
                    val on = i == cur
                    val col by animateColorAsState(if (on) c.text else c.textSubtle, label = "line")
                    Text(line.text.ifEmpty { "♪" }, Modifier.pressable { onSeek(line.atMs) },
                        style = MusixTheme.type.serif.copy(fontSize = if (on) 20.sp else 17.sp, lineHeight = 1.4.em, fontWeight = if (on) FontWeight.SemiBold else FontWeight.Normal, color = col))
                }
            }
            ctx.lyrics != null -> Text(ctx.lyrics!!, style = MusixTheme.type.serif.copy(fontSize = 16.sp, lineHeight = 1.6.em, color = c.text))
            else -> Empty("Текста для этого трека нет", Modifier.fillMaxWidth())
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

/** The queue: tap = jump, long-press + drag = reorder, × = remove. History above the current
 *  item is dimmed; «Поток» shows its own upcoming tracks. */
@Composable
fun QueueList(p: PlayerState, onJump: (Int) -> Unit, onMove: (Int, Int) -> Unit, onRemove: (Int) -> Unit, streaming: Boolean, modifier: Modifier = Modifier) {
    val c = MusixTheme.colors
    if (p.queue.isEmpty()) return
    Column(modifier.fillMaxWidth()) {
        Eyebrow(if (streaming) "Дальше в потоке" else "Очередь", Modifier.padding(start = 4.dp, bottom = 8.dp, top = 8.dp))
        var dragging by remember { mutableIntStateOf(-1) }
        var dy by remember { mutableFloatStateOf(0f) }
        val rowPx = with(androidx.compose.ui.platform.LocalDensity.current) { 58.dp.toPx() }
        for (e in p.queue.drop((p.index - 1).coerceAtLeast(0)).take(30)) {
            val here = e.index == p.index
            val past = e.index < p.index
            Row(
                Modifier.fillMaxWidth().height(58.dp)
                    .graphicsLayer { if (dragging == e.index) { translationY = dy; shadowElevation = 12f }; alpha = if (past) 0.45f else 1f }
                    .clip(RoundedCornerShape(12.dp))
                    .background(if (here) c.accentBg else Color.Transparent)
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
                AsyncImage(e.artUri, null, Modifier.size(42.dp).clip(RoundedCornerShape(8.dp)).background(c.surface2))
                Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                    Text(e.title, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MusixTheme.type.body.copy(fontSize = 14.sp, fontWeight = if (here) FontWeight.SemiBold else FontWeight.Medium, color = if (here) c.accentLight else c.text))
                    Text(e.artist, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MusixTheme.type.body.copy(fontSize = 12.5.sp, color = c.textMuted))
                }
                if (!here) Icon(MusixIcons.Close, "Убрать", Modifier.size(36.dp).pressable { onRemove(e.index) }.padding(10.dp), tint = c.textSubtle)
            }
        }
    }
}
