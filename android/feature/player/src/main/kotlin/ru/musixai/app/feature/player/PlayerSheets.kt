package ru.musixai.app.feature.player

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.dropShadow
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.shadow.Shadow
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import ru.musixai.app.core.designsystem.MusixFontFamilies
import ru.musixai.app.core.designsystem.MusixIcons
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.core.designsystem.content.AskedLine
import ru.musixai.app.core.designsystem.content.TurnRule
import ru.musixai.app.core.designsystem.control.FoldingComposer
import ru.musixai.app.core.designsystem.control.Pill
import ru.musixai.app.core.designsystem.control.PillStyle
import ru.musixai.app.core.designsystem.control.RichboxState
import ru.musixai.app.core.designsystem.control.RoundButton
import ru.musixai.app.core.designsystem.gesture.HapticCue
import ru.musixai.app.core.designsystem.gesture.LocalMusixHaptics
import ru.musixai.app.core.designsystem.gesture.Press
import ru.musixai.app.core.designsystem.gesture.SwipeToRemove
import ru.musixai.app.core.designsystem.gesture.pressable
import ru.musixai.app.core.designsystem.motion.rememberReducedMotion
import ru.musixai.app.core.designsystem.surface.GlassTone
import ru.musixai.app.core.designsystem.surface.LocalToasts
import ru.musixai.app.core.designsystem.surface.MorphMenu
import ru.musixai.app.core.designsystem.surface.Sheet
import ru.musixai.app.core.designsystem.surface.rememberMorph
import ru.musixai.app.core.designsystem.text
import ru.musixai.app.core.model.Playlist
import sh.calvin.reorderable.ReorderableItem
import sh.calvin.reorderable.rememberReorderableLazyListState

/* ================= the sheet's head: a title, an aside, the close button ================= */

@Composable
private fun SheetHead(title: String, aside: String? = null, onClose: () -> Unit) {
    val c = MusixTheme.colors
    Row(Modifier.fillMaxWidth().padding(start = 22.dp, end = 8.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(title, Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis,
            style = MusixTheme.text.heading.copy(fontSize = 24.sp, fontWeight = FontWeight.Bold, letterSpacing = (-0.03).em, color = c.text))
        if (!aside.isNullOrEmpty()) Text(aside, style = MusixTheme.text.number.copy(fontSize = 13.sp, color = c.textMuted))
        RoundButton(MusixIcons.Close, "Закрыть", onClose, filled = false)
    }
}

/* ================= «О песне»: a strip of facts, then the credits as on a film ================= */

private val CAT = mapOf("creation" to "Создание", "record" to "Запись", "sample" to "Семплы", "sound" to "Звук", "trouble" to "Споры", "video" to "Клип")

private data class FactLine(val text: String, val group: String, val cat: String)

@Composable
internal fun AboutSheet(open: Boolean, ui: PlayerUi, accent: Color, onClose: () -> Unit, onArtist: (String) -> Unit, onAsk: (String) -> Unit) {
    Sheet(open, onClose, glass = GlassTone.Deep, scrim = 0.36f) {
        SheetHead("О песне", onClose = onClose)
        About(ui, accent, onArtist, onAsk)
    }
}

@Composable
private fun ColumnScope.About(ui: PlayerUi, accent: Color, onArtist: (String) -> Unit, onAsk: (String) -> Unit) {
    val c = MusixTheme.colors
    val dark = MusixTheme.isDark
    val haptics = LocalMusixHaptics.current
    val toasts = LocalToasts.current
    val ctx = ui.context
    val title = ui.player.title ?: ctx?.track?.title.orEmpty()
    val artist = ctx?.track?.artist ?: ui.player.artist.orEmpty()
    val facts = remember(ctx) {
        (ctx?.songFacts.orEmpty().map { FactLine(it.text, "Песня", CAT[it.labels.firstOrNull()] ?: "Факт") } +
            ctx?.artistFacts.orEmpty().map { FactLine(it.text, "Артист", artist) })
    }
    var at by remember(ctx?.track?.id) { mutableIntStateOf(0) }
    var dir by remember { mutableIntStateOf(1) }
    fun show(i: Int, d: Int) {
        if (facts.isEmpty()) return
        val n = (i + facts.size) % facts.size
        if (n == at) return
        dir = d; at = n
        haptics.perform(HapticCue.Tick, fromUser = true)
    }
    val catColor = if (dark) lerp(Color.White, accent, 0.66f) else accent
    Column(Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState()).padding(start = 22.dp, end = 22.dp, top = 6.dp, bottom = 22.dp)) {
        if (facts.isEmpty()) Text("Истории об этой песне ещё собираются.", style = MusixTheme.text.reading.copy(fontSize = 16.sp, color = c.textMuted))
        else {
            // the strip speaks the language of the seek line: one block per fact, the read ones filled
            Row(Modifier.fillMaxWidth().height(24.dp), verticalAlignment = Alignment.CenterVertically) {
                facts.forEachIndexed { i, f ->
                    if (i > 0) Spacer(Modifier.width(if (f.group != facts[i - 1].group) 12.dp else 3.dp))
                    val on = i == at
                    val k by animateFloatAsState(if (on) 1.5f else 1f, springKcm(400f, 20f), label = "f$i")
                    Box(Modifier.weight(1f).height(24.dp).pressable(role = Press.Chip) { show(i, if (i > at) 1 else -1) }, contentAlignment = Alignment.Center) {
                        Box(Modifier.fillMaxWidth().height(4.dp).graphicsLayer { scaleY = k }.background(
                            when { on -> accent; i < at -> accent.copy(alpha = 0.44f); else -> c.text.copy(alpha = 0.2f) }, RoundedCornerShape(2.dp)))
                    }
                }
            }
            Row(Modifier.fillMaxWidth().padding(top = 4.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("${facts[at].group} · ${facts[at].cat}".uppercase(), style = MusixTheme.text.cap.copy(fontSize = 11.sp, color = catColor))
                Text("${at + 1} / ${facts.size}", style = MusixTheme.text.number.copy(fontSize = 12.sp, color = c.textMuted))
            }
            // the fact: a tap on the right goes on, on the left back; a swipe the same
            Box(Modifier.padding(top = 10.dp).fillMaxWidth().pointerInput(facts) {
                awaitEachGesture {
                    val down = awaitFirstDown()
                    var last = down
                    while (true) {
                        val ev = awaitPointerEvent()
                        val ch = ev.changes.firstOrNull { it.id == down.id } ?: break
                        last = ch
                        if (!ch.pressed) break
                    }
                    val dx = last.position.x - down.position.x
                    if (kotlin.math.abs(dx) > 36.dp.toPx()) show(at + if (dx < 0) 1 else -1, if (dx < 0) 1 else -1)
                    else if (kotlin.math.abs(dx) < 8.dp.toPx()) { val back = down.position.x < size.width * 0.3f; show(at + if (back) -1 else 1, if (back) -1 else 1) }
                }
            }) {
                androidx.compose.animation.AnimatedContent(at, transitionSpec = {
                    (fadeIn(tween(380, delayMillis = 110)) + androidx.compose.animation.slideInHorizontally(tween(380, delayMillis = 110)) { dir * 22 }) togetherWith
                        (fadeOut(tween(170)) + androidx.compose.animation.slideOutHorizontally(tween(170)) { -dir * 18 })
                }, label = "fact") { i ->
                    Text(facts[i].text, style = MusixTheme.text.reading.copy(fontSize = 18.sp, lineHeight = 1.5.em, color = c.text))
                }
            }
        }
        Row(Modifier.padding(top = 18.dp).pressable(role = Press.Chip) { onAsk("Что значит название «$title»?") }, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Icon(MusixIcons.Sparkles, null, Modifier.size(16.dp), tint = c.text)
            Text("Что значит название «$title»?", style = MusixTheme.text.label.copy(fontSize = 14.sp, color = c.text))
        }
        // the credits round one axis, as end titles stand
        val rows = buildList<Pair<String, @Composable () -> Unit>> {
            val prod = ctx?.producers.orEmpty().take(4)
            if (prod.isNotEmpty()) add("Продюсеры" to {
                prod.forEach { r ->
                    Text(r.text, Modifier.pressable(role = Press.Chip) { r.artistId?.let(onArtist) ?: toasts?.show("Продюсер: ${r.text}") },
                        style = MusixTheme.text.body.copy(fontSize = 15.sp, color = c.text, textDecoration = TextDecoration.Underline))
                }
            })
            ctx?.track?.genre?.let { g -> add("Жанр" to { Text(g, style = MusixTheme.text.body.copy(fontSize = 15.sp, color = c.text)) }) }
            ctx?.track?.year?.let { y -> add("Год" to { Text("$y", style = MusixTheme.text.number.copy(fontFamily = MusixFontFamilies.Mono, fontSize = 14.sp, color = c.text)) }) }
            val smp = ctx?.samples.orEmpty()
            if (smp.isNotEmpty()) add("Семплирует" to {
                smp.take(4).forEach { r ->
                    Column(Modifier.pressable(role = Press.Chip) { if (r.trackId == null) toasts?.show("Этой песни нет в фонотеке") }) {
                        Text(r.text, style = MusixTheme.text.body.copy(fontSize = 15.sp, fontWeight = FontWeight.Medium, color = c.text))
                        if (r.trackId == null) Text("нет в фонотеке", style = MusixTheme.text.caption.copy(fontSize = 12.sp, color = c.textMuted))
                    }
                }
            })
            val by = ctx?.sampledBy.orEmpty()
            if (by.isNotEmpty()) add("Его семплируют" to { by.take(3).forEach { Text(it.text, style = MusixTheme.text.body.copy(fontSize = 15.sp, color = c.text)) } })
        }
        Column(Modifier.padding(top = 26.dp, bottom = 6.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            rows.forEach { (k, v) ->
                Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    Text(k.uppercase(), Modifier.weight(0.4f).padding(top = 3.dp), textAlign = TextAlign.End, style = MusixTheme.text.cap.copy(fontSize = 11.sp, color = c.textMuted))
                    Column(Modifier.weight(0.6f), verticalArrangement = Arrangement.spacedBy(5.dp)) { v() }
                }
            }
        }
    }
}

/* ================= «Далее»: the queue ================= */

private fun minutes(ms: Long): String {
    val m = (ms / 60_000).toInt()
    return if (m >= 60) "${m / 60} ч ${m % 60} мин" else "$m мин"
}

@Composable
internal fun QueueSheet(open: Boolean, ui: PlayerUi, vm: PlayerViewModel, accent: Color, onClose: () -> Unit) {
    // a list of words to read: the matte glass (the owner's rule of 2026-11-15), the light scrim keeps
    // the player seen through
    Sheet(open, onClose, glass = GlassTone.Deep, scrim = 0.14f) {
        SheetHead("Далее", aside = null, onClose = onClose)
        Queue(ui, vm, accent, onClose)
    }
}

@Composable
private fun ColumnScope.Queue(ui: PlayerUi, vm: PlayerViewModel, accent: Color, onClose: () -> Unit) {
    val c = MusixTheme.colors
    val dark = MusixTheme.isDark
    val haptics = LocalMusixHaptics.current
    val toasts = LocalToasts.current
    val p = ui.player
    val now = p.queue.getOrNull(p.index)
    // the list as the finger sees it: moved locally while a row is carried, committed on the drop
    val rows = remember { mutableStateListOf<ru.musixai.app.core.player.QueueEntry>() }
    var carrying by remember { mutableStateOf<String?>(null) }
    var from by remember { mutableIntStateOf(-1) }
    val fresh = p.queue.drop(p.index + 1)
    if (carrying == null && rows.toList() != fresh) { rows.clear(); rows.addAll(fresh) }
    val list = rememberLazyListState()
    val reorder = rememberReorderableLazyListState(list) { a, b ->
        val ai = rows.indexOfFirst { key(it) == a.key }; val bi = rows.indexOfFirst { key(it) == b.key }
        if (ai >= 0 && bi >= 0) { rows.add(bi, rows.removeAt(ai)); haptics.perform(HapticCue.Tick, fromUser = true) }
    }
    val nowInk = if (dark) lerp(Color.White, accent, 0.62f) else accent
    LazyColumn(Modifier.weight(1f, fill = false).padding(horizontal = 22.dp), state = list) {
        item(key = "now-cap") { Cap("Сейчас") }
        if (now != null) item(key = "now") {
            SwipeToRemove(onRemove = {}, enabled = false, onReject = { toasts?.show("Играющую песню убрать нельзя") }) {
                QueueRow(now.artUri, now.title, now.artist, null, titleColor = nowInk) { Eq(p.isPlaying, accent) }
            }
        }
        item(key = "next-cap") {
            Row(Modifier.padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Cap(if (rows.isEmpty()) "Дальше пусто" else "Далее · ${rows.size}", Modifier.weight(1f))
                if (rows.isNotEmpty()) Text(minutes(rows.size * 210_000L), style = MusixTheme.text.number.copy(fontSize = 12.sp, color = c.textMuted))
            }
        }
        itemsIndexed(rows, key = { _, e -> key(e) }) { i, e ->
            ReorderableItem(reorder, key = key(e)) { dragging ->
                val lift by animateFloatAsState(if (dragging) 1f else 0f, springKcm(420f, 30f), label = "lift")
                SwipeToRemove(onRemove = {
                    val at = p.index + 1 + i
                    vm.remove(at)
                    toasts?.show("Убрано: ${e.title}", "Вернуть") { vm.restore(e.trackId, at) }
                }) {
                    QueueRow(e.artUri, e.title, e.artist, null,
                        modifier = Modifier.graphicsLayer { val s = 1f + 0.02f * lift; scaleX = s; scaleY = s }
                            .then(if (lift > 0.01f) Modifier.dropShadow(RoundedCornerShape(14.dp), Shadow(radius = 30.dp, color = Color.Black.copy(alpha = 0.4f * lift), offset = DpOffset(0.dp, 14.dp)))
                                .background((if (dark) Color(0xE02C2C3A) else Color(0xF2FFFFFF)).copy(alpha = lift), RoundedCornerShape(14.dp)) else Modifier)
                            .pressable(role = Press.Row) { vm.jump(p.index + 1 + i); onClose() },
                    ) {
                        Box(
                            Modifier.size(40.dp, 48.dp).draggableHandle(
                                onDragStarted = { carrying = key(e); from = i; haptics.perform(HapticCue.Lift, fromUser = true) },
                                onDragStopped = {
                                    val to = rows.indexOfFirst { key(it) == carrying }
                                    if (from >= 0 && to >= 0 && to != from) vm.move(p.index + 1 + from, p.index + 1 + to)
                                    carrying = null; from = -1
                                    haptics.perform(HapticCue.Drop, fromUser = true)
                                },
                            ),
                            contentAlignment = Alignment.Center,
                        ) { Icon(MusixIcons.Drag, "Переставить", Modifier.size(18.dp), tint = c.textMuted) }
                    }
                }
            }
        }
        item(key = "foot") {
            Row(Modifier.padding(top = 14.dp, bottom = 22.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(MusixIcons.Sparkles, null, Modifier.size(15.dp), tint = c.textMuted)
                Text("Когда очередь кончится, Автоплейлист продолжит похожим.", style = MusixTheme.text.reading.copy(fontSize = 13.sp, lineHeight = 1.45.em, color = c.textMuted))
            }
        }
    }
}

private fun key(e: ru.musixai.app.core.player.QueueEntry) = "${e.trackId}#${e.index}"

@Composable
private fun Cap(text: String, modifier: Modifier = Modifier) =
    Box(modifier.height(30.dp), contentAlignment = Alignment.CenterStart) { Text(text.uppercase(), style = MusixTheme.text.cap.copy(fontSize = 11.sp, color = MusixTheme.colors.textMuted)) }

@Composable
private fun QueueRow(art: String?, title: String, artist: String, duration: String?, modifier: Modifier = Modifier, titleColor: Color = MusixTheme.colors.text, trailing: @Composable () -> Unit) {
    val c = MusixTheme.colors
    Row(modifier.fillMaxWidth().height(60.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        AsyncImage(art, null, Modifier.padding(start = 2.dp).size(44.dp).clip(RoundedCornerShape(8.dp)), contentScale = ContentScale.Crop)
        Column(Modifier.weight(1f)) {
            Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MusixTheme.text.body.copy(fontSize = 15.sp, fontWeight = FontWeight.Medium, color = titleColor))
            Text(artist, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MusixTheme.text.caption.copy(fontSize = 13.sp, color = c.textMuted))
        }
        if (duration != null) Text(duration, style = MusixTheme.text.number.copy(fontSize = 12.sp, color = c.textMuted))
        trailing()
    }
}

/** Three bars of the playing row; still when the song is paused. */
@Composable
private fun Eq(playing: Boolean, accent: Color) {
    val reduced = rememberReducedMotion()
    Row(Modifier.size(40.dp, 14.dp), horizontalArrangement = Arrangement.spacedBy(2.dp, Alignment.CenterHorizontally), verticalAlignment = Alignment.Bottom) {
        val base = floatArrayOf(0.4f, 1f, 0.65f)
        if (playing && !reduced) {
            val t = rememberInfiniteTransition(label = "eq")
            for (i in 0..2) {
                val h by t.animateFloat(0.25f, 1f, infiniteRepeatable(tween(900, delayMillis = 0), RepeatMode.Reverse, initialStartOffset = androidx.compose.animation.core.StartOffset(300 * i)), label = "eq$i")
                Box(Modifier.width(3.dp).height(14.dp).graphicsLayer { scaleY = h; transformOrigin = androidx.compose.ui.graphics.TransformOrigin(0.5f, 1f) }.background(accent, RoundedCornerShape(1.5.dp)))
            }
        } else for (i in 0..2) Box(Modifier.width(3.dp).height((14 * base[i]).dp).background(accent, RoundedCornerShape(1.5.dp)))
    }
}

/* ================= «Спросить» ================= */

/**
 * No song in the head: the listener came from it. The questions are written large; the chosen one goes up
 * and becomes the listener's line (tinted with the song's accent — round 4). While the answer is made the
 * field rolls up into its round button with the Richbox; one line beside it says what is being done. A tap
 * on the button stops the answer. When it has come, the button unrolls into the field: «Спросить ещё…».
 */
@Composable
internal fun AskSheet(open: Boolean, ui: PlayerUi, vm: PlayerViewModel, askFor: AskFor, accent: Color, onClose: () -> Unit) {
    Sheet(open, onClose, glass = GlassTone.Deep, scrim = 0.36f) {
        SheetHead("Спросить", onClose = onClose)
        Ask(ui, vm, askFor, accent)
    }
}

@Composable
private fun ColumnScope.Ask(ui: PlayerUi, vm: PlayerViewModel, askFor: AskFor, accent: Color) {
    val c = MusixTheme.colors
    val title = ui.player.title ?: ui.context?.track?.title.orEmpty()
    val quote = askFor.quote
    var qs by remember(askFor, ui.player.trackId) {
        mutableStateOf(if (quote != null) listOf("Что здесь имеется в виду?", "Есть ли тут отсылка?", "Как это связано со всей песней?")
        else listOf("Что значит название «$title»?", "О чём эта песня?", "Что послушать после?"))
    }
    var text by remember { mutableStateOf("") }
    var rb by remember { mutableStateOf(RichboxState.Empty) }
    var status by remember { mutableStateOf("") }
    var folded by remember { mutableStateOf(false) }
    var placeholder by remember { mutableStateOf("Спросить о песне…") }
    val busy = ui.chatStage != null
    val scroll = rememberScrollState()
    fun send(q: String) {
        if (busy || q.isBlank()) return
        qs = qs - q
        folded = true; rb = RichboxState.Waiting
        vm.ask(q, quote?.joinToString("\n"))
    }
    // what the model is doing, in one line; the box answers when it is done or stopped
    LaunchedEffect(ui.chatStage) { ui.chatStage?.let { status = it } }
    var wasBusy by remember { mutableStateOf(false) }
    LaunchedEffect(busy) {
        if (busy) { wasBusy = true; return@LaunchedEffect }
        if (!wasBusy) return@LaunchedEffect
        wasBusy = false
        // the song changed under the answer: its conversation is gone, the field just opens again
        if (ui.chat.isEmpty()) { folded = false; status = ""; rb = RichboxState.Empty; placeholder = "Спросить о песне…"; return@LaunchedEffect }
        val stopped = ui.chat.lastOrNull()?.let { !it.first && it.second == STOPPED } == true
        rb = if (stopped) RichboxState.Cancelled else RichboxState.Done
        status = if (stopped) "Остановлено" else "Готово"
        delay(if (stopped) 700 else 520)
        folded = false; status = ""
        delay(300)
        rb = RichboxState.Empty; placeholder = "Спросить ещё…"
    }
    LaunchedEffect(ui.chat.isEmpty()) { if (ui.chat.isEmpty() && !busy) placeholder = "Спросить о песне…" }
    LaunchedEffect(askFor) { askFor.ask?.let { delay(320); send(it) } }
    LaunchedEffect(ui.chat.size, ui.chatStream?.length) { scroll.animateScrollTo(scroll.maxValue) }

    Column(Modifier.weight(1f, fill = false).verticalScroll(scroll).padding(start = 22.dp, end = 22.dp, top = 6.dp, bottom = 12.dp)) {
        if (quote != null) Row(Modifier.padding(top = 14.dp, bottom = 2.dp).heightIn(min = 20.dp)) {
            Box(Modifier.width(2.dp).heightIn(min = 20.dp).height((20 + 22 * quote.size).dp).background(accent))
            Column(Modifier.padding(start = 12.dp, top = 2.dp, bottom = 2.dp)) {
                Text(if (quote.size > 1) "Строчки из текста" else "Строчка из текста", style = MusixTheme.text.caption.copy(fontSize = 12.sp, color = c.textMuted))
                quote.forEach { Text(it, style = MusixTheme.text.reading.copy(fontSize = 15.sp, lineHeight = 1.45.em, fontStyle = FontStyle.Italic, color = c.text)) }
            }
        }
        // the thread: each turn a chapter — the listener's line on the right, the answer in reading text
        val turns = ui.chat.chunkedTurns()
        turns.forEachIndexed { i, (q, a) ->
            if (i > 0) TurnRule(accent, Modifier.padding(top = 16.dp, bottom = 13.dp)) else Spacer(Modifier.height(14.dp))
            AskedLine(q, accent)
            val answer = a ?: (if (i == turns.lastIndex) ui.chatStream else null)
            if (answer != null && answer != STOPPED) Text(answer, Modifier.padding(top = 12.dp), style = MusixTheme.text.reading.copy(fontSize = 15.sp, lineHeight = 1.55.em, color = c.text))
        }
        AnimatedVisibility(qs.isNotEmpty() && !busy && !folded, enter = fadeIn(tween(220)), exit = shrinkVertically(tween(300)) + fadeOut(tween(300))) {
            Column(Modifier.padding(top = 8.dp)) {
                qs.forEach { q ->
                    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).pressable(role = Press.Row) { send(q) }.padding(vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text(q, Modifier.weight(1f), style = MusixTheme.text.heading.copy(fontSize = 19.sp, fontWeight = FontWeight.SemiBold, lineHeight = 1.25.em, letterSpacing = (-0.02).em, color = c.text))
                        Icon(MusixIcons.ArrowUp, null, Modifier.size(18.dp).graphicsLayer { rotationZ = 45f }, tint = c.textMuted)
                    }
                }
            }
        }
    }
    FoldingComposer(text, { text = it }, placeholder, folded = folded, busy = busy, state = rb, status = status,
        onSend = { val q = text; text = ""; send(q) }, onStop = { vm.stopAsk() },
        modifier = Modifier.padding(start = 14.dp, end = 14.dp, top = 8.dp, bottom = 16.dp))
}

internal const val STOPPED = "\u0000stopped"

/** (question, answer?) pairs from the flat (mine, text) chat. */
private fun List<Pair<Boolean, String>>.chunkedTurns(): List<Pair<String, String?>> {
    val out = ArrayList<Pair<String, String?>>()
    for ((mine, t) in this) if (mine) out += t to null else if (out.isNotEmpty() && out.last().second == null) out[out.lastIndex] = out.last().first to t
    return out
}

/* ================= «В плейлист»: the button becomes the panel ================= */

@Composable
internal fun AddMenu(open: Boolean, anchor: Rect?, playlists: List<Playlist>, art: String?, onPick: (Playlist?, String?) -> Unit, onClose: () -> Unit) {
    val c = MusixTheme.colors
    val reduced = rememberReducedMotion()
    val morph = rememberMorph(open, reduced)
    var name by remember { mutableStateOf("") }
    MorphMenu(morph, anchor, onClose, radiusFrom = 24.dp, scrim = 0.3f, radiusTo = 20.dp) {
        Column(Modifier.padding(10.dp)) {
            Text("В ПЛЕЙЛИСТ", Modifier.padding(start = 10.dp, top = 4.dp, bottom = 6.dp), style = MusixTheme.text.cap.copy(fontSize = 11.sp, color = c.textMuted))
            playlists.take(6).forEachIndexed { i, pl ->
                val k = remember(open) { Animatable(if (reduced) 1f else 0f) }
                LaunchedEffect(open) { if (open && !reduced) { delay(110L + i * 30L); k.animateTo(1f, springKcm(260f, 26f)) } }
                Row(Modifier.fillMaxWidth().height(50.dp).clip(RoundedCornerShape(12.dp)).pressable(role = Press.Row) { onPick(pl, null) }
                    .graphicsLayer { alpha = k.value.coerceIn(0f, 1f); translationY = (1f - k.value) * 9.dp.toPx() }.padding(horizontal = 10.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    ru.musixai.app.core.designsystem.content.Cover(null, pl.name, "", size = 34.dp, radius = 8.dp, shadow = false)
                    Text(pl.name, Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis, style = MusixTheme.text.body.copy(fontSize = 15.sp, fontWeight = FontWeight.Medium, color = c.text))
                    Text("${pl.itemCount}", style = MusixTheme.text.number.copy(fontSize = 12.sp, color = c.textMuted))
                }
            }
            Box(Modifier.padding(vertical = 8.dp).fillMaxWidth().height(1.dp).background(c.border))
            Row(Modifier.padding(horizontal = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                BasicTextField(name, { name = it }, Modifier.weight(1f).height(40.dp).clip(RoundedCornerShape(12.dp)).background(c.plate).padding(horizontal = 12.dp),
                    singleLine = true, textStyle = MusixTheme.text.body.copy(fontSize = 14.sp, color = c.text), cursorBrush = SolidColor(c.accent),
                    decorationBox = { inner -> Box(contentAlignment = Alignment.CenterStart, modifier = Modifier.fillMaxWidth().height(40.dp)) { if (name.isEmpty()) Text("Новый плейлист", style = MusixTheme.text.body.copy(fontSize = 14.sp, color = c.textSubtle)); inner() } })
                Pill("Создать", { onPick(null, name.trim().ifEmpty { "Новый плейлист" }); name = "" }, style = PillStyle.Soft)
            }
        }
    }
}
