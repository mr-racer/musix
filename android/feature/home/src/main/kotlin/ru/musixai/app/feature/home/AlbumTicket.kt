package ru.musixai.app.feature.home

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.expandHorizontally
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.shrinkHorizontally
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import ru.musixai.app.core.designsystem.HapticCue
import ru.musixai.app.core.designsystem.LocalMusixHaptics
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.core.designsystem.component.Cover
import ru.musixai.app.core.designsystem.component.PlayPauseGlyph
import ru.musixai.app.core.designsystem.component.LocalCoverFlight
import ru.musixai.app.core.designsystem.component.coverSource
import ru.musixai.app.core.designsystem.component.pressable
import ru.musixai.app.core.designsystem.component.rememberCoverSource
import ru.musixai.app.core.designsystem.hexColor
import ru.musixai.app.core.model.DayAlbum
import ru.musixai.app.core.model.Image
import java.time.LocalDate
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlin.math.cos
import kotlin.math.sin

/**
 * «Альбом дня», r3's ticket (≈ 210 dp, 186 dense): the cover 72 (56) with the label, title
 * and «artist · year · edition»; the phrase across, two lines at most, the next one every
 * three hours ([AlbumDayText.phraseSlot]); a bottom row of 48 with the progress slot and a
 * compact filled button (fill = songs heard, the 75 % notch, the two-tone label of r2).
 * The title is one line, or two a size smaller before an ellipsis (as tall as the cover).
 * «Слушать» folds the button away and the slot's line flows into beads, one per song (skits
 * smaller and dimmer), spread over the row, the current one breathing while the album plays —
 * the card's only constant motion. While the album is in the player the mini-player is its
 * control (the owner, 2026-11-14: no second «Слушать»); when something else replaces it, the
 * button comes back as «Продолжить». Crossing 75 % plays the finale: «Обыграна ✓» and the JoiPro.
 */
@Composable
internal fun AlbumTicket(
    d: DayAlbum,
    cover: Image?,
    dense: Boolean,
    extraHeard: Set<String>,
    albumPlaying: Boolean,
    isPlaying: Boolean,
    currentTrackId: String?,
    reduced: Boolean,
    onListen: () -> Unit,
    onOpen: () -> Unit,
    modifier: Modifier = Modifier,
    phraseSlot: Long = rememberPhraseSlot(),
) {
    val c = MusixTheme.colors
    val dark = MusixTheme.isDark
    val haptics = LocalMusixHaptics.current
    val p = AlbumDayText.progress(d.tracks, extraHeard)
    val phrases = remember(d) {
        AlbumDayText.phrases(d.kind, AlbumDayText.facts(d, LocalDate.now())).ifEmpty { listOf(Phrase(listOf("Пластинка на сегодня" to false))) }
    }
    var started by rememberSaveable(d.albumId, d.day) { mutableStateOf(false) }
    // «Слушать» tapped, the player has not taken the album yet: the button stays folded
    // (a start that never comes gives it back after 5 s)
    var pending by remember(d.albumId, d.day) { mutableStateOf(false) }
    LaunchedEffect(albumPlaying) { if (albumPlaying) pending = false }
    LaunchedEffect(pending) { if (pending) { delay(5_000); pending = false } }
    val button = !albumPlaying && !pending
    var finale by remember { mutableStateOf<String?>(null) }
    val flight = LocalCoverFlight.current
    val coverSrc = rememberCoverSource()
    var wasDone by remember(d.albumId, d.day) { mutableStateOf(p.done) }
    LaunchedEffect(p.done) {
        if (p.done && !wasDone) {
            haptics.perform(HapticCue.Confirm, fromUser = true)
            finale = AlbumDayText.finalePhrases().random()
            wasDone = true
            delay(FINALE_MS)
            finale = null
        }
        wasDone = p.done
    }
    val pal = cover?.palette
    val accent = (if (dark) pal?.accentLight ?: pal?.vibrant else pal?.accentDark ?: pal?.vibrant)?.let { hexColor(it) } ?: c.accent
    val base = (pal?.muted?.let { hexColor(it) } ?: c.accent).copy(alpha = if (dark) 0.38f else 0.22f)
    val onAccent = if (accent.luminance() > 0.5f) Color(0xFF15131C) else Color.White
    val shape = RoundedCornerShape(22.dp)
    val coverSize = if (dense) 56.dp else 72.dp
    val pad = if (dense) 12.dp else 14.dp
    val measurer = rememberTextMeasurer()
    val phraseStyle = MusixTheme.type.body.copy(fontSize = if (dense) 14.sp else 15.sp, lineHeight = 1.3.em, color = c.text)
    val captionStyle = MusixTheme.type.body.copy(fontSize = 13.sp, lineHeight = 1.25.em, color = c.textMuted)

    BoxWithConstraints(modifier.fillMaxWidth()) {
        // the three-hour turn keeps to the phrases that fit two lines at this width: an ellipsis
        // would cut the punchline (the names are already capped by Facts.songMax/artistMax)
        val phraseWidth = constraints.maxWidth - with(LocalDensity.current) { (pad + 4.dp + 10.dp).roundToPx() }
        val fitting = remember(phrases, phraseWidth, phraseStyle) {
            phrases.filter { !measurer.measure(it.annotated(), phraseStyle, maxLines = 2, constraints = Constraints(maxWidth = phraseWidth.coerceAtLeast(1))).hasVisualOverflow }.ifEmpty { phrases }
        }
        val index = AlbumDayText.phraseIndex(d.albumId, phraseSlot, fitting.size)
        val (name, edition) = remember(d.title) { AlbumDayText.edition(d.title) }
        Column(
            Modifier.fillMaxWidth().clip(shape)
                .background(if (dark) Color(0xB31C1922) else Color(0xD9FFFFFF))
                .drawBehind {  // the cover's glow, muted (as after the r2 fix)
                    drawCircle(Brush.radialGradient(listOf(accent.copy(alpha = if (dark) 0.16f else 0.10f), Color.Transparent), Offset(0f, 0f), size.width * 0.7f), size.width * 0.7f, Offset(0f, 0f))
                }
                .border(1.dp, c.border, shape)
                .padding(start = pad, end = 4.dp, top = pad, bottom = 2.dp),
        ) {
            Row(Modifier.padding(end = 10.dp), verticalAlignment = Alignment.Top) {
                Box(Modifier.pressable(onClick = onOpen)) {
                    Cover(cover, d.title, d.artist.orEmpty(), Modifier.coverSource(coverSrc).testTag("ticket-cover"), size = coverSize, radius = 12.dp)
                }
                BoxWithConstraints(Modifier.weight(1f).padding(start = 12.dp, top = 1.dp)) {
                    // one line at full size, else two a size smaller: with these line heights the
                    // two-line block is as tall as the cover 72 (the dense card grows by ≈ 12)
                    val one = MusixTheme.type.body.copy(fontSize = if (dense) 16.sp else 17.sp, fontWeight = FontWeight.SemiBold, lineHeight = 1.2.em, color = c.text)
                    val two = one.copy(fontSize = if (dense) 14.sp else 15.sp, lineHeight = if (dense) 16.sp else 17.sp)
                    val width = constraints.maxWidth
                    val wraps = remember(name, width, one) { measurer.measure(name, one, maxLines = 1, constraints = Constraints(maxWidth = width)).hasVisualOverflow }
                    Column {
                        Text("Альбом дня · ${AlbumDayText.dayLabel(d.day)}", maxLines = 1,
                            style = MusixTheme.type.body.copy(fontSize = 12.sp, lineHeight = 16.sp, color = c.textMuted))
                        Text(name, maxLines = if (wraps) 2 else 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = if (wraps) 1.dp else 2.dp).testTag("ticket-title"),
                            style = if (wraps) two else one)
                        Text(listOfNotNull(d.artist, d.year?.toString(), edition).joinToString(" · "), maxLines = 1, overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.padding(top = if (wraps) 0.dp else 1.dp).testTag("ticket-meta"), style = MusixTheme.type.body.copy(fontSize = 13.sp, lineHeight = 16.sp, color = c.textMuted))
                    }
                }
            }
            AnimatedContent(fitting[index], label = "phrase",
                transitionSpec = { fadeIn(tween(180)) togetherWith fadeOut(tween(180)) },
                modifier = Modifier.padding(top = if (dense) 6.dp else 8.dp, end = 10.dp)) { ph ->
                Text(ph.annotated(), Modifier.testTag("ticket-phrase"), minLines = 2, maxLines = 2, overflow = TextOverflow.Ellipsis,
                    style = phraseStyle)
            }
            Row(Modifier.fillMaxWidth().height(48.dp).padding(end = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                BoxWithConstraints(Modifier.weight(1f)) {
                    val slot = constraints.maxWidth
                    AnimatedContent(started || albumPlaying, label = "slot", transitionSpec = { fadeIn(tween(220)) togetherWith fadeOut(tween(140)) }) { beads ->
                        if (beads) Beads(d, extraHeard, p, accent, if (albumPlaying) currentTrackId else null, albumPlaying && isPlaying, reduced)
                        else Text(
                            when {
                                p.heard == 0 -> AnnotatedString(AlbumDayText.restCaption(d.tracks))
                                p.done -> AnnotatedString("Пластинка обыграна")
                                else -> remember(p, index, slot, captionStyle) { progressLine(p, index, slot, captionStyle, measurer) }
                            },
                            Modifier.testTag("ticket-caption"), maxLines = 2, overflow = TextOverflow.Ellipsis,
                            style = captionStyle,
                        )
                    }
                }
                // the button folds towards its edge as the beads spread into its place, and
                // unfolds the same way when another queue takes the player
                val fold = spring<IntSize>(dampingRatio = 0.9f, stiffness = 380f)
                AnimatedVisibility(
                    button,
                    enter = if (reduced) EnterTransition.None else expandHorizontally(fold, Alignment.Start) + fadeIn(tween(220, 80)) + scaleIn(tween(260), 0.85f),
                    exit = if (reduced) ExitTransition.None else shrinkHorizontally(fold, Alignment.End) + fadeOut(tween(140)) + scaleOut(tween(220), 0.85f),
                ) {
                    Row {
                        Spacer(Modifier.width(10.dp))
                        FillButton(
                            label = when {
                                finale != null -> "Обыграна"
                                started && p.heard > 0 && !p.done -> "Продолжить"
                                else -> AlbumDayText.buttonLabel(p)
                            },
                            fraction = p.fraction, accent = accent, onAccent = onAccent, base = base, onBase = c.text,
                            pause = false, won = finale != null, notch = !p.done,
                        ) {
                            flight?.launch(coverSrc, 12.dp)  // the cover flies to the mini-player
                            started = true
                            pending = true
                            onListen()
                        }
                    }
                }
            }
        }
        finale?.let { Finale(it, accent, onAccent, reduced, Modifier.matchParentSize()) { finale = null } }
    }
}

private const val FINALE_MS = 6_000L

/** The r2 countdown when it fits the slot on one line, the r3 mock's short one when not. */
private fun progressLine(p: AlbumDayText.Progress, variant: Int, widthPx: Int, style: TextStyle, m: TextMeasurer): AnnotatedString {
    val long = AlbumDayText.progressPhrase(p, variant)?.annotated() ?: return AnnotatedString("")
    if (!m.measure(long, style, maxLines = 1, constraints = Constraints(maxWidth = widthPx.coerceAtLeast(1))).hasVisualOverflow) return long
    return AlbumDayText.progressPhrase(p, variant, short = true)?.annotated() ?: long
}

private fun Phrase.annotated(): AnnotatedString = buildAnnotatedString {
    for ((s, bold) in parts) if (bold) withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { append(s) } else append(s)
}

/** The compact filled button: 40 visible / 48 to touch, as wide as its label. The fill is
 *  the share of songs heard; the notch marks 75 %; the label is two copies, the one over the
 *  fill clipped by the same edge (r2's Tidefill trick: a clip, not a blend). */
@Composable
private fun FillButton(
    label: String, fraction: Float, accent: Color, onAccent: Color, base: Color, onBase: Color,
    pause: Boolean, won: Boolean, notch: Boolean, onClick: () -> Unit,
) {
    val fill by animateFloatAsState(if (won) 1f else fraction, spring(dampingRatio = 0.8f, stiffness = 220f), label = "fill")
    val glyph by animateFloatAsState(if (pause) 1f else 0f, spring(dampingRatio = 0.8f, stiffness = 520f), label = "glyph")
    val pill = RoundedCornerShape(20.dp)
    Box(Modifier.heightIn(min = 48.dp).testTag("ticket-listen").pressable(onClick = onClick).semantics { contentDescription = label }, contentAlignment = Alignment.Center) {
        Box(Modifier.height(40.dp).widthIn(min = 92.dp).animateContentSize(spring(dampingRatio = 0.8f, stiffness = 400f)).clip(pill).background(base)
            .drawBehind {
                if (notch) {
                    val x = size.width * 0.75f
                    // two short ticks at the edges, like a ruler's: a line across would strike the label
                    val tick = 6.dp.toPx()
                    drawLine(onBase.copy(alpha = 0.4f), Offset(x, 0f), Offset(x, tick), 1.5.dp.toPx())
                    drawLine(onBase.copy(alpha = 0.4f), Offset(x, size.height - tick), Offset(x, size.height), 1.5.dp.toPx())
                }
            },
            contentAlignment = Alignment.Center) {
            Label(label, onBase, glyph, won)
            Box(Modifier.matchParentSize().drawWithContent {
                clipRect(right = size.width * fill) {
                    drawRect(accent)
                    this@drawWithContent.drawContent()
                }
            }, contentAlignment = Alignment.Center) { Label(label, onAccent, glyph, won) }
        }
    }
}

@Composable
private fun Label(text: String, color: Color, glyph: Float, won: Boolean) {
    Row(Modifier.padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        if (won) Text("✓", style = MusixTheme.type.body.copy(fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = color))
        else PlayPauseGlyph(glyph, Modifier.size(11.dp), color)
        Text(text, maxLines = 1, style = MusixTheme.type.body.copy(fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = color))
    }
}

/** One bead a song in album order: heard filled, the rest hollow, skits smaller and dimmer;
 *  the current one a ring that breathes while the album plays. They spread over the row
 *  (16 dp apart at most, so they follow the button folding away) and appear left to right,
 *  20 ms apart. More than 20 songs (or too tight a row) turn into ticks. No 75 % notch: the
 *  owner found it «ни о чём не говорит» (2026-11-14). */
@Composable
private fun Beads(d: DayAlbum, extraHeard: Set<String>, p: AlbumDayText.Progress, accent: Color, current: String?, breathing: Boolean, reduced: Boolean) {
    val c = MusixTheme.colors
    val n = d.tracks.size
    val entry = remember(d.albumId) { Animatable(if (reduced) 1f else 0f) }
    LaunchedEffect(d.albumId) { if (!reduced) entry.animateTo(1f, tween(n * 20 + 180, easing = LinearEasing)) }
    val breath = if (breathing && !reduced) {
        val t = rememberInfiniteTransition(label = "breath")
        t.animateFloat(0f, 1f, infiniteRepeatable(tween(1200), RepeatMode.Reverse), label = "b").value
    } else 0f
    Canvas(Modifier.fillMaxWidth().height(24.dp).semantics { contentDescription = "Услышано ${p.heard} из ${p.total}" }) {
        if (n == 0) return@Canvas
        val big = 8.dp.toPx()
        val small = 5.dp.toPx()
        val sizes = d.tracks.map { if (it.durationMs > AlbumDayText.SKIT_MS) big else small }
        val room = size.width - 4.dp.toPx()  // the card's inset at the right matches the left
        val gap = if (n > 1) ((room - sizes.sum()) / (n - 1)).coerceAtMost(16.dp.toPx()) else 0f
        val ticks = n > 20 || gap < 3.dp.toPx()
        val step = if (ticks) room / n else 0f
        val cy = size.height / 2
        val stroke = 1.2.dp.toPx()
        val ms = (n * 20 + 180).toFloat()
        var x = 0f
        d.tracks.forEachIndexed { i, tr ->
            val a = ((entry.value * ms - i * 20f) / 180f).coerceIn(0f, 1f)
            val heard = tr.heard || tr.id in extraHeard
            val song = tr.durationMs > AlbumDayText.SKIT_MS
            val dim = if (song) 1f else 0.55f
            val col = if (heard) accent else c.textSubtle
            if (ticks) {
                val tx = x + step / 2
                drawLine(col.copy(alpha = a * dim * (if (heard) 1f else 0.6f)), Offset(tx, cy - (if (song) 7f else 4f).dp.toPx()), Offset(tx, cy + (if (song) 7f else 4f).dp.toPx()), 2.dp.toPx())
                if (tr.id == current) drawCircle(accent.copy(alpha = a), 3.dp.toPx() * (1f + 0.3f * breath), Offset(tx, cy + 10.dp.toPx()))
                x += step
            } else {
                val r = sizes[i] / 2
                val cx = x + r
                if (heard) drawCircle(col.copy(alpha = a * dim), r, Offset(cx, cy))
                else drawCircle(col.copy(alpha = a * dim * 0.8f), r - stroke / 2, Offset(cx, cy), style = Stroke(stroke))
                if (tr.id == current) drawCircle(accent.copy(alpha = a * (0.9f - 0.4f * breath)), r + (3f + 2f * breath).dp.toPx(), Offset(cx, cy), style = Stroke(1.5.dp.toPx()))
                x += sizes[i] + gap
            }
        }
    }
}

/** The phrase's three-hour slot, checked once a minute (a state write that changes nothing
 *  recomposes nothing, so the idle home still draws no frames). */
@Composable
internal fun rememberPhraseSlot(): Long {
    var slot by remember { mutableLongStateOf(AlbumDayText.phraseSlot(System.currentTimeMillis())) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(60_000)
            slot = AlbumDayText.phraseSlot(System.currentTimeMillis())
        }
    }
    return slot
}

/** JoiPro over the card: a superellipse pops in on a spring, dust flies out once, the
 *  finale line; no rim glare. Gone after six seconds or a tap. */
@Composable
private fun Finale(text: String, accent: Color, onAccent: Color, reduced: Boolean, modifier: Modifier, onDone: () -> Unit) {
    val pop = remember { Animatable(if (reduced) 1f else 0.86f) }
    val dust = remember { Animatable(if (reduced) 1f else 0f) }
    LaunchedEffect(Unit) {
        if (reduced) return@LaunchedEffect
        coroutineScope {
            launch { pop.animateTo(1f, spring(dampingRatio = 0.55f, stiffness = 380f)) }
            dust.animateTo(1f, tween(900))
        }
    }
    val seeds = remember { List(22) { Triple(Math.random() * 6.283, 0.5 + Math.random() * 0.5, 2.0 + Math.random() * 2.5) } }
    Box(modifier.pressable(onClick = onDone), contentAlignment = Alignment.Center) {
        Canvas(Modifier.matchParentSize()) {
            if (dust.value >= 1f) return@Canvas
            val o = Offset(size.width / 2, size.height / 2)
            for ((ang, reach, r) in seeds) {
                val dist = (size.minDimension * 0.55f * reach.toFloat()) * dust.value
                drawCircle(accent.copy(alpha = 0.8f * (1f - dust.value)), r.toFloat().dp.toPx(), o + Offset(cos(ang).toFloat() * dist, sin(ang).toFloat() * dist))
            }
        }
        Column(
            Modifier.graphicsLayer { scaleX = pop.value; scaleY = pop.value }
                .clip(RoundedCornerShape(32))
                .background(Brush.verticalGradient(listOf(accent, accent.copy(alpha = 0.86f))))
                .padding(horizontal = 22.dp, vertical = 16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text("✓", style = MusixTheme.type.body.copy(fontSize = 26.sp, fontWeight = FontWeight.SemiBold, color = onAccent))
            Text(text, Modifier.padding(top = 4.dp), maxLines = 2, style = MusixTheme.type.body.copy(fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = onAccent))
        }
    }
}
