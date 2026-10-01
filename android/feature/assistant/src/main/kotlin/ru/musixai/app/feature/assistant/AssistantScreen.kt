package ru.musixai.app.feature.assistant

import android.os.Build
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.requiredHeight
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.BlurredEdgeTreatment
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.dropShadow
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.shadow.Shadow
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import coil3.compose.AsyncImage
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import ru.musixai.app.core.data.AsxIdea
import ru.musixai.app.core.data.AsxOptions
import ru.musixai.app.core.data.AsxSampleCard
import ru.musixai.app.core.data.AsxTrack
import ru.musixai.app.core.data.AsxTurn
import ru.musixai.app.core.data.AssistantTurns
import ru.musixai.app.core.data.PlaylistRepository
import ru.musixai.app.core.designsystem.MusixFontFamilies
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.core.designsystem.component.Cover
import ru.musixai.app.core.designsystem.component.pressable
import ru.musixai.app.core.designsystem.component.rise
import ru.musixai.app.core.player.PlayerController
import javax.inject.Inject

/** A past turn («Недавнее»): the query, its intent colour, the whole result and its slots. */
data class AsxPast(val id: Long, val message: String, val turn: AsxTurn, val savedPlaylist: String? = null)

data class AssistantUi(
    val input: String = "", val query: String = "", val busy: Boolean = false, val stage: String = "", val intent: String? = null,
    val turn: AsxTurn? = null, val failed: Boolean = false, val contextId: String? = null, val slots: JsonObject? = null,
    val ideas: List<AsxIdea> = emptyList(), val samples: List<AsxSampleCard> = emptyList(), val history: List<AsxPast> = emptyList(),
    val openId: Long? = null, val saving: Boolean = false, val asleep: Boolean = false,
) {
    val orb: OrbState get() = when {
        asleep -> OrbState.Sleep
        busy -> OrbState.Work
        failed || turn?.empty == true -> OrbState.Fail
        turn != null -> OrbState.Done
        else -> OrbState.Idle
    }
    val savedPlaylist: String? get() = history.firstOrNull { it.id == openId }?.savedPlaylist
}

@HiltViewModel
class AssistantViewModel @Inject constructor(
    private val turns: AssistantTurns, private val player: PlayerController, private val playlists: PlaylistRepository,
) : ViewModel() {
    private val _ui = MutableStateFlow(AssistantUi())
    val ui: StateFlow<AssistantUi> = _ui

    init {
        viewModelScope.launch { val i = turns.ideas(); _ui.update { it.copy(ideas = i) } }
        viewModelScope.launch { val s = turns.samples(); _ui.update { it.copy(samples = s) } }
    }

    fun input(t: String) = _ui.update { it.copy(input = t) }
    fun submit() { val t = _ui.value.input.trim(); if (t.isNotEmpty()) { send(t); _ui.update { it.copy(input = "") } } }

    /** v1 `send(text, opts)`: the orb takes the intent's colour as soon as the route frame lands. */
    fun send(text: String, opts: AsxOptions = AsxOptions()) {
        if (_ui.value.busy) return
        val prev = _ui.value
        _ui.update { it.copy(busy = true, stage = "", intent = opts.intent, failed = false, query = text) }
        val history = prev.history.take(4).reversed().flatMap { h ->
            listOf("user" to h.message, "assistant" to (h.turn.answer?.text ?: h.turn.playlist?.title ?: h.turn.search?.message ?: ""))
        }.filter { it.second.isNotBlank() }
        viewModelScope.launch {
            val r = runCatching {
                turns.send(text, opts, history, prev.slots, player.state.value.trackId) { f ->
                    _ui.update { u -> u.copy(stage = f.human ?: u.stage, intent = f.intent ?: u.intent) }
                }
            }
            val t = r.getOrNull()
            if (t == null) {
                val forbidden = r.exceptionOrNull()?.message?.contains("403") == true
                _ui.update { it.copy(busy = false, stage = "", failed = true, intent = null, asleep = forbidden) }
                return@launch
            }
            _ui.update { u ->
                val keep = !t.empty && t.clarify.isEmpty() && t.disambiguate.isEmpty()
                val past = if (keep) AsxPast(System.currentTimeMillis(), text, t) else null
                u.copy(busy = false, stage = "", turn = t, intent = t.intent, contextId = t.contextId, slots = t.slots ?: u.slots,
                    history = (listOfNotNull(past) + u.history).take(12), openId = past?.id)
            }
        }
    }

    /** Back to the front page: the pages the answer read go now (v1 resetTurn); slots stay. */
    fun reset() {
        _ui.value.contextId?.let { id -> viewModelScope.launch { turns.release(id) } }
        _ui.update { it.copy(turn = null, failed = false, intent = null, query = "", stage = "", contextId = null, openId = null) }
    }

    fun open(p: AsxPast) = _ui.update { it.copy(turn = p.turn, query = p.message, intent = p.turn.intent, slots = p.turn.slots ?: it.slots, contextId = null, failed = false, openId = p.id) }

    fun play(rows: List<AsxTrack>, i: Int) {
        val ids = rows.mapNotNull { it.id }
        val at = rows.getOrNull(i)?.id?.let { ids.indexOf(it) } ?: 0
        if (ids.isNotEmpty()) player.playTracks(ids, at.coerceAtLeast(0), "queue")
    }

    fun next(t: AsxTrack) { t.id?.let(player::playNext) }

    fun savePlaylist() {
        val u = _ui.value
        val p = u.turn?.playlist ?: return
        if (u.saving || u.savedPlaylist != null) return
        _ui.update { it.copy(saving = true) }
        viewModelScope.launch {
            val id = runCatching { playlists.create(p.title ?: "Подборка ИИ", u.query.ifBlank { null }).also { playlists.add(it, p.tracks.mapNotNull { t -> t.id }) } }.getOrNull()
            _ui.update { s -> s.copy(saving = false, history = s.history.map { h -> if (h.id == s.openId && id != null) h.copy(savedPlaylist = id) else h }) }
        }
    }

    suspend fun artistId(slug: String) = turns.artistId(slug)
}

private data class Star(val text: String, val intent: String)

// v1 ASX_PHRASES (ru); a phone shows four (s3/s4 hidden at ≤ 640 px)
private val STARS = listOf(
    Star("Расскажи про конфликт Канье и Тейлор", "general"), Star("Песни с неофициальным появлением Майкла Джексона", "playlist"),
    Star("хиты Kanye West", "playlist"), Star("что-нибудь спокойное на вечер", "audio_search"),
    Star("песня, где поётся, что гравитация всегда выигрывает", "lyrics_search"), Star("какие сэмплы в «Stronger»?", "general"),
)

// v1 ASX_TEMPLATES (ru): «Быстрые подборки»
private val TEMPLATES = listOf("под тренировку" to "собери плейлист под тренировку", "утренний кофе" to "собери спокойный плейлист на утро",
    "песни из игр" to "собери песни из видеоигр", "хиты нулевых" to "собери хиты нулевых")

/**
 * v1 `AssistantSection` on a phone (golden assistant-*-phone): a muted aurora; the orb in a
 * constellation of example wishes (tap one to ask it); the caption under it — the idle
 * question, the stage shimmering while it works, what it found; the composer as a line of
 * light; the answer (a playlist, a search, an answer, or a question back); and, while idle,
 * the entry points — facts from the library, sample hooks, quick playlists — and «Недавнее».
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun AssistantRoute(onArtist: (String) -> Unit, vm: AssistantViewModel = hiltViewModel()) {
    val ui by vm.ui.collectAsStateWithLifecycle()
    val c = MusixTheme.colors
    val dark = MusixTheme.isDark
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    val openArtist: (String) -> Unit = { slug -> scope.launch { vm.artistId(slug)?.let(onArtist) } }
    val compact = ui.turn != null || ui.failed
    Box(Modifier.fillMaxSize().background(c.bg)) {
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).statusBarsPadding().padding(start = 24.dp, end = 24.dp, top = 8.dp, bottom = 120.dp),
            horizontalAlignment = Alignment.CenterHorizontally) {
            Box(Modifier.fillMaxWidth().aurora()) {
                Hero(ui, compact, onStar = { vm.send(it) }, onOrb = { if (compact) vm.reset() })
            }
            Composer(ui, vm)
            val t = ui.turn
            if (t != null) {
                if (t.clarify.isNotEmpty()) ClarifyRow(t.clarify) { o -> vm.send(ui.query, AsxOptions(intent = o.intent)) }
                if (t.disambiguate.isNotEmpty()) WhoRail(t.disambiguate) { o -> vm.send(ui.query, AsxOptions(intent = "general", subjectTrackId = o.trackId, subjectArtistSlug = o.artistSlug)) }
                t.playlist?.let { p -> PlaylistCard(p, ui.query, ui.savedPlaylist != null, ui.saving, { i -> vm.play(p.tracks, i) }, vm::next, vm::savePlaylist) }
                t.search?.let { s ->
                    val all = listOfNotNull(s.best?.track) + s.hits.map { it.track }.filter { h -> h.id != s.best?.track?.id }
                    SearchCard(s, ui.query, { i -> vm.play(all, i) }, vm::next, onArtist)
                }
                t.answer?.let { a -> AnswerCard(a, ui.query, { q, o -> vm.send(q, o) }, ui.contextId, { i -> vm.play(a.related, i) }, vm::next, openArtist) }
            }
            if (ui.orb == OrbState.Idle) {
                if (ui.ideas.isNotEmpty()) Section("Интересное в вашей музыке") {
                    for (f in ui.ideas) FactLine(f) {
                        vm.send("объясни: ${f.fact}", AsxOptions(intent = "general", focusFact = f.fact, subjectTrackId = f.trackId,
                            subjectArtistSlug = if (f.trackId == null) f.artistSlug else null))
                    }
                }
                if (ui.samples.isNotEmpty()) Section("Что зашито в битах") {
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(14.dp, Alignment.CenterHorizontally), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        for (s in ui.samples) SampleStar(s) { vm.send(s.prompt, AsxOptions(intent = s.intent ?: "general", focusKind = "samples", subjectTrackId = s.trackId)) }
                    }
                }
                Section("Быстрые подборки") {
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(24.dp, Alignment.CenterHorizontally), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        for ((label, prompt) in TEMPLATES) Text(label, Modifier.pressable { vm.send(prompt, AsxOptions(intent = "playlist")) }.padding(vertical = 6.dp, horizontal = 2.dp),
                            style = MusixTheme.type.body.copy(fontSize = 13.sp, fontStyle = FontStyle.Italic, letterSpacing = 0.03.em, color = if (dark) Color(0x9EEEEEF3) else Color(0x99161620)))
                    }
                }
            }
            if (ui.history.isNotEmpty()) Section("Недавнее", top = 52.dp) {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(22.dp, Alignment.CenterHorizontally)) {
                    for (h in ui.history.take(8)) {
                        val on = h.id == ui.openId
                        val col = intentColor(h.turn.intent)
                        Box(Modifier.pressable { vm.open(h) }.padding(8.dp)) {
                            Box(Modifier.size(7.dp).graphicsLayer { alpha = if (on) 1f else 0.5f; val s = if (on) 1.4f else 1f; scaleX = s; scaleY = s }
                                .dropShadow(CircleShape, Shadow(radius = 12.dp, color = col)).background(col, CircleShape))
                        }
                    }
                }
                ui.history.firstOrNull { it.id == ui.openId }?.let {
                    Text(it.message, Modifier.padding(top = 4.dp), maxLines = 1, overflow = TextOverflow.Ellipsis,
                        style = MusixTheme.type.body.copy(fontSize = 11.5.sp, color = c.textMuted))
                }
            }
        }
    }
}

/** `.asn-aurora`: three violet fields behind the constellation, still on a phone (v1's battery
 *  rule). Drawn behind the hero and past its edges (it takes no room), unblurred — the gradients
 *  are soft on their own, and a blur clipped by its canvas left a hard edge under the hero. */
@Composable
private fun Modifier.aurora(): Modifier {
    val dark = MusixTheme.isDark
    val k = if (dark) 0.55f else 0.28f
    return drawBehind {
        fun field(cx: Float, cy: Float, rx: Float, col: Color) {
            val c0 = col.copy(alpha = col.alpha * k)
            drawCircle(Brush.radialGradient(listOf(c0, c0.copy(alpha = c0.alpha * 0.3f), Color.Transparent), Offset(cx, cy), rx), rx, Offset(cx, cy))
        }
        val w = size.width
        field(w * 0.25f, w * 0.20f, w * 0.80f, Color(0x577C5BFF))
        field(w * 0.88f, w * 0.30f, w * 0.72f, Color(0x6B3A2F7D))
        field(w * 0.55f, w * 0.70f, w * 0.68f, Color(0x61233A6B))
    }
}

/** `.asn-hero`: the constellation (idle only), the halo, the orb, the caption. 300 dp, 126 dp once answered. */
@Composable
private fun Hero(ui: AssistantUi, compact: Boolean, onStar: (String) -> Unit, onOrb: () -> Unit) {
    val c = MusixTheme.colors
    val dark = MusixTheme.isDark
    val ease = CubicBezierEasing(0.2f, 0.8f, 0.2f, 1f)
    val h by animateDpAsState(if (compact) 126.dp else 300.dp, tween(500, easing = ease), label = "hero")
    val os by animateDpAsState(if (compact) 72.dp else 136.dp, tween(500, easing = ease), label = "orb")
    val top by animateDpAsState(if (compact) 16.dp else 44.dp, tween(500, easing = ease), label = "top")
    val idle = ui.orb == OrbState.Idle
    val starsA by animateFloatAsState(if (idle && !compact) 1f else 0f, tween(500), label = "stars")
    BoxWithConstraints(Modifier.fillMaxWidth().height(h)) {
        val w = maxWidth
        if (starsA > 0f) {
            // .asn-s1 / s2 / s5 / s6 — the phone's four
            StarAt(STARS[1], w * 0.04f, h * 0.11f, null, starsA, onStar)
            StarAt(STARS[0], null, h * 0.07f, w * 0.06f, starsA, onStar)
            StarAt(STARS[4], w * 0.14f, h * 0.82f, null, starsA, onStar)
            StarAt(STARS[5], null, h * 0.86f, w * 0.16f, starsA, onStar)
        }
        // .asn-glow: the halo behind the orb, in the state's two colours
        val pal = orbPalette(ui.orb, ui.intent, dark)
        val g1 by animateColorAsState(pal.glow.first, tween(800), label = "g1")
        val g2 by animateColorAsState(pal.glow.second, tween(800), label = "g2")
        Canvas(Modifier.align(Alignment.TopCenter).offset(y = top + os / 2 - os * 1.15f).requiredSize(os * 2.3f)
            .graphicsLayer { alpha = if (ui.orb == OrbState.Sleep) 0.25f else 1f }) {
            // no blur: the gradient is soft on its own, and a static unbounded blur next to the
            // composer's moving glow crashed the emulator's renderer
            // stops closed at 1.0: a radial gradient ending short of it crashed the emulator's renderer
            drawCircle(Brush.radialGradient(0f to g1.copy(alpha = 0.34f), 0.42f to g2.copy(alpha = 0.14f), 0.7f to Color.Transparent, 1f to Color.Transparent))
        }
        Box(Modifier.align(Alignment.TopCenter).offset(y = top - 20.dp).then(if (compact) Modifier.pressable(onClick = onOrb) else Modifier)) {
            AiOrb(ui.orb, ui.intent, os)
        }
        Box(Modifier.align(Alignment.TopCenter).offset(y = top + os + if (compact) 12.dp else 20.dp).padding(horizontal = 14.dp)) { Caption(ui, compact) }
    }
}

@Composable
private fun androidx.compose.foundation.layout.BoxScope.StarAt(s: Star, left: Dp?, top: Dp, right: Dp?, alpha: Float, onStar: (String) -> Unit) {
    val dark = MusixTheme.isDark
    // placed straight in the hero's box: a wrapper of its own would leave the star outside its
    // parent's bounds, and touches there never reach it
    Row(Modifier.align(if (left != null) Alignment.TopStart else Alignment.TopEnd)
        .offset(x = left ?: -(right ?: 0.dp), y = top).graphicsLayer { this.alpha = alpha }
        .pressable { onStar(s.text) }.padding(horizontal = 4.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        IntentDot(s.intent, 5.dp)
        Text(s.text, maxLines = 1, style = MusixTheme.type.body.copy(fontSize = 11.sp, fontWeight = FontWeight.Light, letterSpacing = 0.05.em,
            color = if (dark) Color(0xEBC9C3E8) else Color(0xDB38305A)))
    }
}

/** `.aio-capt`: what the orb is doing, in words. */
@Composable
private fun Caption(ui: AssistantUi, compact: Boolean) {
    val dark = MusixTheme.isDark
    val size = if (compact) 13.sp else 15.5.sp
    val base = MusixTheme.type.body.copy(fontSize = size, textAlign = TextAlign.Center)
    when (ui.orb) {
        OrbState.Sleep -> Text("ИИ сейчас недоступен", Modifier.rise(distance = 5.dp, durationMs = 400), style = base.copy(letterSpacing = 0.02.em, color = if (dark) Color(0xFFE8C2CC) else Color(0xFFA05568)))
        OrbState.Idle -> Text("найти, собрать или рассказать?", style = base.copy(fontFamily = MusixFontFamilies.SerifDisplay, fontStyle = FontStyle.Italic, color = if (dark) Color(0xFFA49EC4) else Color(0x80161620)))
        OrbState.Work -> androidx.compose.runtime.key(ui.stage) { Shimmer(ui.stage.ifBlank { "думаю…" }, base) }
        OrbState.Fail -> Text("ничего не нашлось — спроси иначе", Modifier.rise(distance = 5.dp, durationMs = 400), style = base.copy(letterSpacing = 0.02.em, color = if (dark) Color(0xFFE8C2CC) else Color(0xFFA05568)))
        OrbState.Done -> {
            val t = ui.turn
            val text = when {
                t?.playlist != null -> "${t.playlist!!.tracks.size} ${ruTracks(t.playlist!!.tracks.size)}"
                t?.answer?.subject?.title != null -> t.answer!!.subject!!.title!!
                t?.search?.best != null -> t.search!!.best!!.track.title
                else -> ""
            }
            Text(text, Modifier.rise(distance = 5.dp, durationMs = 400), maxLines = 2, overflow = TextOverflow.Ellipsis,
                style = base.copy(letterSpacing = 0.02.em, color = if (dark) Color(0xFFC9E6D2) else Color(0xFF3F7D58)))
        }
    }
}

/** `.aio-shimmer`: the stage line with a light sweeping through it, 2.1 s — a fixed gradient slid
 *  across the text (SrcAtop in its own layer), never a new gradient per frame. */
@Composable
private fun Shimmer(text: String, style: TextStyle) {
    val dark = MusixTheme.isDark
    val t = rememberInfiniteTransition(label = "shimmer")
    val x by t.animateFloat(1f, -1f, infiniteRepeatable(tween(2100, easing = LinearEasing), RepeatMode.Restart), label = "x")
    val colors = if (dark) listOf(Color(0x59EEEEF3), Color.White, Color(0xFF8FB2FF), Color(0x59EEEEF3)) else listOf(Color(0x59161620), Color(0xFF161620), Color(0xFF3D63C9), Color(0x59161620))
    val sweep = androidx.compose.runtime.remember(dark) { Brush.horizontalGradient(colors) }
    Text(text, Modifier.rise(distance = 5.dp, durationMs = 350)
        .graphicsLayer { compositingStrategy = androidx.compose.ui.graphics.CompositingStrategy.Offscreen }
        .drawWithContent {
            drawContent()
            val w = size.width
            translate(left = w * x) {
                drawRect(sweep, topLeft = Offset(-w, 0f), size = androidx.compose.ui.geometry.Size(w * 3, size.height), blendMode = androidx.compose.ui.graphics.BlendMode.SrcAtop)
            }
        }, style = style.copy(fontWeight = FontWeight.Medium, color = colors[0]))
}

/** `.asn-line`: the composer as a line of light — an italic serif input, a hairline with a travelling glow, «Спросить ✦». */
@Composable
private fun Composer(ui: AssistantUi, vm: AssistantViewModel) {
    val dark = MusixTheme.isDark
    Column(Modifier.widthIn(max = 560.dp).fillMaxWidth().padding(top = 2.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
            val style = TextStyle(fontFamily = MusixFontFamilies.SerifDisplay, fontStyle = FontStyle.Italic, fontSize = 17.sp, textAlign = TextAlign.Center,
                color = if (dark) Color(0xFFEEEEF3) else Color(0xFF161620))
            if (ui.input.isEmpty()) Text("строчка из песни, желание или вопрос…", Modifier.padding(top = 8.dp, bottom = 13.dp), maxLines = 1, overflow = TextOverflow.Ellipsis,
                style = style.copy(color = if (dark) Color(0xBFA49EC4) else Color(0x6B161620)))
            BasicTextField(ui.input, vm::input, Modifier.fillMaxWidth().padding(top = 8.dp, bottom = 13.dp), singleLine = true, textStyle = style,
                cursorBrush = SolidColor(Color(0xFFFF78C8)), keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send), keyboardActions = KeyboardActions(onSend = { vm.submit() }))
        }
        Underline()
        val enabled = !ui.busy && ui.input.isNotBlank()
        Text(if (ui.busy) "Думаю…" else "Спросить ✦", Modifier.padding(top = 16.dp).graphicsLayer { alpha = if (enabled || ui.busy) 1f else 0.5f }
            .dropShadow(RoundedCornerShape(999.dp), Shadow(radius = 28.dp, spread = (-14).dp, color = Color(0xB37C5BFF), offset = DpOffset(0.dp, 10.dp)))
            .clip(RoundedCornerShape(999.dp))
            .background(Brush.linearGradient(if (dark) listOf(Color(0x4D7C5BFF), Color(0x29FF78C8), Color(0x387C5BFF)) else listOf(Color(0x297C5BFF), Color(0x1AFF78C8), Color(0x1F7C5BFF))))
            .border(1.dp, if (dark) Color(0x29FFFFFF) else Color(0x3D6042DC), RoundedCornerShape(999.dp))
            .pressable(enabled) { vm.submit() }.padding(horizontal = 28.dp, vertical = 11.dp),
            style = MusixTheme.type.body.copy(fontSize = 12.5.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.07.em, color = if (dark) Color(0xFFEEEEF3) else Color(0xFF3A2F6B)))
        if ((ui.turn != null || ui.failed) && !ui.busy) Text("✕ Сбросить ответ", Modifier.padding(top = 12.dp).clip(RoundedCornerShape(999.dp)).pressable(onClick = vm::reset)
            .padding(horizontal = 12.dp, vertical = 5.dp), style = MusixTheme.type.body.copy(fontSize = 12.sp, letterSpacing = 0.04.em, color = if (dark) Color(0x6BEEEEF3) else Color(0x6B161620)))
    }
}

/** `.asn-underline`: a hairline fading at both ends, a violet-pink glow sliding along it (14 s on a
 *  phone). The glow is redrawn in solid colours (two halves) rather than a moving gradient layer:
 *  moving layers beside the orb's blurred ring crashed the emulator's renderer; the home's
 *  equalizer is drawn this way and never did. */
@Composable
private fun Underline() {
    val dark = MusixTheme.isDark
    val t = rememberInfiniteTransition(label = "line")
    val k by t.animateFloat(0f, 1f, infiniteRepeatable(tween(14_000, easing = LinearEasing)), label = "k")
    val line = if (dark) Color(0x3DEEEEF3) else Color(0x38161620)
    val fade = androidx.compose.runtime.remember(line) { Brush.horizontalGradient(0f to Color.Transparent, 0.3f to line, 0.7f to line, 1f to Color.Transparent) }
    Box(Modifier.fillMaxWidth().height(4.dp)) {
        Box(Modifier.align(Alignment.Center).fillMaxWidth().height(1.dp).background(fade))
        Canvas(Modifier.fillMaxSize()) {
            val ping = if (k < 0.5f) k * 2 else 2 - k * 2  // asnGlowSlide: 12 % → 78 % → 12 %
            val x = size.width * (0.12f + 0.66f * (0.5f - 0.5f * kotlin.math.cos(ping * Math.PI.toFloat())))
            val gw = size.width * 0.1f
            val cr = androidx.compose.ui.geometry.CornerRadius(size.height / 2)
            drawRoundRect(Color(0xA67C5BFF), Offset(x, 0f), androidx.compose.ui.geometry.Size(gw * 0.6f, size.height), cr)
            drawRoundRect(Color(0xA6FF78C8), Offset(x + gw * 0.4f, 0f), androidx.compose.ui.geometry.Size(gw * 0.6f, size.height), cr)
        }
    }
}

@Composable
private fun Section(label: String, top: Dp = 36.dp, content: @Composable () -> Unit) {
    val dark = MusixTheme.isDark
    Column(Modifier.widthIn(max = 640.dp).fillMaxWidth().padding(top = top).rise(distance = 8.dp, durationMs = 380), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(label.uppercase(), Modifier.padding(bottom = 14.dp), style = MusixTheme.type.body.copy(fontSize = 10.5.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.22.em,
            color = if (dark) Color(0x61EEEEF3) else Color(0x66161620)))
        content()
    }
}

/** `.asn-fact`: a round attribution picture with a violet glow, the fact, «объяснить →». */
@Composable
private fun FactLine(f: AsxIdea, onClick: () -> Unit) {
    val dark = MusixTheme.isDark
    Row(Modifier.widthIn(max = 560.dp).fillMaxWidth().clip(RoundedCornerShape(16.dp)).pressable(onClick = onClick).padding(horizontal = 8.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        Box(Modifier.size(44.dp).dropShadow(CircleShape, Shadow(radius = 22.dp, spread = (-6).dp, color = Color(0xCC7C5BFF))).clip(CircleShape)
            .background(Brush.linearGradient(listOf(Color(0xFF31245E), Color(0xFF7C5BFF))))) {
            f.image?.let { AsyncImage(it.url(96), null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop) }
        }
        Text(f.fact, Modifier.weight(1f), style = MusixTheme.type.body.copy(fontSize = 13.sp, lineHeight = 1.5.em, color = if (dark) Color(0xA8EEEEF3) else Color(0xA3161620)))
        Text("объяснить →", style = MusixTheme.type.body.copy(fontSize = 11.5.sp, color = Color(0xFF5EE6C8)))
    }
}

/** `.asn-smp`: a «double star» pill — the cover, the hook, the amber count. */
@Composable
private fun SampleStar(s: AsxSampleCard, onClick: () -> Unit) {
    val dark = MusixTheme.isDark
    Row(Modifier.padding(vertical = 2.dp).clip(RoundedCornerShape(999.dp)).pressable(onClick = onClick).padding(start = 9.dp, end = 16.dp, top = 8.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Box(Modifier.size(30.dp).clip(CircleShape).background(Brush.linearGradient(listOf(Color(0xFF3A3210), Color(0xFFE0B341))))
            .border(1.dp, Color(0x1FFFFFFF), CircleShape)) {
            s.cover?.let { AsyncImage(it.url(96), null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop) }
        }
        Text(s.prompt.replaceFirstChar { it.uppercase() }, style = MusixTheme.type.body.copy(fontSize = 12.5.sp, color = if (dark) Color(0xA8EEEEF3) else Color(0xA3161620)))
        s.badge?.let {
            Text(it, Modifier.border(1.dp, Color(0x59FFB35C), RoundedCornerShape(999.dp)).padding(horizontal = 8.dp, vertical = 2.dp),
                style = MusixTheme.type.body.copy(fontSize = 10.5.sp, color = Color(0xFFFFB35C)))
        }
    }
}
