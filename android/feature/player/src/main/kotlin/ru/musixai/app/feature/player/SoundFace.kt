package ru.musixai.app.feature.player

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.withFrameNanos
import kotlinx.coroutines.flow.collectLatest
import ru.musixai.app.core.model.StageFrames
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.BlurredEdgeTreatment
import androidx.compose.ui.draw.blur
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import ru.musixai.app.core.designsystem.DarkMusixColors
import ru.musixai.app.core.designsystem.MusixFontFamilies
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.core.designsystem.gesture.HapticCue
import ru.musixai.app.core.designsystem.gesture.LocalMusixHaptics
import ru.musixai.app.core.designsystem.gesture.Press
import ru.musixai.app.core.designsystem.gesture.pressable
import ru.musixai.app.core.designsystem.motion.rememberReducedMotion
import ru.musixai.app.core.designsystem.surface.GlassTone
import ru.musixai.app.core.designsystem.surface.LiquidGlass
import ru.musixai.app.core.designsystem.text
import ru.musixai.app.core.model.PlayerContext
import ru.musixai.app.core.model.SoundMoment
import ru.musixai.app.core.model.TrackSound
import kotlin.math.max
import kotlin.math.sqrt

/** One part of the mix on the stage plot: who, where (pan, width), how loud ([a]), and its row (0 drums … 3 voice). */
internal data class Part(val key: String, val label: String, val pan: Float, val width: Float, val a: Float, val row: Int, val voice: Boolean, val where: String, val at: Double?, val stem: String = "")

private val RARE = setOf("brass", "winds", "sax", "woodwind", "piano", "electric_piano", "organ", "harpsichord", "harp", "sitar", "banjo", "mandolin", "ukulele", "accordion", "harmonica", "bagpipes", "theremin")
private val ORDER = listOf("strings", "acoustic_guitar", "electric_guitar", "slide_guitar", "guitar", "synthesizer", "synths", "lead", "bass_guitar", "double_bass", "synth_bass", "bass_808")
/** How much of the mix each stem takes when the profile does not say: a voice in front, the drums, the bass. */
private val SHARE = mapOf("vocals" to 0.3f, "drums" to 0.25f, "bass" to 0.2f)

/** The instruments the profile names, rare ones first, with the moment each comes in (the mock's `instruments()`). */
internal fun instruments(s: TrackSound, moments: List<SoundMoment>): List<Triple<String, String, Double?>> {
    var keys = s.instruments.map { it.key }
    if ("brass" in keys) keys = keys.filter { it != "winds" }
    val label = s.instruments.associate { it.key to it.label }
    keys = keys.sortedWith(compareBy<String> { if (it in RARE) 0 else 1 }.thenBy { ORDER.indexOf(it) })
    val out = keys.map { it to (label[it] ?: it) }.toMutableList()
    s.drums?.let { out += (if (it.key == "live") "drums_live" else "drum_machine") to it.label }
    s.vocals?.let { if (it.key !in setOf("voice", "vocal")) out += it.key to it.label }
    return out.take(6).map { (k, l) -> val word = l.split(' ').last(); Triple(k, l, moments.firstOrNull { word in it.label }?.t) }
}

/** The parts of the mix: voice in front, drums at the back (a stage plot), placed by their measured pan and width. */
internal fun parts(s: TrackSound, moments: List<SoundMoment>): List<Part> {
    val ins = instruments(s, moments)
    fun by(stems: Set<String>) = s.stems.filter { it.stem in stems }
    data class Raw(val key: String, val label: String, val pan: Float, val width: Float, val share: Float, val row: Int, val voice: Boolean, val stem: String)
    val raw = ArrayList<Raw>()
    for (v in by(setOf("vocals"))) raw += Raw(v.name.key, s.vocals?.label ?: "голос", v.pan, v.width, SHARE.getValue("vocals"), 3, true, "vocals")
    for (x in by(setOf("guitar", "piano", "other"))) {
        val known = s.instruments.firstOrNull { it.key == x.name.key }
        val l = known?.label ?: x.name.label.ifBlank { mapOf("synth_other" to "синтезаторы", "strings" to "струнные", "guitar" to "гитара", "piano" to "пианино")[x.name.key] ?: x.name.key }
        raw += Raw(x.name.key, l, x.pan, x.width, SHARE[x.stem] ?: 0.1f, 2, false, x.stem)
    }
    for (b in by(setOf("bass"))) raw += Raw(b.name.key, s.instruments.firstOrNull { it.key == b.name.key }?.label ?: "бас", b.pan, b.width, SHARE.getValue("bass"), 1, false, "bass")
    val drums = by(setOf("kick", "snare", "toms", "hh", "cym", "drums"))
    if (drums.isNotEmpty()) {
        val lo = drums.minOf { it.pan }; val hi = drums.maxOf { it.pan }
        raw += Raw(if (s.drums?.key == "machine") "drum_machine" else "drums_live", s.drums?.label ?: "ударные", (lo + hi) / 2, ((hi - lo) / 2 + 0.3f).coerceIn(0.2f, 0.9f), SHARE.getValue("drums"), 0, false, "drums")
    }
    val top = max(raw.maxOfOrNull { it.share } ?: 0.01f, 0.01f)
    fun side(pan: Float) = if (pan < -0.2f) "слева" else if (pan > 0.2f) "справа" else "по центру"
    return raw.map { r -> Part(r.key, r.label, r.pan, r.width, 0.34f + 0.66f * sqrt(r.share / top), r.row, r.voice, side(r.pan), ins.firstOrNull { it.second == r.label }?.third, r.stem) }
}

private val SHOW = mapOf("tech" to (25f to 70f), "space" to (10f to 90f), "odd" to (0f to 70f))
/** A rating as the stage shows it: the range real songs take, spread over 0…100. */
internal fun shown(s: TrackSound, key: String): Int {
    val v = when (key) { "tech" -> s.ratings.tech.toFloat(); "space" -> s.ratings.space?.toFloat() ?: return 0; else -> s.ratings.odd.toFloat() }
    val (lo, hi) = SHOW.getValue(key)
    return (((v - lo) / (hi - lo)).coerceIn(0f, 1f) * 100).toInt()
}

private val ROW_Y = floatArrayOf(0.2f, 0.4f, 0.6f, 0.8f)
private val DEPTH = floatArrayOf(0.74f, 0.82f, 0.9f, 1f)

/**
 * The sound side, «Сцена А» (the owner's pick, 2026-11-15): a still stage plot of the mix seen from the
 * listener's seat. Each part is a pool of light where it stands — its width how wide it plays, its
 * brightness how loud; the room's echo softens the pools. A tap names a part and lights its moment on the
 * line; three scales below, a tap on one explains it in the phrase. Nothing moves at rest.
 */
@Composable
internal fun SoundFace(
    s: TrackSound, stage: StageFrames?, clock: Clock, accent: Color, cover: Dp, moments: List<SoundMoment>, playing: Boolean, pick: String?,
    onPick: (String?) -> Unit, onPart: (Double?) -> Unit,
) {
    val c = MusixTheme.colors
    val haptics = LocalMusixHaptics.current
    val density = LocalDensity.current
    val reduced = rememberReducedMotion()
    val ps = remember(s) { parts(s, moments) }
    val W = cover
    val H = cover - 92.dp
    val k = W.value / 372f
    val soft = mapOf("dry" to 1f, "little" to 3f, "noticeable" to 6f, "hall" to 11f)[s.echo?.key] ?: 4f
    var on by remember(s) { mutableIntStateOf(-1) }
    var shot by remember { mutableIntStateOf(0) }
    LaunchedEffect(on, shot) { if (on >= 0) { delay(2600); on = -1 } }
    // the live stage (the song's frames): steps while it plays or settles, still otherwise; a seek on
    // pause steps it to the new moment. Without frames, or when no part really plays, the still plot.
    val live = remember(stage, ps) { stage?.let { LiveStage(it, ps) }?.takeIf { it.alive } }
    val playNow by rememberUpdatedState(playing)
    LaunchedEffect(live) {
        val l = live ?: return@LaunchedEffect
        snapshotFlow { if (playNow) -1f else clock.sec }.collectLatest {
            var last = 0L
            while (true) {
                val go = withFrameNanos { n -> val dt = stepMs(last, n); last = n; l.step(clock.sec, dt, playNow, n / 1_000_000) }
                if (!go) break
            }
        }
    }
    val moves = live != null && !reduced
    fun panOf(i: Int) = if (moves) live!!.pan[i] else ps[i].pan
    fun visOf(i: Int) = live?.vis?.get(i) ?: 1f
    // where each part stands in its row, dp (a second part of a row steps aside)
    val ys = remember(ps, H) {
        val taken = IntArray(4)
        ps.map { p -> val n = ++taken[p.row]; H * (ROW_Y[p.row] + if (n > 1) (if (n % 2 == 1) -0.085f else 0.085f) else 0f) + 8.dp }
    }
    // the cast comes in one by one when the side opens (or the song changes on it)
    val arrive = remember(s) { List(ps.size) { Animatable(if (reduced) 1f else 0f) } }
    val rise = remember(s) { Animatable(if (reduced) 1f else 0f) }
    LaunchedEffect(s) {
        if (reduced) return@LaunchedEffect
        arrive.forEachIndexed { i, a -> launch { delay(140L + i * 70L); a.animateTo(1f, springKcm(260f, 16f)) } }
        launch { delay(260); rise.animateTo(1f, springKcm(240f, 26f)) }
    }

    Box(Modifier.fillMaxSize().background(Brush.verticalGradient(0f to Color(0xE609090D), 0.55f to Color(0xB809090D), 1f to Color(0xD109090D)))) {
        Canvas(Modifier.fillMaxSize()) {
            drawRect(Brush.radialGradient(0f to accent.copy(alpha = 0.26f), 0.62f to Color.Transparent, center = Offset(size.width / 2, size.height * 1.08f), radius = size.width * 0.9f))
        }
        Box(Modifier.fillMaxWidth().height(H)) {
            // the rows of the stage, seen from the seat, and the rings of the parts that came in
            Canvas(Modifier.fillMaxSize()) {
                val w = size.width; val h = size.height
                for (i in 0..3) {
                    val rx = w * (0.86f - i * 0.2f); val ry = h * (1.12f - ROW_Y[i])
                    drawOval(Color.White.copy(alpha = 0.07f), Offset(w / 2 - rx, h * 1.12f - ry), Size(rx * 2, ry * 2), style = Stroke(1.dp.toPx()))
                }
                val l = live ?: return@Canvas
                l.tick.longValue   // redrawn on every step of the stage
                if (reduced) return@Canvas
                for (r in l.ripples) {
                    val age = ((l.now - r.t0).toFloat() / LiveStage.RIPPLE_MS).coerceIn(0f, 1f)
                    val e = 1f - (1f - age) * (1f - age) * (1f - age)
                    val d = DEPTH[ps[r.part].row]
                    val cx = w * (0.5f + l.pan[r.part] * 0.46f).coerceIn(0.2f, 0.8f)
                    val cy = ys[r.part].toPx()
                    val light = lerp(Color.White, accent, if (ps[r.part].voice) 0.22f else 0.52f)
                    // flat on the floor: wider than deep, as the rows are
                    val rx = ((24f + 96f * e) * k * d).dp.toPx(); val ry = rx * 0.42f
                    drawOval(light.copy(alpha = 0.5f * (1f - age)), Offset(cx - rx, cy - ry), Size(rx * 2, ry * 2), style = Stroke(1.5f.dp.toPx()))
                }
            }
            SideWord("слева", Modifier.align(Alignment.TopStart).padding(start = 28.dp, top = 12.dp))
            SideWord("справа", Modifier.align(Alignment.TopEnd).padding(end = 28.dp, top = 12.dp))
            ps.forEachIndexed { i, p ->
                val d = DEPTH[p.row]
                val pw = ((64 + p.width * 132) * k * d).dp
                val ph = ((54 + 34 * p.a) * k * d).dp
                val y = ys[i]
                val light = lerp(Color.White, accent, if (p.voice) 0.22f else 0.52f)
                val lit = on == i
                val glyphS by animateFloatAsState(if (lit) 1.25f else 1f, springKcm(300f, 18f), label = "g$i")
                Box(
                    Modifier
                        .offset {
                            live?.tick?.longValue
                            val x = W.toPx() * (0.5f + panOf(i) * 0.46f).coerceIn(0.2f, 0.8f)
                            IntOffset((x - pw.toPx() / 2).toInt(), (y - ph / 2).roundToPx())
                        }
                        .requiredSize(pw, ph)
                        .graphicsLayer {
                            live?.tick?.longValue
                            // it comes on the stage as it starts to play and leaves after it stops
                            val v = visOf(i)
                            val a = arrive[i].value; alpha = (a * v).coerceIn(0f, 1f); val sc = (0.6f + 0.4f * a) * (0.82f + 0.18f * v); scaleX = sc; scaleY = sc
                        }
                        .pressable(role = Press.Card) {
                            if (visOf(i) < 0.15f) return@pressable
                            haptics.perform(HapticCue.Tick, fromUser = true)
                            on = i; shot++
                            if (p.at != null) onPart(p.at)
                        },
                    contentAlignment = Alignment.Center,
                ) {
                    // the light breathes with the part's level: only the layer changes, the blur is not redrawn
                    Canvas(
                        Modifier.fillMaxSize()
                            .graphicsLayer {
                                val l = live ?: return@graphicsLayer
                                l.tick.longValue
                                val g = l.glow[i]
                                alpha = 0.3f + 0.7f * g; val sc = 0.9f + 0.16f * g; scaleX = sc; scaleY = sc
                            }
                            .blur((soft * d).dp, BlurredEdgeTreatment.Unbounded),
                    ) {
                        val r = size.minDimension / 2
                        scale(size.width / size.minDimension, size.height / size.minDimension) {
                            drawCircle(Brush.radialGradient(0f to light, 0.42f to light.copy(alpha = 0.62f), 0.74f to light.copy(alpha = 0.18f), 1f to Color.Transparent, center = center, radius = r), r, alpha = p.a)
                        }
                    }
                    Glyph(p.key, Color.White, Modifier.size(22.dp).graphicsLayer { scaleX = glyphS; scaleY = glyphS; translationY = (glyphS - 1f) * -8.dp.toPx() }, shadow = true)
                }
            }
            Glyph("listener", Color.White.copy(alpha = 0.55f), Modifier.align(Alignment.BottomCenter).padding(bottom = 2.dp).size(18.dp))
            // the name of a tapped part, over it (and with it, if it moves)
            val p = ps.getOrNull(on)
            if (p != null) {
                val i = on
                val d = DEPTH[p.row]
                val ph = ((54 + 34 * p.a) * k * d)
                val y = (ys[i] - (ph / 2).dp - 6.dp).coerceAtLeast(34.dp)
                val text = p.label.replaceFirstChar { it.uppercase() } + " · " + p.where + (p.at?.let { " · вступает в " + fmt(it) } ?: "")
                PartLabel(text, { live?.tick?.longValue; (W * (0.5f + panOf(i) * 0.46f).coerceIn(0.2f, 0.8f)).coerceIn(96.dp, W - 96.dp) }, y, on, shot)
            }
        }
        // three scales, the stage's numbers
        Row(
            Modifier.align(Alignment.BottomStart).padding(start = 28.dp, end = 28.dp, bottom = 14.dp).fillMaxWidth().height(66.dp)
                .graphicsLayer { alpha = rise.value.coerceIn(0f, 1f); translationY = (1f - rise.value) * 8.dp.toPx() },
            horizontalArrangement = Arrangement.spacedBy(if (cover < 340.dp) 8.dp else 14.dp),
        ) {
            for (key in listOf("tech", "space", "odd")) {
                if (key == "space" && s.ratings.space == null) continue
                // the stage is dark in both themes: its scales take the dark theme's hues (the light
                // theme's are deepened for a light page and sink into the stage)
                val hue = when (key) { "tech" -> DarkMusixColors.soundTech; "space" -> DarkMusixColors.soundSpace; else -> DarkMusixColors.soundOdd }
                val dim by animateFloatAsState(if (pick != null && pick != key) 0.42f else 1f, tween(250), label = "dim$key")
                val fill by animateFloatAsState(if (rise.value > 0.5f || reduced) shown(s, key) / 100f else 0f, tween(900), label = "bar$key")
                Column(
                    Modifier.weight(1f).height(66.dp).graphicsLayer { alpha = dim }.pressable(role = Press.Chip) {
                        haptics.perform(HapticCue.Tick, fromUser = true)
                        onPick(if (pick == key) null else key)
                    },
                    verticalArrangement = Arrangement.spacedBy(5.dp, Alignment.Bottom),
                ) {
                    Text("${shown(s, key)}", style = MusixTheme.text.number.copy(fontFamily = MusixFontFamilies.Mono, fontSize = if (cover < 340.dp) 20.sp else 24.sp, fontWeight = FontWeight.Medium, lineHeight = 1.em, letterSpacing = (-0.03).em, color = hue))
                    Text(SCALE.getValue(key), style = MusixTheme.text.caption.copy(fontSize = 12.sp, color = Color.White.copy(alpha = 0.72f)))
                    Canvas(Modifier.fillMaxWidth().height(3.dp)) {
                        val r = androidx.compose.ui.geometry.CornerRadius(2.dp.toPx())
                        drawRoundRect(Color.White.copy(alpha = 0.14f), cornerRadius = r)
                        drawRoundRect(hue, size = Size(size.width * fill, size.height), cornerRadius = r)
                    }
                }
            }
        }
    }
}

@Composable
private fun SideWord(text: String, modifier: Modifier) =
    Text(text.uppercase(), modifier, style = MusixTheme.text.cap.copy(fontSize = 11.sp, color = Color.White.copy(alpha = 0.42f)))

@Composable
private fun PartLabel(text: String, x: () -> Dp, y: Dp, key: Int, shot: Int) {
    val k = remember(key, shot) { Animatable(0f) }
    LaunchedEffect(key, shot) { k.animateTo(1f, springKcm(300f, 20f)) }
    Box(Modifier.offset { IntOffset(x().roundToPx(), y.roundToPx()) }.layoutCentered()) {
        LiquidGlass(Modifier.graphicsLayer {
            transformOrigin = TransformOrigin(0.5f, 1f); val s = 0.72f + 0.28f * k.value; scaleX = s; scaleY = s; alpha = k.value.coerceIn(0f, 1f)
        }, radius = 999.dp, tone = GlassTone.Label, onArt = true) {
            Text(text, Modifier.padding(horizontal = 12.dp, vertical = 6.dp), maxLines = 1, style = MusixTheme.text.label.copy(fontSize = 13.sp, color = Color.White))
        }
    }
}

/** Places the content with its bottom centre at the offset point (`translate(-50%,-100%)`). */
private fun Modifier.layoutCentered(): Modifier = layout { m, c ->
    val p = m.measure(c.copy(minWidth = 0, minHeight = 0, maxWidth = androidx.compose.ui.unit.Constraints.Infinity))
    layout(0, 0) { p.place(-p.width / 2, -p.height) }
}

/** An instrument glyph of the web player, drawn with its 1.7 stroke on a 24 grid. */
@Composable
internal fun Glyph(key: String, color: Color, modifier: Modifier, shadow: Boolean = false) {
    val paths = remember(key) { InstrumentGlyphs.of(key).map { PathParser().parsePathString(it.d).toPath() to it.fill } }
    Canvas(modifier) {
        val s = size.minDimension / 24f
        if (shadow) translate(0f, 1.dp.toPx()) { scale(s, Offset.Zero) { drawGlyph(paths, Color.Black.copy(alpha = 0.45f), 2.6f) } }
        scale(s, Offset.Zero) { drawGlyph(paths, color, 1.7f) }
    }
}

private fun DrawScope.drawGlyph(paths: List<Pair<Path, Boolean>>, color: Color, width: Float) {
    for ((p, fill) in paths) {
        if (fill) drawPath(p, color) else drawPath(p, color, style = Stroke(width, cap = StrokeCap.Round, join = StrokeJoin.Round))
    }
}
