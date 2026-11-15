package ru.musixai.app.feature.artist

import ru.musixai.app.core.designsystem.text
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.core.designsystem.content.TrackRow
import ru.musixai.app.core.designsystem.gesture.Press
import ru.musixai.app.core.designsystem.gesture.pressable
import ru.musixai.app.core.designsystem.surface.GlassTone
import ru.musixai.app.core.designsystem.surface.Sheet
import ru.musixai.app.core.designsystem.surface.glassInk

@Composable
internal fun SheetTitle(title: String, aside: String?) {
    Row(Modifier.fillMaxWidth().padding(start = 22.dp, end = 22.dp, bottom = 10.dp), verticalAlignment = androidx.compose.ui.Alignment.Bottom) {
        Text(title, Modifier.weight(1f), style = MusixTheme.text.title.copy(fontSize = 20.sp, fontWeight = FontWeight.Bold, letterSpacing = (-0.02).em, color = glassInk()))
        if (aside != null) Text(aside, style = MusixTheme.text.caption.copy(fontSize = 13.sp, color = glassInk(soft = true)), maxLines = 1)
    }
}

/**
 * The biography — matte glass (the owner, 2026-11-15: what is read stands on matte glass): where
 * the name comes from, the text in paragraphs, and «А ты знал»: a tap shows the next fact in a box
 * as tall as the tallest one, so nothing under it jumps.
 */
@Composable
internal fun BioSheet(open: Boolean, ui: ArtistUi, onClose: () -> Unit) {
    Sheet(open, onClose, glass = GlassTone.Deep, scrim = 0.3f) {
        SheetTitle("Биография", ui.name)
        val ink = glassInk()
        val ink2 = glassInk(soft = true)
        val box = if (MusixTheme.isDark) Color.White.copy(alpha = 0.07f) else Color.Black.copy(alpha = 0.05f)
        Column(Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState()).padding(start = 22.dp, end = 22.dp, bottom = 24.dp)) {
            if (ui.nameOrigin != null) Column(Modifier.fillMaxWidth().background(box, RoundedCornerShape(16.dp)).padding(14.dp)) {
                Text("ОТКУДА ИМЯ", style = MusixTheme.text.cap.copy(color = ink2))
                Text(ui.nameOrigin, Modifier.padding(top = 7.dp), style = MusixTheme.text.reading.copy(fontSize = 15.sp, lineHeight = 22.sp, color = ink))
            }
            Column(Modifier.padding(top = if (ui.nameOrigin != null) 16.dp else 0.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                for (p in remember(ui.bio) { paragraphs(ui.bio) }) Text(p, style = MusixTheme.text.reading.copy(fontSize = 16.sp, lineHeight = 25.sp, color = ink))
            }
            if (ui.facts.isNotEmpty()) {
                var i by remember { mutableIntStateOf(0) }
                Column(
                    Modifier.padding(top = 20.dp).fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(box)
                        .then(if (ui.facts.size > 1) Modifier.pressable(role = Press.Card) { i = (i + 1) % ui.facts.size } else Modifier)
                        .padding(14.dp),
                ) {
                    Row {
                        Text("А ТЫ ЗНАЛ", Modifier.weight(1f), style = MusixTheme.text.cap.copy(color = ink2))
                        Text("${i + 1} / ${ui.facts.size}", style = MusixTheme.text.number.copy(fontSize = 12.sp, color = ink2))
                    }
                    // every fact is laid out; only the current one shows — the box keeps the tallest height
                    Box(Modifier.padding(top = 7.dp)) {
                        ui.facts.forEachIndexed { j, f ->
                            val a by animateFloatAsState(if (j == i) 1f else 0f, tween(220), label = "fact")
                            Text(f, Modifier.graphicsLayer { alpha = a; translationY = (1f - a) * 6.dp.toPx() },
                                style = MusixTheme.text.reading.copy(fontSize = 15.5.sp, lineHeight = 23.sp, color = ink))
                        }
                    }
                    if (ui.facts.size > 1) Text("Коснись — следующий факт", Modifier.padding(top = 8.dp), style = MusixTheme.text.caption.copy(fontSize = 12.5.sp, color = ink2))
                }
            }
        }
    }
}

/** A song of the artist in the songs sheet. */
internal data class Song(val track: ru.musixai.app.core.model.Track, val plays: Int, val album: String?, val art: String?)

/** All the artist's songs, the most played first — matte glass, rows with covers. */
@Composable
internal fun SongsSheet(open: Boolean, list: List<Song>?, now: String?, playing: Boolean, queued: (String) -> Int, onPlay: (Int) -> Unit, onQueue: (String) -> Unit, onClose: () -> Unit) {
    Sheet(open, onClose, glass = GlassTone.Deep, scrim = 0.3f) {
        val n = list?.size ?: 0
        SheetTitle(if (list == null) "Песни" else "$n ${songs(n)}", "чаще — выше")
        if (list == null) {
            Column(Modifier.padding(22.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                repeat(6) { ru.musixai.app.core.designsystem.content.Skel(Modifier.fillMaxWidth((60 + (it * 37) % 35) / 100f).height(16.dp), 8.dp) }
            }
            return@Sheet
        }
        LazyColumn(Modifier.weight(1f, fill = false).padding(start = 14.dp, end = 10.dp), contentPadding = PaddingValues(bottom = 16.dp)) {
            itemsIndexed(list, key = { _, s -> s.track.id }) { i, s ->
                TrackRow(
                    title = s.track.title, number = "${i + 1}", duration = clock(s.track.durationMs), onClick = { onPlay(i) },
                    sub = listOfNotNull(s.album?.let { cleanTitle(it).first }, if (s.plays > 0) "${s.plays} ${timesW(s.plays)}" else "ещё не слушал").joinToString(" · "),
                    now = s.track.id == now, playing = playing, queued = queued(s.track.id), onQueue = { onQueue(s.track.id) },
                    art = { AsyncImage(s.art, null, Modifier.fillMaxSize().clip(RoundedCornerShape(6.dp)), contentScale = ContentScale.Crop) },
                )
            }
        }
    }
}
