package ru.musixai.app.feature.quiz

import androidx.activity.compose.BackHandler
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.dropShadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.shadow.Shadow
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import ru.musixai.app.core.data.QuizAnswer
import ru.musixai.app.core.data.QuizMode
import ru.musixai.app.core.data.QuizRepository
import ru.musixai.app.core.data.QuizRound
import ru.musixai.app.core.designsystem.MusixFontFamilies
import ru.musixai.app.core.designsystem.MusixIcons
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.core.designsystem.component.Arrive
import ru.musixai.app.core.designsystem.component.Cover
import ru.musixai.app.core.designsystem.component.CtaButton
import ru.musixai.app.core.designsystem.component.Spinner
import ru.musixai.app.core.designsystem.component.pressable
import ru.musixai.app.core.designsystem.component.rise
import ru.musixai.app.core.designsystem.component.skeButton
import ru.musixai.app.core.designsystem.component.skeInset
import ru.musixai.app.core.designsystem.oklch
import ru.musixai.app.core.player.PlayerController
import javax.inject.Inject

/** `playing`: null, "round" or an option id — which snippet is sounding; `playSeq` restarts the drain. */
data class QuizUi(val modes: List<QuizMode> = emptyList(), val round: QuizRound? = null, val answer: QuizAnswer? = null, val picked: String? = null,
    val busy: Boolean = false, val error: String? = null, val playing: String? = null, val playSeq: Int = 0, val year: Int? = null)

@HiltViewModel
class QuizViewModel @Inject constructor(private val repo: QuizRepository, private val player: PlayerController) : ViewModel() {
    private val _ui = MutableStateFlow(QuizUi())
    val ui: StateFlow<QuizUi> = _ui
    private var playing: Job? = null

    init { viewModelScope.launch { _ui.update { it.copy(modes = runCatching { repo.modes() }.getOrDefault(emptyList())) } } }

    fun start(mode: String) = viewModelScope.launch {
        stop()
        _ui.update { it.copy(busy = true, error = null) }
        val r = runCatching { repo.round(mode) }
        _ui.update {
            it.copy(busy = false, round = r.getOrNull() ?: it.round, answer = if (r.isSuccess) null else it.answer, picked = if (r.isSuccess) null else it.picked,
                year = r.getOrNull()?.let { x -> val lo = x.yearMin; val hi = x.yearMax; if (lo != null && hi != null) (lo + hi) / 2 else null },
                error = r.exceptionOrNull()?.let { "В этом режиме пока мало материала" })
        }
        r.getOrNull()?.audioUrl?.let { replay() }
    }

    /** Through the player core in its no-listen mode (quiz invariant I-2). */
    fun replay() { _ui.value.round?.let { r -> r.audioUrl?.let { sound("round", it) } } }
    fun optionAudio(id: String, url: String) = sound(id, url)
    fun stop() { if (_ui.value.playing != null) player.stopSnippet(); playing?.cancel(); _ui.update { it.copy(playing = null) } }

    private fun sound(key: String, url: String) {
        val ms = ((_ui.value.round?.lengthSec ?: 3.0) * 1000).toLong()
        player.snippet(url, ms)
        playing?.cancel()
        _ui.update { it.copy(playing = key, playSeq = it.playSeq + 1) }
        playing = viewModelScope.launch { delay(ms + 200); _ui.update { it.copy(playing = null) } }
    }

    fun year(y: Int) = _ui.update { if (it.answer == null) it.copy(year = y) else it }

    fun answer(optionId: String?) = viewModelScope.launch {
        val r = _ui.value.round ?: return@launch
        if (_ui.value.answer != null || _ui.value.busy) return@launch
        stop()
        _ui.update { it.copy(picked = optionId, busy = true) }
        val a = runCatching { repo.answer(r.id, optionId, if (optionId == null) _ui.value.year else null) }.getOrNull()
        _ui.update { it.copy(answer = a, busy = false) }
    }

    /** «Слушать целиком»: the round's track, as an ordinary listen now that it is answered. */
    fun playTruth() { _ui.value.answer?.truthTrackId?.let { player.playTracks(listOf(it), 0, "queue") } }

    fun back() { stop(); _ui.update { it.copy(round = null, answer = null, picked = null) } }
}

/** v1 `quizModeCopy` + the one hue per mode (`--qh`) everything in a round derives from. */
private data class ModeInfo(val name: String, val ask: String, val hue: Float)

private val MODES = mapOf(
    "track_snippet" to ModeInfo("Что играет", "Три секунды из твоей фонотеки. Узнаешь?", 270f),
    "producer" to ModeInfo("Почерк продюсера", "Три трека сделал один человек. Найди чужой.", 75f),
    "blind_year" to ModeInfo("Слепой год", "В каком году это записали?", 215f),
    "lineage" to ModeInfo("Родословная", "На чём вырос этот трек?", 335f),
)

private fun hueOf(mode: String?) = MODES[mode]?.hue ?: 270f

/**
 * v1 `QuizSection` («Викторина», golden quiz-*-phone): the mode cards, then a round. Every
 * motion here is single-shot, as in v1: the drain bar of a playing snippet, the key's three
 * rings, the hit (a swell and a green ring) or miss (a shake) on the key you pressed, the
 * others receding, and the reveal blooming in with the cover. Nothing loops.
 */
@Composable
fun QuizRoute(vm: QuizViewModel = hiltViewModel()) {
    val ui by vm.ui.collectAsStateWithLifecycle()
    val c = MusixTheme.colors
    val dark = MusixTheme.isDark
    val r = ui.round
    BackHandler(r != null) { vm.back() }
    val hue by animateFloatAsState(hueOf(r?.mode), tween(600), label = "qh")
    Box(Modifier.fillMaxSize().background(c.bg)) {
        // .quiz-wash: one soft gradient in the mode's hue, behind everything
        Canvas(Modifier.fillMaxWidth().height(460.dp)) {
            val k = size.height / (size.width * 0.58f)
            val ctr = Offset(size.width / 2, 0f)
            scale(1f, k, ctr) {
                drawRect(Brush.radialGradient(0f to oklch(62f, 0.15f, hue, if (dark) 0.20f else 0.13f), 0.72f to Color.Transparent, 1f to Color.Transparent,
                    center = ctr, radius = size.width * 0.58f), size = androidx.compose.ui.geometry.Size(size.width, size.height / k))
            }
        }
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).statusBarsPadding().padding(start = 22.dp, end = 22.dp, top = 40.dp, bottom = 120.dp),  // clear of the mini player
            horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(22.dp)) {
            val info = MODES[r?.mode]
            Column(Modifier.padding(top = if (r == null) 110.dp else 8.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Text(if (r != null) info?.name ?: r.mode else "Викторина", textAlign = TextAlign.Center,
                    style = MusixTheme.type.title.copy(fontFamily = MusixFontFamilies.Playfair, fontSize = if (r == null) 38.sp else 30.sp, fontWeight = FontWeight.Normal, lineHeight = 1.15.em, color = c.text))
                Text(if (r != null) info?.ask.orEmpty() else "Игра по твоей собственной фонотеке.", Modifier.padding(top = 8.dp), textAlign = TextAlign.Center,
                    style = MusixTheme.type.body.copy(fontSize = if (r == null) 15.sp else 13.5.sp, lineHeight = 1.5.em, color = c.textMuted))
            }
            if (r == null) {
                ui.error?.let { Text(it, style = MusixTheme.type.body.copy(fontSize = 13.sp, color = c.textMuted), textAlign = TextAlign.Center) }
                val keys = ui.modes.map { it.key }.ifEmpty { MODES.keys.toList() }
                Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    for (k in keys) {
                        val m = MODES[k] ?: ModeInfo(k, "", 270f)
                        ModeCard(m, ui.modes.firstOrNull { it.key == k }?.available ?: true) { vm.start(k) }
                    }
                }
                if (ui.busy) Spinner(22.dp)
            } else Round(ui, r, vm, hue)
        }
    }
}

@Composable
private fun ModeCard(m: ModeInfo, available: Boolean, onClick: () -> Unit) {
    val c = MusixTheme.colors
    val shape = RoundedCornerShape(24.dp)
    Column(Modifier.fillMaxWidth().graphicsLayer { alpha = if (available) 1f else 0.38f }.clip(shape)
        .background(Brush.verticalGradient(if (MusixTheme.isDark) listOf(Color(0xFF1B1B20), Color(0xFF141418)) else listOf(Color.White, Color(0xFFF7F6FA))))
        .border(1.dp, c.border, shape).pressable(available, onClick)) {
        // .quiz-mode::before: the mode's colour as a hairline on the top edge
        Box(Modifier.padding(horizontal = 18.dp).fillMaxWidth().height(2.dp)
            .background(Brush.horizontalGradient(listOf(oklch(66f, 0.16f, m.hue, 0.85f), oklch(66f, 0.16f, m.hue, 0f)))))
        Column(Modifier.padding(horizontal = 18.dp, vertical = 20.dp)) {
            Text(m.name, style = MusixTheme.type.body.copy(fontSize = 17.sp, fontWeight = FontWeight.Bold, color = c.text))
            Text(if (available) m.ask else "Пока мало данных — режим откроется, когда наберётся материал.", Modifier.padding(top = 8.dp),
                style = MusixTheme.type.body.copy(fontSize = 14.sp, lineHeight = 1.45.em, color = c.textMuted))
        }
    }
}

@Composable
private fun Round(ui: QuizUi, r: QuizRound, vm: QuizViewModel, hue: Float) {
    val c = MusixTheme.colors
    val accent = oklch(66f, 0.16f, hue)
    val a = ui.answer
    if (r.audioUrl != null) SnippetWell(ui, r, vm, accent)
    r.prompt?.let { p ->
        Row(Modifier.fillMaxWidth().skeInset(RoundedCornerShape(18.dp)).padding(horizontal = 16.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            Cover(p.cover, p.title, p.artist, size = 52.dp)
            Column(Modifier.weight(1f)) {
                Text("ЭТОТ ТРЕК", style = MusixTheme.type.mono.copy(fontSize = 9.5.sp, letterSpacing = 0.18.em, color = c.textSubtle))
                Text(p.title, Modifier.padding(top = 4.dp), maxLines = 1, overflow = TextOverflow.Ellipsis, style = MusixTheme.type.body.copy(fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = c.text))
                Text(p.artist, Modifier.padding(top = 2.dp), maxLines = 1, overflow = TextOverflow.Ellipsis, style = MusixTheme.type.body.copy(fontSize = 12.5.sp, color = c.textMuted))
            }
        }
    }
    val lo = r.yearMin; val hi = r.yearMax
    if (r.inputKind == "year" && lo != null && hi != null) {
        Column(Modifier.fillMaxWidth().skeInset(RoundedCornerShape(20.dp)).padding(start = 22.dp, end = 22.dp, top = 22.dp, bottom = 26.dp),
            horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
            // the year is this mode's expressive moment: the display face, the size to match
            Text(ui.year?.toString() ?: "—", style = MusixTheme.type.title.copy(fontFamily = MusixFontFamilies.Playfair, fontSize = 44.sp, lineHeight = 1.em,
                color = if (a != null) c.textMuted else accent))
            SkeRange(ui.year ?: lo, lo, hi, enabled = a == null && !ui.busy, accent = oklch(62f, 0.17f, hue), onChange = vm::year)
            if (a == null) CtaButton("Ответить", { vm.answer(null) }, enabled = !ui.busy)
        }
    } else Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        for (o in r.options) {
            val isAnswer = a != null && o.id == a.correctOptionId
            val picked = o.id == ui.picked
            OptionRow(o, isAnswer, picked, dim = a != null && !isAnswer && !picked, answered = a != null, hit = a?.correct == true,
                cover = o.cover ?: if (isAnswer && r.mode == "track_snippet") a?.truthCover else null, bloomCover = o.cover == null,
                playingHere = ui.playing == o.id, playSeq = ui.playSeq, accent = accent,
                onPlay = o.audioUrl?.let { u -> { if (ui.playing == o.id) vm.stop() else vm.optionAudio(o.id, u) } },
                onPick = { vm.answer(o.id) })
        }
    }
    a?.let { Reveal(it, r, ui.year, accent, vm) }
    Text("Сменить режим", Modifier.pressable(onClick = vm::back).padding(horizontal = 10.dp, vertical = 6.dp),
        style = MusixTheme.type.body.copy(fontSize = 12.sp, color = c.textSubtle))
}

/** The snippet well: the play key (three rings while it sounds) and the drain bar, the only clock on screen. */
@Composable
private fun SnippetWell(ui: QuizUi, r: QuizRound, vm: QuizViewModel, accent: Color) {
    val c = MusixTheme.colors
    val dark = MusixTheme.isDark
    val on = ui.playing == "round"
    val done = ui.answer != null
    Column(Modifier.fillMaxWidth().skeInset(RoundedCornerShape(20.dp)).padding(start = 22.dp, end = 22.dp, top = 26.dp, bottom = 22.dp),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(18.dp)) {
        Box(contentAlignment = Alignment.Center) {
            LiveRings(on, ui.playSeq, CircleShape, 66.dp)
            Box(Modifier.size(66.dp).graphicsLayer { alpha = if (done) 0.4f else 1f }.skeButton(33.dp)
                .pressable(!done) { if (on) vm.stop() else vm.replay() }, contentAlignment = Alignment.Center) {
                Icon(if (on) MusixIcons.Pause else MusixIcons.Play, if (on) "Остановить" else "Слушать отрывок", Modifier.size(22.dp), tint = if (done) c.textMuted else accent)
            }
        }
        Box(Modifier.widthIn(max = 300.dp).fillMaxWidth().height(3.dp).clip(RoundedCornerShape(99.dp))
            .background(if (dark) Color(0x12FFFFFF) else Color(0x14000000))) {
            if (on) key(ui.playSeq) {
                val t = remember { Animatable(1f) }
                LaunchedEffect(Unit) { t.animateTo(0f, tween((r.lengthSec * 1000).toInt(), easing = LinearEasing)) }
                Box(Modifier.fillMaxHeight().fillMaxWidth(t.value).background(accent, RoundedCornerShape(99.dp)))
            }
        }
        Text(if (!done && !on) "Можно послушать ещё раз" else "", Modifier.height(13.dp),
            style = MusixTheme.type.mono.copy(fontSize = 10.sp, letterSpacing = 0.14.em, color = c.textSubtle))
    }
}

/** `.quiz-live::after`: one soft ring out of the key, three beats, then still. */
@Composable
private fun LiveRings(on: Boolean, seq: Int, shape: androidx.compose.ui.graphics.Shape, size: androidx.compose.ui.unit.Dp) {
    if (!on) return
    key(seq) {
        val t = remember { Animatable(0f) }
        LaunchedEffect(Unit) { t.animateTo(3f, tween(3000, easing = LinearEasing)) }
        val k = t.value % 1f
        if (t.value < 3f) Box(Modifier.size(size).dropShadow(shape, Shadow(radius = 1.dp, spread = (14 * k).dp, color = oklch(60f, 0.18f, 270f, 0.45f * (1f - k)))))
    }
}

@Composable
private fun OptionRow(
    o: ru.musixai.app.core.data.QuizOption, isAnswer: Boolean, picked: Boolean, dim: Boolean, answered: Boolean, hit: Boolean,
    cover: ru.musixai.app.core.model.Image?, bloomCover: Boolean, playingHere: Boolean, playSeq: Int, accent: Color,
    onPlay: (() -> Unit)?, onPick: () -> Unit,
) {
    val c = MusixTheme.colors
    val shape = RoundedCornerShape(15.dp)
    // the feedback rides the row of the key actually pressed: a hit swells once and rings, a miss shakes
    val fx = remember { Animatable(0f) }
    LaunchedEffect(answered && picked) {
        if (answered && picked) fx.animateTo(1f, if (isAnswer) tween(500, easing = Arrive) else tween(420))
    }
    val dimK by animateFloatAsState(if (dim) 1f else 0f, tween(180), label = "dim")
    Box {
        if (answered && picked && isAnswer) {
            val k = fx.value  // .quiz-hit::after: a green ring out to 12 dp over 600 ms
            Box(Modifier.matchParentSize().dropShadow(shape, Shadow(radius = 1.dp, spread = (12 * k).dp, color = oklch(63f, 0.17f, 142f, 0.5f * (1f - k)))))
        }
        Row(Modifier.fillMaxWidth().graphicsLayer {
            val k = fx.value
            if (answered && picked) {
                if (isAnswer) { val s = 1f + 0.028f * hitCurve(k); scaleX = s; scaleY = s }
                else translationX = shake(k) * density
            }
            alpha = 1f - 0.62f * dimK
        }, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            onPlay?.let { play ->
                Box(contentAlignment = Alignment.Center) {
                    LiveRings(playingHere, playSeq, shape, 46.dp)
                    Box(Modifier.width(46.dp).height(62.dp).skeButton(15.dp).pressable(onClick = play), contentAlignment = Alignment.Center) {
                        Icon(if (playingHere) MusixIcons.Pause else MusixIcons.Play, if (playingHere) "Остановить" else "Слушать ${o.title}", Modifier.size(18.dp), tint = accent)
                    }
                }
            }
            val verdict = when { isAnswer -> c.greenBg; answered && picked -> c.redBg; else -> null }
            Row(Modifier.weight(1f).height(62.dp).skeButton(15.dp).clip(shape)
                .then(if (verdict != null) Modifier.background(Brush.verticalGradient(listOf(verdict, Color.Transparent))) else Modifier)
                .pressable(!answered, onPick).padding(horizontal = 14.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                if (cover != null) Box(if (bloomCover) Modifier.rise(distance = 8.dp, scaleFrom = 0.94f, durationMs = 420) else Modifier) {
                    Cover(cover, o.title, o.artist, size = 40.dp)
                }
                Column(Modifier.weight(1f)) {
                    Text(o.title, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MusixTheme.type.body.copy(fontSize = 14.5.sp, fontWeight = FontWeight.SemiBold, lineHeight = 1.3.em, color = c.text))
                    if (o.artist.isNotBlank()) Text(o.artist, Modifier.padding(top = 3.dp), maxLines = 1, overflow = TextOverflow.Ellipsis, style = MusixTheme.type.body.copy(fontSize = 12.sp, color = c.textMuted))
                }
                // set apart and quieter: a date, not part of the name
                o.year?.let { Text(it, Modifier.padding(start = 6.dp), style = MusixTheme.type.body.copy(fontSize = 12.sp, color = c.textSubtle)) }
            }
        }
    }
}

/** quizHit: 1 → 1.028 at 38 % → 1. */
private fun hitCurve(k: Float) = if (k < 0.38f) k / 0.38f else 1f - (k - 0.38f) / 0.62f

/** quizMiss: 0 → −6 (18 %) → 5 (44 %) → −3 (72 %) → 0, in dp. */
private fun shake(k: Float): Float {
    val pts = listOf(0f to 0f, 0.18f to -6f, 0.44f to 5f, 0.72f to -3f, 1f to 0f)
    val i = pts.indexOfLast { it.first <= k }.coerceIn(0, pts.size - 2)
    val (x0, y0) = pts[i]; val (x1, y1) = pts[i + 1]
    return y0 + (y1 - y0) * ((k - x0) / (x1 - x0)).coerceIn(0f, 1f)
}

/** The verdict, the one line the round could only say once answered, and what next. */
@Composable
private fun Reveal(a: QuizAnswer, r: QuizRound, year: Int?, accent: Color, vm: QuizViewModel) {
    val c = MusixTheme.colors
    Column(Modifier.rise(distance = 8.dp, scaleFrom = 0.94f, durationMs = 420), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Text(verdict(r.mode, a.correct), style = MusixTheme.type.title.copy(fontFamily = MusixFontFamilies.Playfair, fontSize = 24.sp, fontWeight = FontWeight.Normal, color = if (a.correct) c.green else c.text))
        revealLine(r.mode, a, year, accent)?.let {
            Text(it, Modifier.widthIn(max = 440.dp), textAlign = TextAlign.Center, style = MusixTheme.type.body.copy(fontSize = 13.5.sp, lineHeight = 1.55.em, color = c.textMuted))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
            if (a.truthTrackId != null) CtaButton("Слушать целиком", vm::playTruth)
            Text("Дальше", Modifier.skeButton(99.dp).pressable { vm.start(r.mode) }.padding(horizontal = 24.dp, vertical = 11.dp),
                style = MusixTheme.type.body.copy(fontSize = 12.5.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.07.em, color = c.text))
        }
    }
}

private fun verdict(mode: String, correct: Boolean) = when {
    correct && mode == "blind_year" -> "Точно"
    correct -> "Верно"
    mode == "blind_year" -> "Мимо"
    mode == "lineage" -> "Теперь знаешь"
    mode == "track_snippet" -> "Не узнал"
    else -> "Не тот"
}

/** v1 `QuizRevealLine`: the thing the round exists to deliver is marked (`.quiz-name`). */
private fun revealLine(mode: String, a: QuizAnswer, guess: Int?, accent: Color): androidx.compose.ui.text.AnnotatedString? {
    val rev = a.reveal
    fun str(k: String) = rev[k]?.let { (it as? kotlinx.serialization.json.JsonPrimitive)?.content }?.takeIf { it != "null" }
    val mark = SpanStyle(color = accent, fontWeight = FontWeight.Bold, background = accent.copy(alpha = 0.22f))
    return when (mode) {
        "blind_year" -> str("year")?.toIntOrNull()?.let { y ->
            val off = guess?.let { kotlin.math.abs(y - it) }
            buildAnnotatedString {
                append("${a.truthTitle ?: "—"} — "); withStyle(mark) { append("$y") }
                append(if (off != null && off > 0) " Разница в $off ${yearsWord(off)}." else ".")
            }
        }
        "producer" -> str("producer")?.let { p -> buildAnnotatedString { append("Остальные три сделал "); withStyle(mark) { append(p) }; append(".") } }
        "lineage" -> buildAnnotatedString { append("Связь — "); withStyle(mark) { append(if (str("relation") == "interpolation") "интерполяция" else "сэмпл") }; append(".") }
        else -> if (!a.correct) buildAnnotatedString {
            append("Это "); withStyle(mark) { append(a.truthTitle ?: "—") }; a.truthYear?.let { append(" · $it") }
        } else null
    }
}

private fun yearsWord(n: Int): String {
    val m10 = n % 10; val m100 = n % 100
    return if (m10 == 1 && m100 != 11) "год" else if (m10 in 2..4 && (m100 < 10 || m100 >= 20)) "года" else "лет"
}

/** v1 `SkeRange`: a pressed-in track, the filled part in the mode's colour, a raised thumb. */
@Composable
private fun SkeRange(value: Int, min: Int, max: Int, enabled: Boolean, accent: Color, onChange: (Int) -> Unit) {
    BoxWithConstraints(Modifier.widthIn(max = 380.dp).fillMaxWidth().height(30.dp)
        .pointerInput(enabled, min, max) {
            if (!enabled) return@pointerInput
            fun at(x: Float) = (min + ((x / size.width).coerceIn(0f, 1f) * (max - min))).toInt()
            detectTapGestures { onChange(at(it.x)) }
        }
        .pointerInput(enabled, min, max) {
            if (!enabled) return@pointerInput
            fun at(x: Float) = (min + ((x / size.width).coerceIn(0f, 1f) * (max - min))).toInt()
            detectHorizontalDragGestures { ch, _ -> ch.consume(); onChange(at(ch.position.x)) }
        }, contentAlignment = Alignment.CenterStart) {
        val f = if (max > min) (value - min).toFloat() / (max - min) else 0f
        Box(Modifier.fillMaxWidth().height(8.dp).skeInset(RoundedCornerShape(99.dp)))
        Box(Modifier.fillMaxWidth(f.coerceAtLeast(0.001f)).height(8.dp).background(accent.copy(alpha = if (enabled) 1f else 0.5f), RoundedCornerShape(99.dp)))
        Box(Modifier.offset(x = (maxWidth - 26.dp) * f).size(26.dp).skeButton(13.dp))
    }
}
