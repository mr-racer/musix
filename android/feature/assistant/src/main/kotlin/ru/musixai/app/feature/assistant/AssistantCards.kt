package ru.musixai.app.feature.assistant

import android.os.Build
import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.dropShadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.shadow.Shadow
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.BaselineShift
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import ru.musixai.app.core.data.AsxAnswer
import ru.musixai.app.core.data.AsxChoice
import ru.musixai.app.core.data.AsxPlaylist
import ru.musixai.app.core.data.AsxSearch
import ru.musixai.app.core.data.AsxTrack
import ru.musixai.app.core.data.AsxWho
import ru.musixai.app.core.designsystem.MusixFontFamilies
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.core.designsystem.component.Cover
import ru.musixai.app.core.designsystem.component.pressable
import ru.musixai.app.core.designsystem.component.rise
import ru.musixai.app.core.designsystem.oklch

/** v1 `ASX_INTENT_COLOR`: colour is the page's only legend. */
internal fun intentColor(intent: String?) = when (intent) {
    "lyrics_search" -> Color(0xFF6AC8FF); "audio_search" -> Color(0xFFB48CFF); "playlist" -> Color(0xFFFFB35C); else -> Color(0xFF5EE6C8)
}

@Composable
internal fun IntentDot(intent: String?, size: androidx.compose.ui.unit.Dp = 7.dp) {
    val col = intentColor(intent)
    Box(Modifier.size(size).dropShadow(CircleShape, Shadow(radius = 7.dp, color = col.copy(alpha = 0.8f))).background(col, CircleShape))
}

@Composable
internal fun AsxLabel(text: String, modifier: Modifier = Modifier) =
    Text(text, modifier.padding(bottom = 10.dp), style = MusixTheme.type.mono.copy(fontSize = 10.5.sp, letterSpacing = 0.18.em, color = MusixTheme.colors.textSubtle))

/** `.asx-pill`: a glass capsule — clarify options, provenance, follow-ups. */
@Composable
internal fun AsxPill(text: String, intent: String? = null, dot: Boolean = intent != null, onClick: (() -> Unit)? = null) {
    val c = MusixTheme.colors
    val dark = MusixTheme.isDark
    Row(Modifier.clip(RoundedCornerShape(999.dp)).background(if (dark) Color(0x0DFFFFFF) else Color(0x9EFFFFFF))
        .border(1.dp, if (dark) Color(0x1FFFFFFF) else Color(0x1A161620), RoundedCornerShape(999.dp))
        .then(if (onClick != null) Modifier.pressable(onClick = onClick) else Modifier).padding(horizontal = 13.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
        if (dot) IntentDot(intent)
        Text(text, style = MusixTheme.type.body.copy(fontSize = 12.5.sp, color = if (dark) Color(0xD9EEEEF3) else c.textMuted))
    }
}

/** `AsxTrackRow`: a groove row — index, cover, title/artist (and the curator's reason), ⤵ next, ▶. */
@Composable
internal fun AsxTrackRow(t: AsxTrack, index: Int?, onPlay: () -> Unit, onNext: (() -> Unit)?) {
    val c = MusixTheme.colors
    val dark = MusixTheme.isDark
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).pressable(onClick = onPlay).padding(horizontal = 12.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        index?.let { Text("$it", Modifier.width(18.dp), style = MusixTheme.type.mono.copy(fontSize = 11.sp, color = c.textSubtle), maxLines = 1) }
        Cover(t.cover, t.title, t.artist, size = 40.dp)
        Column(Modifier.weight(1f)) {
            Text(t.title, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MusixTheme.type.body.copy(fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold, color = c.text))
            Text(t.artist, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MusixTheme.type.body.copy(fontSize = 12.sp, color = c.textMuted))
            t.reason?.let { Text(it, Modifier.padding(top = 2.dp), maxLines = 1, overflow = TextOverflow.Ellipsis, style = MusixTheme.type.body.copy(fontSize = 11.5.sp, fontStyle = FontStyle.Italic, color = c.textSubtle)) }
        }
        if (onNext != null && t.id != null) Box(Modifier.size(28.dp).clip(CircleShape).background(if (dark) Color(0x0FFFFFFF) else Color(0x0D000000)).pressable(onClick = onNext),
            contentAlignment = Alignment.Center) { Text("⤵", style = MusixTheme.type.body.copy(fontSize = 13.sp, color = c.textMuted)) }
        Box(Modifier.size(28.dp).dropShadow(CircleShape, Shadow(radius = 6.dp, color = oklch(58f, 0.21f, 270f, 0.35f), offset = DpOffset(0.dp, 2.dp)))
            .background(Brush.verticalGradient(listOf(oklch(60f, 0.21f, 270f), oklch(48f, 0.22f, 285f))), CircleShape), contentAlignment = Alignment.Center) {
            Text("▶", Modifier.offset(x = 1.dp), style = MusixTheme.type.body.copy(fontSize = 10.sp, color = Color.White))
        }
    }
}

/** `AsxPlaylistCard`: the collage header (the tracks' own covers blurred into a wash), the fanned covers, the title, then the list. */
@Composable
internal fun PlaylistCard(p: AsxPlaylist, query: String, saved: Boolean, saving: Boolean, onPlay: (Int) -> Unit, onNext: (AsxTrack) -> Unit, onSave: () -> Unit) {
    val n = p.tracks.size
    Column(Modifier.padding(top = 18.dp).rise(distance = 8.dp, durationMs = 380)) {
        val shape = RoundedCornerShape(28.dp)
        Box(Modifier.fillMaxWidth().heightIn(min = 206.dp)
            .dropShadow(shape, Shadow(radius = 80.dp, spread = (-36).dp, color = Color(0x667C5BFF), offset = DpOffset(0.dp, 34.dp)))
            .clip(shape).background(Color(0xFF3A2F6B))) {
            val covers = p.tracks.mapNotNull { it.cover }
            // .asn-pl-mosaic: 4 × 2 cells, blurred and a touch saturated
            if (covers.isNotEmpty()) Column(Modifier.matchParentSize().graphicsLayer { scaleX = 1.12f; scaleY = 1.12f }
                .then(if (Build.VERSION.SDK_INT >= 31) Modifier.blur(22.dp) else Modifier)) {
                for (row in 0..1) Row(Modifier.weight(1f).fillMaxWidth()) {
                    for (col in 0..3) AsyncImage(covers[(row * 4 + col) % covers.size].url(256), null, Modifier.weight(1f).fillMaxSize(), contentScale = ContentScale.Crop)
                }
            }
            Box(Modifier.matchParentSize().background(Brush.verticalGradient(0f to Color(0x0F0A0814), 0.6f to Color(0x850A0814), 1f to Color(0xC20A0814))))
            Box(Modifier.matchParentSize().background(Brush.linearGradient(0f to Color.White.copy(alpha = 0.18f), 0.38f to Color.Transparent)))
            Column(Modifier.align(Alignment.BottomStart).padding(horizontal = 22.dp, vertical = 20.dp)) {
                Row(Modifier.padding(bottom = 12.dp)) {
                    p.tracks.take(4).forEachIndexed { i, t ->
                        Box(Modifier.offset(x = (-14 * i).dp).size(54.dp).clip(RoundedCornerShape(13.dp)).border(1.5.dp, Color.White.copy(alpha = 0.5f), RoundedCornerShape(13.dp))) {
                            Cover(t.cover, t.title, t.artist, Modifier.fillMaxSize(), size = null, radius = 11.dp, shadow = false)
                        }
                    }
                }
                Text(p.title ?: "Подборка", style = MusixTheme.type.title.copy(fontFamily = MusixFontFamilies.Playfair, fontSize = 23.sp, lineHeight = 1.12.em, color = Color.White))
                Text("$n ${ruTracks(n)}" + if (query.isNotBlank()) " · собрано по запросу «$query»" else "", Modifier.padding(top = 5.dp),
                    style = MusixTheme.type.body.copy(fontSize = 12.5.sp, color = Color.White.copy(alpha = 0.75f)))
                Row(Modifier.padding(top = 15.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    PlBtn("▶ Слушать все") { if (n > 0) onPlay(0) }
                    PlBtn(if (saved) "✓ Сохранено" else if (saving) "Сохраняю…" else "Сохранить", enabled = !saved && !saving, onClick = onSave)
                }
            }
        }
        Column(Modifier.padding(top = 14.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            p.tracks.forEachIndexed { i, t -> AsxTrackRow(t, i + 1, { onPlay(i) }, { onNext(t) }) }
        }
    }
}

@Composable
private fun PlBtn(text: String, enabled: Boolean = true, onClick: () -> Unit) {
    Text(text, Modifier.graphicsLayer { alpha = if (enabled) 1f else 0.6f }.clip(RoundedCornerShape(999.dp)).background(Color.White.copy(alpha = 0.14f))
        .border(1.dp, Color.White.copy(alpha = 0.24f), RoundedCornerShape(999.dp)).pressable(enabled, onClick).padding(horizontal = 17.dp, vertical = 9.dp),
        style = MusixTheme.type.body.copy(fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold, color = Color.White))
}

/** `AsxSearchCard`: the best hit as a card (with the matched lyric line), then «ещё совпадения». */
@Composable
internal fun SearchCard(s: AsxSearch, query: String, onPlay: (Int) -> Unit, onNext: (AsxTrack) -> Unit, onArtist: (String) -> Unit) {
    val c = MusixTheme.colors
    val dark = MusixTheme.isDark
    val rest = s.best?.let { b -> s.hits.filter { it.track.id != b.track.id } } ?: s.hits
    Column(Modifier.padding(top = 18.dp).rise(distance = 8.dp, durationMs = 380)) {
        s.message?.let { Text(it, Modifier.padding(bottom = 14.dp), style = MusixTheme.type.body.copy(fontSize = 14.5.sp, lineHeight = 1.6.em, color = c.text)) }
        s.best?.let { b ->
            Column(Modifier.fillMaxWidth().padding(bottom = 12.dp).clip(RoundedCornerShape(16.dp)).background(if (dark) Color(0x0DFFFFFF) else Color(0xB8FFFFFF))
                .border(1.dp, if (dark) Color(0x1AFFFFFF) else Color(0x17161620), RoundedCornerShape(16.dp)).pressable { onPlay(0) }.padding(14.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    Cover(b.track.cover, b.track.title, b.track.artist, size = 72.dp)
                    Column(Modifier.weight(1f)) {
                        Text(b.track.title, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MusixTheme.type.body.copy(fontSize = 17.sp, fontWeight = FontWeight.Bold, letterSpacing = (-0.01).em, color = c.text))
                        val artist = b.track.track?.artists?.firstOrNull()
                        Text(b.track.artist, Modifier.padding(top = 2.dp).then(if (artist != null) Modifier.pressable { onArtist(artist.id) } else Modifier),
                            style = MusixTheme.type.body.copy(fontSize = 13.5.sp, color = c.textMuted))
                    }
                }
                val line = b.matchedLine ?: b.lyrics?.let { l -> matchLine(l, query) }
                if (line != null && b.matchedOn != "audio") Text("«$line»", Modifier.padding(top = 11.dp),
                    style = MusixTheme.type.body.copy(fontFamily = MusixFontFamilies.SerifDisplay, fontStyle = FontStyle.Italic, fontSize = 14.sp, lineHeight = 1.5.em, color = c.textMuted))
            }
        }
        if (rest.isNotEmpty()) {
            AsxLabel("ЕЩЁ СОВПАДЕНИЯ")
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                rest.forEachIndexed { i, h -> AsxTrackRow(h.track, null, { onPlay(if (s.best != null) i + 1 else i) }, { onNext(h.track) }) }
            }
        }
    }
}

/** The lyric line nearest the query's words (v1 `LyricSnippet` when no line was matched). */
private fun matchLine(lyrics: String, query: String): String? {
    val words = query.lowercase().split(Regex("\\W+")).filter { it.length > 2 }.toSet()
    if (words.isEmpty()) return null
    return lyrics.lines().filter { it.isNotBlank() }.maxByOrNull { l -> words.count { it in l.lowercase() } }
        ?.takeIf { l -> words.any { it in l.lowercase() } }
}

/** `AsxAnswerCard`: the subject header (when the library knows who), the fact being explained,
 *  the answer with its [n] marks, the sources under a spoiler, the provenance, what you own, follow-ups. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun AnswerCard(a: AsxAnswer, query: String, onAsk: (String, ru.musixai.app.core.data.AsxOptions) -> Unit, contextId: String?,
                        onPlayRelated: (Int) -> Unit, onNext: (AsxTrack) -> Unit, onArtistSlug: (String) -> Unit) {
    val c = MusixTheme.colors
    val dark = MusixTheme.isDark
    var open by remember { mutableStateOf<Int?>(null) }
    var showSrc by remember { mutableStateOf(false) }
    val offline = a.evidence.isNotEmpty() && a.evidence.none { it.kind == "chunk" }
    val unexplained = a.focusFact != null && a.explained == false
    Column(Modifier.padding(top = 18.dp).rise(distance = 8.dp, durationMs = 380).animateContentSize()) {
        a.subject?.let { s ->
            Row(Modifier.padding(bottom = 13.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                Box(Modifier.size(64.dp).clip(if (s.kind == "artist") CircleShape else RoundedCornerShape(12.dp))) {
                    Cover(s.image, s.title.orEmpty(), s.subtitle.orEmpty(), Modifier.fillMaxSize(), size = null, radius = if (s.kind == "artist") 32.dp else 12.dp, shadow = false)
                }
                Column(Modifier.weight(1f)) {
                    AsxLabel(when (s.kind) { "artist" -> "АРТИСТ"; "album" -> "АЛЬБОМ"; else -> "ТРЕК" }, Modifier.padding(bottom = 0.dp))
                    Text(s.title.orEmpty(), style = MusixTheme.type.serif.copy(fontSize = 21.sp, lineHeight = 1.2.em, color = c.text))
                    s.subtitle?.let { Text(it, Modifier.padding(top = 2.dp), style = MusixTheme.type.body.copy(fontSize = 12.5.sp, color = c.textMuted)) }
                }
                s.artistSlug?.let { slug -> AsxPill("Страница артиста") { onArtistSlug(slug) } }
            }
        }
        a.focusFact?.let { f ->
            Column(Modifier.padding(bottom = 12.dp).fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(if (dark) Color(0x0F7C5BFF) else Color(0x0D7C5BFF)).padding(12.dp)) {
                AsxLabel("ОБЪЯСНЯЮ ФАКТ", Modifier.padding(bottom = 0.dp))
                Text(f, Modifier.padding(top = 5.dp), style = MusixTheme.type.body.copy(fontSize = 13.5.sp, lineHeight = 1.5.em, color = c.text))
            }
        }
        Text(markdown(a.text, a.evidence.map { it.n }.toSet(), dark) { n -> open = n; showSrc = true },
            style = MusixTheme.type.body.copy(fontSize = 14.5.sp, lineHeight = 1.65.em, color = if (unexplained) c.textMuted else c.text))
        if (a.evidence.isNotEmpty()) {
            Text("${if (showSrc) "▾" else "▸"} Источники · ${a.evidence.size}", Modifier.padding(top = 14.dp).pressable { showSrc = !showSrc; if (!showSrc) open = null },
                style = MusixTheme.type.body.copy(fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold, color = c.textMuted))
            if (showSrc) Column(Modifier.padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                for (e in a.evidence) Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp))
                    .background(when { open == e.n -> Color(0x247C5BFF); e.used -> Color(0x0F7C5BFF); else -> Color.Transparent })
                    .then(if (open == e.n) Modifier.border(1.dp, Color(0x597C5BFF), RoundedCornerShape(10.dp)) else Modifier).padding(horizontal = 10.dp, vertical = 8.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("${e.n}", style = MusixTheme.type.mono.copy(fontSize = 11.sp, color = c.textSubtle))
                    Column(Modifier.weight(1f)) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text(if (e.kind == "fact") "библиотека" else "веб", Modifier.clip(RoundedCornerShape(999.dp)).background(if (dark) Color(0x12FFFFFF) else Color(0x0F161620)).padding(horizontal = 7.dp, vertical = 1.dp),
                                style = MusixTheme.type.body.copy(fontSize = 11.sp, color = c.textMuted))
                            (e.source ?: e.url?.let(::host))?.let { Text(it, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MusixTheme.type.body.copy(fontSize = 11.sp, color = Color(0xFFC9BAFF))) }
                        }
                        Text(e.text, Modifier.padding(top = 4.dp), style = MusixTheme.type.body.copy(fontSize = 12.5.sp, lineHeight = 1.55.em, color = c.textMuted))
                    }
                }
            }
        }
        FlowRow(Modifier.padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (a.evidence.any { it.kind == "chunk" }) AsxPill("нашёл в интернете")
            if (offline) AsxPill("из твоей библиотеки")
            if (a.focusFact == null && a.grounded == false) AsxPill("только найденные источники, без формулировки ИИ")
            if (offline && query.isNotBlank()) AsxPill("Поискать в сети") {
                onAsk(query, ru.musixai.app.core.data.AsxOptions(intent = "general", allowWeb = true, focusKind = a.focusKind, focusFact = a.focusFact,
                    subjectTrackId = a.subject?.trackId, subjectArtistSlug = a.subject?.takeIf { it.trackId == null }?.artistSlug))
            }
        }
        if (a.related.isNotEmpty()) Column(Modifier.padding(top = 16.dp)) {
            AsxLabel("ЕСТЬ У ТЕБЯ")
            a.related.forEachIndexed { i, t -> AsxTrackRow(t, i + 1, { onPlayRelated(i) }, { onNext(t) }) }
        }
        val artistBest = a.subject?.takeIf { it.kind == "artist" }?.title
        if (a.focusFact == null && (a.followUps.isNotEmpty() || artistBest != null)) FlowRow(Modifier.padding(top = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(9.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
            for (q in a.followUps) AsxPill(q, "general") {
                onAsk(q, ru.musixai.app.core.data.AsxOptions(intent = "general", contextId = contextId, subjectTrackId = a.subject?.trackId,
                    subjectArtistSlug = a.subject?.takeIf { it.trackId == null }?.artistSlug))
            }
            artistBest?.let { name -> AsxPill("собери лучшее $name", "playlist") { onAsk("собери лучшее $name", ru.musixai.app.core.data.AsxOptions(intent = "playlist")) } }
        }
    }
}

/** A small markdown: paragraphs, "- " bullets, **bold**, *italic*; [n] → a tappable superscript pill (`.asx-cite`). */
private fun markdown(text: String, known: Set<Int>, dark: Boolean, onCite: (Int) -> Unit): AnnotatedString = buildAnnotatedString {
    val cite = SpanStyle(fontSize = 10.sp, fontWeight = FontWeight.Bold, color = if (dark) Color(0xFFC9BAFF) else Color(0xFF5B3FD4),
        background = Color(0x297C5BFF), baselineShift = BaselineShift(0.3f))
    val lines = text.trim().lines()
    lines.forEachIndexed { li, raw ->
        var line = raw
        if (line.trimStart().startsWith("- ") || line.trimStart().startsWith("* ")) line = "•  " + line.trimStart().drop(2)
        line = line.removePrefix("### ").removePrefix("## ").removePrefix("# ")
        var i = 0
        val re = Regex("""\*\*(.+?)\*\*|\*(.+?)\*|\[(\d+(?:\s*,\s*\d+)*)]""")
        for (m in re.findAll(line)) {
            append(line.substring(i, m.range.first))
            when {
                m.groupValues[1].isNotEmpty() -> withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append(m.groupValues[1]) }
                m.groupValues[2].isNotEmpty() -> withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { append(m.groupValues[2]) }
                else -> for (n in m.groupValues[3].split(Regex("\\s*,\\s*")).mapNotNull { it.toIntOrNull() }.filter { it in known }) {
                    withLink(LinkAnnotation.Clickable("cite$n", TextLinkStyles(cite)) { onCite(n) }) { append(" $n ") }
                }
            }
            i = m.range.last + 1
        }
        append(line.substring(i))
        if (li < lines.lastIndex) append("\n")
    }
}

private fun host(url: String) = runCatching { java.net.URI(url).host?.removePrefix("www.") }.getOrNull()

/** Clarify: «не уверен, что именно нужно» + one pill per branch. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun ClarifyRow(options: List<AsxChoice>, onPick: (AsxChoice) -> Unit) {
    Column(Modifier.fillMaxWidth().padding(top = 18.dp).rise(distance = 8.dp, durationMs = 380), horizontalAlignment = Alignment.CenterHorizontally) {
        Text("Не уверен, что именно нужно", Modifier.padding(bottom = 10.dp), style = MusixTheme.type.body.copy(fontSize = 13.5.sp, color = MusixTheme.colors.textMuted))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(9.dp, Alignment.CenterHorizontally), verticalArrangement = Arrangement.spacedBy(9.dp)) {
            for (o in options) AsxPill(o.label, o.intent) { onPick(o) }
        }
    }
}

/** Disambiguate: «О КОМ РЕЧЬ?» — a rail of candidate cards. */
@Composable
internal fun WhoRail(options: List<AsxWho>, onPick: (AsxWho) -> Unit) {
    val c = MusixTheme.colors
    val dark = MusixTheme.isDark
    Column(Modifier.padding(top = 18.dp).rise(distance = 8.dp, durationMs = 380)) {
        AsxLabel("О КОМ РЕЧЬ?")
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            for (o in options) Row(Modifier.width(190.dp).clip(RoundedCornerShape(16.dp)).background(if (dark) Color(0x0DFFFFFF) else Color(0xB8FFFFFF))
                .border(1.dp, if (dark) Color(0x1AFFFFFF) else Color(0x17161620), RoundedCornerShape(16.dp)).pressable { onPick(o) }.padding(12.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Cover(o.cover, o.title, o.subtitle.orEmpty(), size = 40.dp)
                Column(Modifier.weight(1f)) {
                    Text(o.title, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MusixTheme.type.body.copy(fontSize = 13.sp, color = c.text))
                    o.subtitle?.let { Text(it, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MusixTheme.type.body.copy(fontSize = 11.5.sp, color = c.textMuted)) }
                }
            }
        }
    }
}

internal fun ruTracks(n: Int): String {
    val m10 = n % 10; val m100 = n % 100
    return if (m10 == 1 && m100 != 11) "трек" else if (m10 in 2..4 && (m100 < 10 || m100 >= 20)) "трека" else "треков"
}

