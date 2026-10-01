package ru.musixai.app.feature.player

import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.layout.positionInParent
import androidx.compose.ui.layout.onGloballyPositioned
import android.os.Build
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.keyframes
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.waitForUpOrCancellation
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.dropShadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.asAndroidPath
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.shadow.Shadow
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import ru.musixai.app.core.designsystem.MusixIcons
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.core.designsystem.component.Cover
import ru.musixai.app.core.designsystem.component.pressable
import ru.musixai.app.core.model.Image
import ru.musixai.app.core.model.PlayerContext
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos

/** v1's cover motion (styles.css `.player-art-*`, the touch variants): */
private val SwipeOut = CubicBezierEasing(0.3f, 0f, 0.8f, 0.4f)       // coverSwipeOut*, 260 ms
private val SwipeIn = CubicBezierEasing(0.16f, 1f, 0.3f, 1f)         // coverSwipeIn*, 320 ms after 110 ms
private val Flip = CubicBezierEasing(0.34f, 1.35f, 0.64f, 1f)        // .player-art-flipper, 720 ms
private val Press = CubicBezierEasing(0.22f, 0.9f, 0.3f, 1f)         // .player-art-press, 140 ms

sealed interface Explain {
    data object Loading : Explain
    data class Done(val text: String) : Explain
}

/**
 * v1 `.player-art-wrap` on a phone: the cover is the play/pause button (a press-down, then
 * the glassy play/pause glyph over a brief blur), it swipes to the next/previous track (the
 * outgoing cover slides off from where the finger left it, the incoming glides in from the
 * other side), a veil with a spinner covers it while the track loads, and the lyrics
 * button flips it over: the lyrics live on its back (v1 `LyricsBackFace`).
 */
@Composable
fun CoverStage(
    ui: PlayerUi,
    flipped: Boolean,
    onToggle: () -> Unit,
    onNext: () -> Unit,
    onPrev: () -> Unit,
    explain: Map<Int, Explain>,
    onExplain: (Int, String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val c = MusixTheme.colors
    val p = ui.player
    val density = LocalDensity.current
    var widthPx by remember { mutableFloatStateOf(1f) }

    // ── track change: the outgoing snapshot and the incoming entry ─────────────────────
    var drag by remember { mutableFloatStateOf(0f) }
    var dir by remember { mutableIntStateOf(1) }          // +1 next, −1 previous
    var shown by remember { mutableStateOf(p.trackId to coverOf(ui)) }
    var outgoing by remember { mutableStateOf<Pair<CoverImage?, Float>?>(null) }  // image, the finger's offset
    val outT = remember { Animatable(1f) }
    val inT = remember { Animatable(1f) }
    LaunchedEffect(p.trackId) {
        if (p.trackId == shown.first) return@LaunchedEffect
        val first = shown.first == null
        outgoing = shown.second to drag
        drag = 0f
        shown = p.trackId to coverOf(ui)
        if (first) { outgoing = null; return@LaunchedEffect }
        outT.snapTo(0f); inT.snapTo(0f)
        coroutineScope {
            launch { outT.animateTo(1f, tween(260, easing = SwipeOut)); outgoing = null }
            launch { delay(110); inT.animateTo(1f, tween(320, easing = SwipeIn)) }
        }
        dir = 1  // an automatic advance slides forward; a gesture sets it before the change
    }
    // the context (and so the real image) can land after the track id
    LaunchedEffect(ui.context?.track?.id, p.artUri) { if (shown.first == p.trackId) shown = p.trackId to coverOf(ui) }

    // ── the flip, the press, the play/pause feedback ─────────────────────────────────
    val flip by animateFloatAsState(if (flipped) 1f else 0f, tween(720, easing = Flip), label = "flip")
    var pressed by remember { mutableStateOf(false) }
    val pressScale by animateFloatAsState(if (pressed && !flipped) 0.96f else 1f, tween(140, easing = Press), label = "press")
    var feedback by remember { mutableLongStateOf(0L) }
    var feedbackPlay by remember { mutableStateOf(true) }
    val fb = remember { Animatable(1f) }
    LaunchedEffect(feedback) { if (feedback != 0L) { fb.snapTo(0f); fb.animateTo(1f, tween(1200, easing = LinearEasing)) } }
    val veil by animateFloatAsState(if (p.buffering) 1f else 0f, tween(220), label = "veil")

    Box(modifier.fillMaxWidth().aspectRatio(1f)) {
        ui.burst?.let { (kind, nonce) -> Combustion(kind, nonce, Modifier.fillMaxSize()) }
        // the outgoing cover leaves toward the side the finger went
        outgoing?.let { (img, from) ->
            val k = outT.value
            Box(Modifier.fillMaxSize().graphicsLayer {
                translationX = from + (-0.6f * widthPx * dir - 0f) * k
                rotationZ = -7f * dir * k
                val s = 1f - 0.06f * k; scaleX = s; scaleY = s
                alpha = 1f - k
            }) { CoverFace(img, p.title, p.artist, track = "out", known = true) }
        }
        Box(
            Modifier.fillMaxSize()
                .graphicsLayer {
                    val k = inT.value
                    translationX = drag + 0.28f * widthPx * dir * (1f - k)
                    rotationZ = drag / 40f
                    val s = pressScale * (0.96f + 0.04f * k); scaleX = s; scaleY = s
                    alpha = if (outgoing != null) k else 1f
                }
                .pointerInput(flipped) {
                    widthPx = size.width.toFloat()
                    if (flipped) return@pointerInput
                    awaitEachGesture {
                        awaitFirstDown(requireUnconsumed = false)
                        pressed = true
                        val up = waitForUpOrCancellation()
                        pressed = false
                        if (up != null && abs(drag) < 8f) {
                            feedbackPlay = !p.isPlaying
                            feedback = System.nanoTime()
                            onToggle()
                        }
                    }
                }
                .pointerInput(flipped) {
                    if (flipped) return@pointerInput
                    detectHorizontalDragGestures(
                        onDragEnd = {
                            if (abs(drag) > size.width * 0.22f) {
                                dir = if (drag < 0) 1 else -1
                                if (drag < 0) onNext() else onPrev()
                            } else drag = 0f
                        },
                        onDragCancel = { drag = 0f },
                    ) { ch, dx -> ch.consume(); drag += dx }
                },
        ) {
            // the card's shadow stays out of the 3D layer (a blurred shadow under a perspective
            // transform crashed the emulator's renderer) and narrows with the card's projection
            Box(Modifier.fillMaxSize().graphicsLayer { scaleX = abs(cos(PI * flip)).toFloat().coerceAtLeast(0.04f) }
                .dropShadow(RoundedCornerShape(20.dp), Shadow(radius = 40.dp, color = Color(0x73000000), offset = DpOffset(0.dp, 30.dp))))
            // the flipper: front = the cover, back = the lyrics
            Box(Modifier.fillMaxSize().graphicsLayer {
                rotationY = 180f * flip
                cameraDistance = 14f * density.density
            }) {
                if (flip < 0.5f) {
                    val blur = (feedbackBlur(fb.value) * 9f + veil * 7f)
                    Box(Modifier.fillMaxSize()) {
                        Box(Modifier.fillMaxSize().then(if (blur > 0.3f && Build.VERSION.SDK_INT >= 31) Modifier.blur(blur.dp) else Modifier)) {
                            CoverFace(shown.second, p.title, p.artist, track = shown.first, known = ui.context?.track?.id == shown.first)
                        }
                        if (veil > 0f) BufferingVeil(veil)
                    }
                } else {
                    // the page is rasterized flat, then the texture turns: text redrawn under a
                    // perspective every frame is slow, and it crashed the emulator's renderer
                    Box(Modifier.fillMaxSize().graphicsLayer { rotationY = 180f; compositingStrategy = CompositingStrategy.Offscreen }) {
                        LyricsBack(ui.context, p.title, p.positionMs, explain, onExplain)
                    }
                }
            }
        }
        // the glassy glyph stays upright: outside the flip and the swipe
        if (fb.value < 1f) FeedbackGlyph(fb.value, feedbackPlay)
        // flank arrows (v1 `.player-side-btn--flank`), gone while the lyrics are open
        val arrows by animateFloatAsState(if (flipped) 0f else 1f, tween(220), label = "arrows")
        if (arrows > 0f) {
            Icon(MusixIcons.ChevronLeft, "Предыдущий", Modifier.align(Alignment.CenterStart).padding(start = 12.dp).size(26.dp)
                .graphicsLayer { alpha = arrows }.pressable { dir = -1; onPrev() }, tint = c.text.copy(alpha = 0.5f))
            Icon(MusixIcons.ChevronRight, "Следующий", Modifier.align(Alignment.CenterEnd).padding(end = 12.dp).size(26.dp)
                .graphicsLayer { alpha = arrows }.pressable { dir = 1; onNext() }, tint = c.text.copy(alpha = 0.85f))
        }
    }
}

typealias CoverImage = Image

private fun coverOf(ui: PlayerUi): CoverImage? =
    ui.context?.takeIf { it.track.id == ui.player.trackId }?.image
        ?: ui.player.artUri?.let { Image(it, null, null, null, null, mapOf(PlayerPrefetch.STAGE_PX to it)) }

/**
 * The stage's cover never shows the generated placeholder while a real image is on its way.
 * It holds the image last decoded for this [track] (so the media item's art can upgrade to
 * the context's sharper variant without a gap), else the blurhash or a quiet dark sleeve, and
 * fades the bitmap in once decoded. The generated gradient with initials is drawn only when
 * the track really has no cover ([known]: its context has come). Before, that placeholder
 * flashed for ~0.5 s on every track start (the owner, 2026-10-02).
 */
@Composable
private fun CoverFace(img: CoverImage?, title: String, artist: String, track: String?, known: Boolean) {
    val shape = RoundedCornerShape(20.dp)
    val url = img?.url(PlayerPrefetch.STAGE_PX)
    var held by remember(track) { mutableStateOf<androidx.compose.ui.graphics.painter.Painter?>(null) }
    Box(Modifier.fillMaxSize().clip(shape).background(Color(0xFF15151B))) {
        if (url != null) {
            val painter = coil3.compose.rememberAsyncImagePainter(url)
            val state by painter.state.collectAsState()
            LaunchedEffect(state) { (state as? coil3.compose.AsyncImagePainter.State.Success)?.let { held = it.painter } }
            val shownAlpha by animateFloatAsState(if (held != null) 1f else 0f, tween(180), label = "cover")
            if (held == null) img.blurhash?.let { ru.musixai.app.core.designsystem.component.Blurhash(it) }
            held?.let { androidx.compose.foundation.Image(it, null, Modifier.fillMaxSize().graphicsLayer { alpha = shownAlpha }, contentScale = androidx.compose.ui.layout.ContentScale.Crop) }
            if (state is coil3.compose.AsyncImagePainter.State.Error && held == null && known) Cover(null, title, artist, Modifier.fillMaxSize(), size = null, radius = 20.dp, shadow = false)
        } else if (known) {
            Cover(null, title, artist, Modifier.fillMaxSize(), size = null, radius = 20.dp, shadow = false)
        }
    }
    // the sleeve's inset ring (v1 .player-art-front)
    Box(Modifier.fillMaxSize().border(1.dp, Color(0x14FFFFFF), shape))
}

/** v1 playerFeedbackBlur: 0 → full at 14 %, held to 70 %, gone at 100 %. */
private fun feedbackBlur(t: Float): Float = when {
    t >= 1f -> 0f
    t < 0.14f -> t / 0.14f
    t < 0.7f -> 1f
    else -> 1f - (t - 0.7f) / 0.3f
}

/** v1 `.player-art-feedback`: the play/pause silhouette as polished glass, ~60 % of the
 *  cover, pulsing in (0.78 → 1 by 12 %), held, and swelling out (1.08) as it fades. */
@Composable
private fun FeedbackGlyph(t: Float, play: Boolean) {
    val alpha = when { t < 0.12f -> t / 0.12f; t < 0.7f -> 1f; else -> 1f - (t - 0.7f) / 0.3f }
    val scale = when { t < 0.12f -> 0.78f + 0.22f * t / 0.12f; t < 0.7f -> 1f; else -> 1f + 0.08f * (t - 0.7f) / 0.3f }
    Canvas(Modifier.fillMaxSize().graphicsLayer { this.alpha = alpha; scaleX = scale; scaleY = scale }) {
        val s = size.minDimension * 0.6f / 24f
        val ox = (size.width - 24f * s) / 2f
        val oy = (size.height - 24f * s) / 2f
        val path = Path().apply {
            if (play) {
                moveTo(ox + 7f * s, oy + 4f * s); lineTo(ox + 20f * s, oy + 12f * s); lineTo(ox + 7f * s, oy + 20f * s); close()
            } else {
                addRoundRect(androidx.compose.ui.geometry.RoundRect(ox + 5.5f * s, oy + 3.5f * s, ox + 10f * s, oy + 20.5f * s, 1.2f * s, 1.2f * s))
                addRoundRect(androidx.compose.ui.geometry.RoundRect(ox + 14f * s, oy + 3.5f * s, ox + 18.5f * s, oy + 20.5f * s, 1.2f * s, 1.2f * s))
            }
        }
        // the drop shadow traces the glyph (v1: drop-shadow 0 10px 22px), then the glass: an
        // opaque-ish base with a diagonal sheen, and a thin light rim
        drawIntoCanvas { cv ->
            val shadow = android.graphics.Paint().apply {
                isAntiAlias = true; color = 0x8C000000.toInt()
                maskFilter = android.graphics.BlurMaskFilter(22f, android.graphics.BlurMaskFilter.Blur.NORMAL)
            }
            cv.nativeCanvas.save(); cv.nativeCanvas.translate(0f, 10f)
            cv.nativeCanvas.drawPath(path.asAndroidPath(), shadow)
            cv.nativeCanvas.restore()
        }
        drawPath(path, Brush.linearGradient(listOf(Color(0xE6FFFFFF), Color(0xB3FFFFFF), Color(0xD9FFFFFF)),
            start = Offset(ox, oy), end = Offset(ox + 24f * s, oy + 24f * s)))
        drawPath(path, Color(0xB3FFFFFF), style = Stroke(width = 1.2f))
    }
}

/** v1 `.player-art-buffering`: a light veil and blur with a spinner, in 220 ms. */
@Composable
private fun BufferingVeil(k: Float) {
    val spin by rememberInfiniteTransition(label = "spin").animateFloat(0f, 360f, infiniteRepeatable(tween(800, easing = LinearEasing)), label = "spin")
    Box(Modifier.fillMaxSize().graphicsLayer { alpha = k }.clip(RoundedCornerShape(20.dp)).background(Color(0x2E08080C)), contentAlignment = Alignment.Center) {
        Canvas(Modifier.size(56.dp)) {
            rotate(spin) {
                drawCircle(Color(0x38FFFFFF), style = Stroke(width = 3.dp.toPx()))
                drawArc(Color(0xEBFFFFFF), -90f, 90f, useCenter = false, style = Stroke(width = 3.dp.toPx(), cap = androidx.compose.ui.graphics.StrokeCap.Round))
            }
        }
    }
}

/**
 * v1 `LyricsBackFace`: the reading face. The title is in the label voice, the lines in Lora
 * (a text serif, readable at phone size), a blank line kept as air.
 * - Synced lyrics: the sung line is brighter and kept a third of the way down. A scroll by
 *   the finger pauses that for 4 s.
 * - Runs of blank lines collapse into one gap, and `[Припев]`-style markers become small
 *   labels, not lines (2026-10-02, the owner asked for the lyrics to be fixed).
 * - A tap on a line asks the guru what stands behind it (v1 `InlineLyricExplain`); the
 *   answer opens under the line.
 */
@Composable
private fun LyricsBack(ctx: PlayerContext?, title: String, positionMs: Long, explain: Map<Int, Explain>, onExplain: (Int, String) -> Unit) {
    val dark = MusixTheme.isDark
    val body = if (dark) Color(0xFFD8D4C8) else Color(0xFF2A2620)
    val bright = if (dark) Color(0xFFF7EBCB) else Color(0xFF3A2A10)
    val head = if (dark) Color(0xFF7A7A80) else Color(0xFF8A8275)
    val synced = ctx?.synced.orEmpty()
    val lines: List<String> = when {
        ctx == null -> emptyList()
        synced.isNotEmpty() -> synced.map { it.text.trim() }
        else -> ctx.lyrics?.lines().orEmpty().map { it.trim() }
    }
    val cur = if (synced.isNotEmpty()) synced.indexOfLast { it.atMs <= positionMs + 250 } else -1
    val scroll = rememberScrollState()
    val tops = remember(lines) { IntArray(lines.size) }
    var viewport by remember { mutableIntStateOf(0) }
    var touchedAt by remember { mutableLongStateOf(0L) }
    var auto by remember { mutableStateOf(false) }
    LaunchedEffect(scroll.isScrollInProgress) { if (scroll.isScrollInProgress && !auto) touchedAt = System.currentTimeMillis() }
    LaunchedEffect(cur) {
        if (cur < 0 || System.currentTimeMillis() - touchedAt < 4_000) return@LaunchedEffect
        auto = true
        try { scroll.animateScrollTo((tops[cur] - viewport / 3).coerceAtLeast(0), tween(450)) } finally { auto = false }
    }
    val serif = MusixTheme.type.body.copy(fontFamily = ru.musixai.app.core.designsystem.MusixFontFamilies.SerifDisplay, fontStyle = androidx.compose.ui.text.font.FontStyle.Normal,
        fontSize = 16.sp, lineHeight = 1.62.em)
    Column(
        Modifier.fillMaxSize().clip(RoundedCornerShape(20.dp))
            .background(Brush.linearGradient(if (dark) listOf(Color(0xFF15151B), Color(0xFF1F1F29)) else listOf(Color(0xFFF6F5ED), Color(0xFFEDE9D8))))
            .border(1.dp, if (dark) Color(0x0FFFFFFF) else Color(0x14161620), RoundedCornerShape(20.dp))
            .onSizeChanged { viewport = it.height }
            .verticalScroll(scroll)
            .padding(horizontal = 22.dp, vertical = 20.dp),
    ) {
        Text("${title.uppercase()} · ТЕКСТ", style = MusixTheme.type.body.copy(fontSize = 9.5.sp, letterSpacing = 0.18.em, color = head))
        Spacer(Modifier.height(14.dp))
        if (lines.none { it.isNotBlank() }) {
            Text(if (ctx == null) "…" else "тексты ещё не добавлены", style = serif.copy(fontStyle = androidx.compose.ui.text.font.FontStyle.Italic, fontSize = 15.sp, color = head))
            return@Column
        }
        if (explain.isEmpty()) {
            Text("✨  Нажми на строку — гуру объяснит, что за ней стоит", Modifier.padding(bottom = 14.dp)
                .clip(RoundedCornerShape(12.dp)).background(if (dark) Color(0x1A7C5BFF) else Color(0x147C5BFF))
                .border(1.dp, if (dark) Color(0x4D7C5BFF) else Color(0x477C5BFF), RoundedCornerShape(12.dp))
                .padding(horizontal = 12.dp, vertical = 8.dp),
                style = MusixTheme.type.body.copy(fontSize = 12.5.sp, lineHeight = 1.4.em, color = if (dark) Color(0xD9D8CCFF) else Color(0xFF4A3A86)))
        }
        lines.forEachIndexed { i, line ->
            val pos = Modifier.onGloballyPositioned { tops[i] = it.positionInParent().y.toInt() }
            when {
                line.isBlank() -> if (i > 0 && lines[i - 1].isNotBlank()) Spacer(pos.height(14.dp)) else Spacer(pos)
                SECTION.matches(line) -> Text(line.trim('[', ']', '(', ')').uppercase(), pos.padding(top = 6.dp, bottom = 4.dp),
                    style = MusixTheme.type.body.copy(fontSize = 10.sp, letterSpacing = 0.16.em, fontWeight = FontWeight.SemiBold, color = head))
                else -> {
                    val on = i == cur
                    val col by animateColorAsState(when { on -> bright; cur >= 0 -> body.copy(alpha = 0.6f); else -> body }, tween(250), label = "line")
                    Text(line, pos.fillMaxWidth().pressable { onExplain(i, line) }.padding(vertical = 1.dp),
                        style = serif.copy(color = col, fontWeight = if (on) FontWeight.Medium else FontWeight.Normal))
                    when (val e = explain[i]) {
                        Explain.Loading -> ExplainCard("Гуру думает…", dark, muted = true)
                        is Explain.Done -> ExplainCard(e.text, dark, muted = false)
                        null -> {}
                    }
                }
            }
        }
        Spacer(Modifier.height(48.dp))  // the last line can rise to the reading third
    }
}

/** `[Припев]`, `[Verse 2: …]`, `(Chorus)`: a section marker, not a line to sing. */
private val SECTION = Regex("""^\s*[\[(][^\])]{1,40}[\])]\s*$""")

@Composable
private fun ExplainCard(text: String, dark: Boolean, muted: Boolean) {
    Text(text, Modifier.fillMaxWidth().padding(top = 4.dp, bottom = 10.dp)
        .clip(RoundedCornerShape(12.dp)).background(if (dark) Color(0x147C5BFF) else Color(0x0F7C5BFF))
        .padding(horizontal = 12.dp, vertical = 9.dp),
        style = MusixTheme.type.body.copy(fontSize = 13.sp, lineHeight = 1.5.em, color = (if (dark) Color(0xFFD8CCFF) else Color(0xFF4A3A86)).copy(alpha = if (muted) 0.7f else 1f)))
}

/** v1 `.player-lyrics-aura`: a flat accent wash behind the flipped cover, 700 ms fade. */
@Composable
fun LyricsAura(on: Boolean, accent: Color, modifier: Modifier = Modifier) {
    val a by animateFloatAsState(if (on) 1f else 0f, tween(700), label = "aura")
    if (a <= 0f) return
    val dark = MusixTheme.isDark
    Canvas(modifier) {
        // v1: accent 30% → 10% at 55% → clear at 98%. Evenly spaced stops look the same; those
        // exact stops, re-shaded every frame of the fade, crashed the emulator's renderer
        drawRect(Brush.radialGradient(
            listOf(accent.copy(alpha = (if (dark) 0.30f else 0.19f) * a), accent.copy(alpha = (if (dark) 0.10f else 0.07f) * a), Color.Transparent),
            center = Offset(size.width / 2, size.height * 0.52f), radius = size.maxDimension * 0.54f))
    }
}

/**
 * v1 `PlayerSpectrum`: a soft wave strip on each side of the cover, "entering the album",
 * tinted from the cover. v1 drove it from an AnalyserNode; here the track's energy
 * envelope (10 fps × 4 bands) at the playhead drives it — the recent frames flow inward
 * toward the cover — so no audio routing or RECORD_AUDIO is needed (phase 4 spec §4).
 */
@Composable
fun Spectrum(envelope: ByteArray?, positionMs: Long, playing: Boolean, tint: Color, modifier: Modifier = Modifier) {
    val n = 18
    val cur = remember { FloatArray(n) }
    val fade = remember { floatArrayOf(0f) }
    var tick by remember { mutableLongStateOf(0L) }
    LaunchedEffect(playing, envelope) {
        while (true) {
            androidx.compose.runtime.withFrameNanos { tick = it }
            if (!playing && fade[0] < 0.001f) break
        }
    }
    Canvas(modifier) {
        tick.let { }
        val frames = (envelope?.size ?: 0) / 4
        val f0 = (positionMs / 100).toInt()
        fade[0] += ((if (playing) 1f else 0f) - fade[0]) * 0.06f
        for (i in 0 until n) {
            val f = (f0 - i).coerceIn(0, (frames - 1).coerceAtLeast(0))
            val target = if (frames == 0) 0f else run {
                val e = envelope!!
                ((e[f * 4].toInt() and 255) * 0.45f + (e[f * 4 + 1].toInt() and 255) * 0.3f + (e[f * 4 + 2].toInt() and 255) * 0.15f + (e[f * 4 + 3].toInt() and 255) * 0.1f) / 255f
            }
            cur[i] += (target - cur[i]) * 0.28f
        }
        val half = size.width / 2f
        // a flat wave is nothing to draw (and a zero-area path is a renderer's edge case)
        if (size.height * 0.46f * fade[0] * (cur.maxOrNull() ?: 0f) < 0.5f) return@Canvas
        for (side in 0..1) {
            val path = Path()
            val h = size.height
            val amp = h * 0.46f * fade[0]
            fun x(i: Int) = if (side == 0) half - (i.toFloat() / (n - 1)) * half else half + (i.toFloat() / (n - 1)) * half
            path.moveTo(x(0), h / 2 - cur[0] * amp)
            for (i in 1 until n) path.quadraticTo(x(i - 1), h / 2 - cur[i - 1] * amp, (x(i - 1) + x(i)) / 2, h / 2 - (cur[i - 1] + cur[i]) / 2 * amp)
            for (i in n - 1 downTo 0) path.lineTo(x(i), h / 2 + cur[i] * amp)
            path.close()
            drawPath(path, Brush.horizontalGradient(
                if (side == 0) listOf(tint.copy(alpha = 0.10f), tint.copy(alpha = 0.55f), tint.copy(alpha = 0.92f))
                else listOf(tint.copy(alpha = 0.92f), tint.copy(alpha = 0.55f), tint.copy(alpha = 0.10f)),
                startX = if (side == 0) 0f else half, endX = if (side == 0) half else size.width))
        }
    }
}
