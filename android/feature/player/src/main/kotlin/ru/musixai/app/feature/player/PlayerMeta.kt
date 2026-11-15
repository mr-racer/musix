package ru.musixai.app.feature.player

import android.content.Context
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.dropShadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.shadow.Shadow
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.layout.BoxWithConstraints
import coil3.compose.AsyncImage
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import ru.musixai.app.core.designsystem.MusixFontFamilies
import ru.musixai.app.core.designsystem.MusixIcons
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.core.designsystem.control.RoundButton
import ru.musixai.app.core.designsystem.control.TextLink
import ru.musixai.app.core.designsystem.gesture.HapticCue
import ru.musixai.app.core.designsystem.gesture.LocalMusixHaptics
import ru.musixai.app.core.designsystem.gesture.Press
import ru.musixai.app.core.designsystem.gesture.pressable
import ru.musixai.app.core.designsystem.surface.GlassTone
import ru.musixai.app.core.designsystem.surface.LiquidGlass
import ru.musixai.app.core.designsystem.surface.glassInk
import ru.musixai.app.core.designsystem.surface.liquidGlass
import ru.musixai.app.core.designsystem.surface.LocalToasts
import ru.musixai.app.core.designsystem.text
import ru.musixai.app.core.model.TrackSound
import ru.musixai.app.core.player.PlayerState
import ru.musixai.app.core.player.QueueMode

/* ================= the title block ================= */

internal val SCALE = mapOf("tech" to "Техничность", "space" to "Простор", "odd" to "Необычность")
private val MEAN = mapOf("tech" to "сколько труда в звуке: слои, обработка, игра.", "space" to "насколько звук вокруг тебя, а не в одной точке.", "odd" to "насколько песня звучит непривычно.")
private val FACET = mapOf("layers" to "много слоёв", "sound_work" to "много обработки", "playing" to "непростая игра", "development" to "музыка развивается", "width" to "широкая стереосцена",
    "spread" to "инструменты разведены по сторонам", "echo" to "много эха", "sounds" to "непривычные звуки", "mix_extremes" to "резкое сведение", "form" to "необычное построение", "style" to "экспериментальный стиль")

/** The sound in two sentences: the pulse, then the room (the mock's `character()`). Bold parts are the facts. */
internal fun character(s: TrackSound, strong: SpanStyle): AnnotatedString = buildAnnotatedString {
    val pace = s.pace?.key
    val feel = s.feel?.key
    val drums = when (s.drums?.key) { "live" -> "на живых барабанах"; "machine" -> "на драм-машине"; else -> null }
    fun b(t: String) = withStyle(strong) { append(t) }
    when {
        feel == "free" || feel == "no_pulse" -> { b(if (feel == "free") "Свободный ритм" else "Без чёткого ритма"); append(", без ударной сетки.") }
        pace != null -> {
            val word = mapOf("slow" to "Медленный", "unhurried" to "Неспешный", "medium" to "Ровный", "brisk" to "Бодрый", "fast" to "Быстрый")[pace] ?: s.pace!!.label
            val how = when (feel) { "driving" -> "напористый"; "swinging" -> "качающий"; else -> null }
            b(if (how != null) "$word, $how" else word); append(" ритм")
            if (drums != null) { append(" "); b(drums) }
            append(".")
        }
        drums != null -> { append("Ритм "); b(drums); append(".") }
    }
    val echo = mapOf("dry" to "Сухой звук, близко к уху", "little" to "Немного эха", "noticeable" to "Заметное эхо", "hall" to "Много эха, как в зале")[s.echo?.key]
    val width = mapOf("narrow" to "узкая, почти моно сцена", "medium" to "сцена средней ширины", "wide" to "широкая сцена", "very_wide" to "сцена от уха до уха")[s.width?.key]
    if (echo != null || width != null) {
        if (length > 0) append(" ")
        if (echo != null) b(echo)
        if (echo != null && width != null) append(", ")
        if (width != null) b(width)
        append(".")
    }
}

/** A picked scale explained: what it measures, and what of it is here. */
internal fun scaleMeaning(s: TrackSound, key: String, hue: Color): AnnotatedString = buildAnnotatedString {
    withStyle(SpanStyle(fontStyle = FontStyle.Normal, color = hue)) { append(SCALE[key] ?: key) }
    append(" — ${MEAN[key]}")
    val f = s.ratings.facets[key].orEmpty().filter { it.value >= 40 }.entries.sortedByDescending { it.value }.take(2).map { FACET[it.key] ?: it.key }
    if (f.isNotEmpty()) append(" Здесь: ${f.joinToString(" и ")}.")
}

@Composable
internal fun Meta(ui: PlayerUi, side: Side, sound: TrackSound?, scaleKey: String?, lines: Int, accent: Color, onArtist: () -> Unit, onAlbum: () -> Unit, onMore: () -> Unit, modifier: Modifier) {
    val c = MusixTheme.colors
    val p = ui.player
    val ctx = ui.context
    val title = p.title ?: ctx?.track?.title.orEmpty()
    // a song arrives: its title, links and phrase rise one after another (120, 165, 210 ms)
    Column(modifier.fillMaxWidth()) {
        AnimatedContent(p.trackId, transitionSpec = { rise(0) }, label = "title") { _ ->
            val long = title.length > 16
            Text(title, maxLines = 2, overflow = TextOverflow.Ellipsis,
                style = MusixTheme.text.title.copy(fontSize = if (long) 25.sp else 34.sp, lineHeight = if (long) 1.06.em else 1.02.em, letterSpacing = (-0.035).em, color = c.text))
        }
        AnimatedContent(p.trackId, transitionSpec = { rise(45) }, label = "links") { _ ->
            Column(Modifier.padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                TextLink(p.artist ?: ctx?.track?.artist.orEmpty(), onArtist, style = MusixTheme.text.body.copy(fontSize = 16.sp, fontWeight = FontWeight.Medium), primary = true)
                val album = ctx?.track?.album
                if (album != null) TextLink(album + (ctx.track.year?.let { " · $it" } ?: ""), onAlbum, style = MusixTheme.text.caption.copy(fontSize = 13.sp), color = c.textMuted, primary = true)
            }
        }
        // the phrase: the song's story on the cover and the words, the sound's character on the sound
        val titleLines = if (title.length > 16 && title.length > 26) 2 else if (title.length > 16) 1 else 1
        // (the stream's «похоже на …» line is gone, the owner 2026-11-15: it pushed the line and the
        // controls down and did not fit the scene)
        val keep = (lines - (if (titleLines > 1) 1 else 0)).coerceAtLeast(1)
        // the slot is at least [lines] lines of 15 sp (the screen's geometry keeps that room) and takes the air
        // down to the line as well: a long phrase fits there, what follows never moves or squeezes
        Box(Modifier.padding(top = 10.dp).fillMaxWidth().weight(1f, fill = true).heightIn(min = with(LocalDensity.current) { PHRASE_SP.sp.toDp() * PHRASE_LH * lines })) {
            AnimatedContent(Triple(p.trackId, side == Side.Sound, scaleKey), transitionSpec = { rise(90) }, label = "slot") { (_, onSound, pick) ->
                if (onSound && sound != null) {
                    // the named things stand out by colour, not weight (the owner: «обычным, без жирнения»)
                    val strong = SpanStyle(color = c.text)
                    val hue = when (pick) { "tech" -> c.soundTech; "space" -> c.soundSpace; else -> c.soundOdd }
                    Text(if (pick != null) scaleMeaning(sound, pick, hue) else character(sound, strong), maxLines = keep, overflow = TextOverflow.Ellipsis,
                        style = MusixTheme.text.reading.copy(fontSize = 15.sp, lineHeight = 1.45.em, color = c.textMuted, letterSpacing = 0.em))
                } else Phrase(ctx?.vibe ?: "Истории об этой песне ещё собираются.", keep, onMore)
            }
        }
    }
}

private fun rise(delayMs: Int) =
    (fadeIn(tween(320, delayMillis = 120 + delayMs)) + slideInVertically(springKcm(300f, 26f)) { it / 6 }) togetherWith fadeOut(tween(120))

private const val PHRASE_SP = 15f
private const val PHRASE_LH = 1.45f
private const val PHRASE_MIN_SP = 12f

/**
 * The phrase in the room it is given (its slot: [lines] lines of 15 sp and the air under them), «ещё ›» right
 * after its last word. A longer phrase steps its size down by half a point (to 12 sp, the lines a little
 * tighter) and takes as many lines as the room holds (the owner 2026-11-15: a long fact must fit, the parts
 * below must not squeeze). Only what still does not fit at 12 sp waits in «О песне».
 */
@Composable
private fun Phrase(text: String, lines: Int, onMore: () -> Unit) {
    val c = MusixTheme.colors
    val measurer = rememberTextMeasurer(8)
    val style = MusixTheme.text.reading.copy(fontSize = PHRASE_SP.sp, lineHeight = PHRASE_LH.em, fontStyle = FontStyle.Italic, color = c.textMuted, letterSpacing = 0.em)
    val more = SpanStyle(fontFamily = MusixFontFamilies.Geist, fontStyle = FontStyle.Normal, fontWeight = FontWeight.Medium, fontSize = 14.sp, color = c.text)
    val density = LocalDensity.current
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val w = constraints.maxWidth
        val room = if (constraints.hasBoundedHeight) constraints.maxHeight.toFloat() else with(density) { PHRASE_SP.sp.toPx() } * PHRASE_LH * lines
        val shown = remember(text, lines, w, room, style, density) { fitShrinking(measurer, text, room, w, style, more, density) }
        Text(shown.first, Modifier.pressable(role = Press.Row) { onMore() }, style = shown.second)
    }
}

/** The largest size, from 15 sp down to 12, at which the whole phrase fits [room] px; at 12 the words are cut. */
private fun fitShrinking(m: TextMeasurer, text: String, room: Float, w: Int, style: TextStyle, more: SpanStyle, density: Density): Pair<AnnotatedString, TextStyle> {
    var size = PHRASE_SP
    while (true) {
        // the line height eases from 1.45 at 15 sp to 1.35 at 12: small italic reads well a little tighter
        val lh = PHRASE_LH - 0.1f * (PHRASE_SP - size) / (PHRASE_SP - PHRASE_MIN_SP)
        val s = style.copy(fontSize = size.sp, lineHeight = lh.em)
        val mo = more.copy(fontSize = (size - 1f).sp)
        val n = maxOf(1, (room / (with(density) { size.sp.toPx() } * lh) + 0.001f).toInt())
        val whole = withMore(text, mo)
        if (m.measure(whole, s, constraints = Constraints(maxWidth = w)).lineCount <= n) return whole to s
        if (size <= PHRASE_MIN_SP) return fit(m, text, n, w, s, mo) to s
        size -= 0.5f
    }
}

private fun withMore(body: String, more: SpanStyle) = buildAnnotatedString {
    append(body); append(" ")
    withStyle(more) { append("ещё ›") }
}

private fun fit(m: TextMeasurer, text: String, lines: Int, w: Int, style: TextStyle, more: SpanStyle): AnnotatedString {
    fun ok(s: AnnotatedString) = m.measure(s, style, constraints = Constraints(maxWidth = w)).lineCount <= lines
    val whole = withMore(text, more)
    if (ok(whole)) return whole
    val words = text.split(' ')
    var lo = 1; var hi = words.size
    while (lo < hi) {
        val mid = (lo + hi + 1) / 2
        if (ok(withMore(words.take(mid).joinToString(" ") + "…", more))) lo = mid else hi = mid - 1
    }
    return withMore(words.take(lo).joinToString(" ").trimEnd(',', '.', ';', ':', '—', '-') + "…", more)
}

/* ================= «Далее»: the queue's edge above the actions ================= */

@Composable
internal fun Tray(p: PlayerState, onOpen: () -> Unit, modifier: Modifier) {
    val c = MusixTheme.colors
    val haptics = LocalMusixHaptics.current
    val up = (1..3).mapNotNull { p.queue.getOrNull(p.index + it) }
    val left = (p.queue.size - p.index - 1).coerceAtLeast(0)
    var held by remember { mutableStateOf(false) }
    val press by animateFloatAsState(if (held) 1f else 0f, springKcm(420f, 30f), label = "tray")
    val ring = MusixTheme.colors.bg
    Box(
        // at least 46 dp: a large system font grows it instead of spilling onto the buttons
        modifier.fillMaxWidth().padding(horizontal = 24.dp).padding(top = 4.dp).heightIn(min = 46.dp).pointerInput(Unit) {
            // a tap opens the queue; a pull up opens it after the finger
            awaitEachGesture {
                val down = awaitFirstDown()
                held = true
                val tracker = VelocityTracker()
                var opened = false
                while (true) {
                    val ev = awaitPointerEvent()
                    val ch = ev.changes.firstOrNull { it.id == down.id } ?: break
                    tracker.addPosition(ch.uptimeMillis, ch.position)
                    if (!ch.pressed) break
                    val dy = ch.position.y - down.position.y
                    if (!opened && dy < -24.dp.toPx()) { opened = true; ch.consume(); haptics.perform(HapticCue.Threshold, fromUser = true); onOpen() }
                }
                held = false
                if (!opened && tracker.calculateVelocity().y > -600f) onOpen()
            }
        },
    ) {
        Row(Modifier.fillMaxWidth().align(Alignment.Center).graphicsLayer { val k = 1f - 0.015f * press; scaleX = k; scaleY = k }, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            // the next three, one under the other
            Box(Modifier.width(if (up.isEmpty()) 0.dp else (36 + (up.size - 1) * (11 + (4 * press).toInt())).dp).height(36.dp)) {
                up.asReversed().forEachIndexed { ri, e ->
                    val i = up.size - 1 - ri
                    val s = when (i) { 0 -> 1f + 0.04f * press; 1 -> 0.92f; else -> 0.84f }
                    AsyncImage(e.artUri, null, Modifier.offset(x = (i * (11 + 4 * press)).dp, y = if (i == 0) (-3 * press).dp else 0.dp).size(36.dp)
                        .graphicsLayer { scaleX = s; scaleY = s }
                        .dropShadow(RoundedCornerShape(9.dp), Shadow(radius = 12.dp, color = Color.Black.copy(alpha = if (MusixTheme.isDark) 0.35f else 0.2f), offset = DpOffset(0.dp, 6.dp)))
                        .background(ring, RoundedCornerShape(11.dp)).padding(2.dp).clip(RoundedCornerShape(9.dp)), contentScale = ContentScale.Crop)
                }
            }
            Column(Modifier.weight(1f)) {
                Text("Далее", style = MusixTheme.text.caption.copy(fontSize = 12.sp, color = c.textSubtle))
                Text(up.firstOrNull()?.let { "${it.title} · ${it.artist}" } ?: "Дальше — похожее, по Автоплейлисту", maxLines = 1, overflow = TextOverflow.Ellipsis,
                    style = MusixTheme.text.body.copy(fontSize = 15.sp, fontWeight = FontWeight.Medium, color = c.text))
            }
            if (left > 0) Text("$left", style = MusixTheme.text.number.copy(fontSize = 12.sp, color = c.textSubtle))
            Icon(MusixIcons.ChevronDown, null, Modifier.offset(x = (-4).dp).size(18.dp).graphicsLayer { rotationZ = 180f }, tint = c.textSubtle)
        }
    }
}

/* ================= огонёк, вода, вперемешку, в плейлист — and «Спросить» ================= */

@Composable
internal fun Actions(ui: PlayerUi, vm: PlayerViewModel, accent: Color, bursts: Bursts, side: Side, onAsk: () -> Unit, onAdd: (androidx.compose.ui.geometry.Rect) -> Unit, added: Boolean, modifier: Modifier) {
    val c = MusixTheme.colors
    val dark = MusixTheme.isDark
    val p = ui.player
    val haptics = LocalMusixHaptics.current
    val toasts = LocalToasts.current
    val fire = if (dark) oklchColor(0.74f, 0.17f, 55f) else oklchColor(0.58f, 0.19f, 48f)
    val water = if (dark) oklchColor(0.74f, 0.13f, 235f) else oklchColor(0.52f, 0.15f, 245f)
    var addAt by remember { mutableStateOf(androidx.compose.ui.geometry.Rect.Zero) }
    Row(modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, bottom = 22.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
        Row {
            RoundButton(if (p.taste == "fire") MusixIcons.FireFilled else MusixIcons.Fire, "Огонёк", {
                val on = p.taste != "fire"
                vm.react("fire"); if (on && side != Side.Text) bursts.play(BurstKind.Fire)
            }, on = p.taste == "fire", toggle = true, accent = fire, filled = false)
            RoundButton(if (p.taste == "water") MusixIcons.WaterFilled else MusixIcons.Water, "Вода", {
                val on = p.taste != "water"
                vm.react("water"); if (on && side != Side.Text) bursts.play(BurstKind.Water)
            }, on = p.taste == "water", toggle = true, accent = water, filled = false)
            RoundButton(MusixIcons.Shuffle, "Вперемешку", {
                if (p.mode == QueueMode.STREAM) { haptics.perform(HapticCue.Reject, fromUser = true); toasts?.show("В Потоке порядок выбирает волна") }
                else vm.shuffle()
            }, on = p.shuffle, toggle = p.mode != QueueMode.STREAM, accent = accent, filled = false)
            Box(Modifier.onGloballyPositioned { addAt = it.boundsInRoot() }) {
                RoundButton(if (added) MusixIcons.Check else MusixIcons.Plus, if (added) "В плейлисте" else "В плейлист", { onAdd(addAt) }, on = added, accent = accent, filled = false)
            }
        }
        Row(
            // on glass, as the sheet it opens (the owner, 2026-11-15: the glass onto more surfaces)
            Modifier.padding(end = 12.dp).height(40.dp).liquidGlass(CircleShape, GlassTone.Chip, shadow = false).clip(CircleShape).pressable(role = Press.Chip) { onAsk() }.padding(horizontal = 16.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp),
        ) {
            Icon(MusixIcons.Sparkles, null, Modifier.size(18.dp), tint = glassInk())
            Text("Спросить", style = MusixTheme.text.label.copy(fontSize = 14.sp, color = glassInk()))
        }
    }
}

/** oklch → sRGB, for the reaction hues the mock writes in oklch. */
internal fun oklchColor(l: Float, c: Float, h: Float): Color = ru.musixai.app.core.designsystem.oklch(l * 100f, c, h)

/* ================= the hint of the first visit, and one-time tips ================= */

@Stable
internal class Hint(private val prefs: android.content.SharedPreferences) {
    var text by mutableStateOf("")
    var shown by mutableStateOf(false)
    private var job: kotlinx.coroutines.Job? = null
    lateinit var scope: kotlinx.coroutines.CoroutineScope

    /** The first time the player opens: the hint, and a nudge of the stage after 0.9 s. */
    fun firstVisit(nudge: () -> Unit) {
        if (prefs.getBoolean("mx-player-hint", false)) return
        job?.cancel()
        job = scope.launch {
            delay(900)
            text = "Коснись — пауза · смахни — другая песня"; shown = true
            nudge()
            delay(5200); shown = false
        }
    }

    /** A one-time line on the stage for something that has no button. */
    fun tip(key: String, line: String) {
        if (prefs.getBoolean(key, false)) return
        prefs.edit().putBoolean(key, true).apply()
        job?.cancel()
        job = scope.launch { delay(700); text = line; shown = true; delay(4200); shown = false }
    }

    fun hide(forGood: Boolean) {
        job?.cancel(); shown = false
        if (forGood) prefs.edit().putBoolean("mx-player-hint", true).apply()
    }
}

@Composable
internal fun rememberHint(): Hint {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    return remember { Hint(ctx.getSharedPreferences("player", Context.MODE_PRIVATE)).also { it.scope = scope } }
}

@Composable
internal fun HintPill(hint: Hint, modifier: Modifier) {
    val k by animateFloatAsState(if (hint.shown) 1f else 0f, springKcm(300f, 24f), label = "hint")
    if (k < 0.01f && !hint.shown) return
    LiquidGlass(modifier.graphicsLayer { alpha = k.coerceIn(0f, 1f); translationY = (1f - k) * 10.dp.toPx(); val s = 0.96f + 0.04f * k; scaleX = s; scaleY = s }, radius = 999.dp, tone = GlassTone.Label) {
        Text(hint.text, Modifier.padding(horizontal = 16.dp, vertical = 9.dp), maxLines = 1, style = MusixTheme.text.label.copy(fontSize = 13.sp, color = glassInk()))
    }
}
