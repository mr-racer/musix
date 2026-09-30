package ru.musixai.app.feature.stats

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import app.musix.api.models.ImageData
import app.musix.api.models.StatsOut
import app.musix.api.models.TasteMapOut
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.onStart
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import ru.musixai.app.core.data.StatsRepository
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.core.designsystem.component.Cover
import ru.musixai.app.core.designsystem.component.Eyebrow
import ru.musixai.app.core.designsystem.component.Skel
import ru.musixai.app.core.designsystem.oklch
import ru.musixai.app.core.model.Image
import java.time.OffsetDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale
import javax.inject.Inject

data class StatsUi(val stats: StatsOut? = null, val map: TasteMapOut? = null)

@HiltViewModel
class StatsViewModel @Inject constructor(repo: StatsRepository) : ViewModel() {
    val ui: StateFlow<StatsUi> = combine(repo.stats, repo.map.onStart { emit(TasteMapOut(emptyList(), emptyList(), emptyList(), null, emptyList(), emptyList())) }) { s, m -> StatsUi(s, m) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), StatsUi())

    init { viewModelScope.launch { runCatching { repo.refresh() } } }
}

private fun ImageData.model() = Image(id, blurhash, width, height, null, urls.mapNotNull { (k, v) -> k.toIntOrNull()?.let { it to v } }.toMap())

/** v1 `StatsTab`: the listening widgets, the taste sonar, the rhythm, what you finish. */
@Composable
fun StatsRoute(vm: StatsViewModel = hiltViewModel()) {
    val ui by vm.ui.collectAsStateWithLifecycle()
    val s = ui.stats
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        if (s == null) { repeat(3) { Skel(Modifier.fillMaxWidth().height(96.dp), 18.dp) }; return@Column }
        val img = { id: String? -> id?.let { s.images[it]?.model() } }
        StatCard {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Eyebrow("Суммарно прослушано")
                    s.listening.since?.let { Text("с ${it.format(DateTimeFormatter.ofPattern("d MMM", Locale("ru")))}", Modifier.padding(top = 8.dp), style = MusixTheme.type.body.copy(fontSize = 14.sp, color = MusixTheme.colors.textMuted)) }
                }
                val h = s.listening.playedMs / 3_600_000L
                val m = s.listening.playedMs / 60_000L % 60
                Text("${h}ч ${m}м", style = MusixTheme.type.body.copy(fontSize = 34.sp, fontWeight = FontWeight.Bold, color = MusixTheme.colors.green))
            }
        }
        s.listening.topTrack?.let { t ->
            StatCard {
                Eyebrow("★ Топ-трек")
                Row(Modifier.padding(top = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                    Cover(img(t.track.coverImageId), t.track.title, t.track.artistDisplay, size = 44.dp)
                    Column(Modifier.padding(start = 14.dp)) {
                        Text(t.track.titleDisplay ?: t.track.title, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MusixTheme.type.body.copy(fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = MusixTheme.colors.text))
                        Text("${t.track.artistDisplay} · ${t.plays} ${plural(t.plays, "плей", "плея", "плеев")}", style = MusixTheme.type.body.copy(fontSize = 13.5.sp, color = MusixTheme.colors.textMuted))
                    }
                }
            }
        }
        s.listening.topArtist?.let { a ->
            StatCard {
                Eyebrow("★ Топ-артист")
                Row(Modifier.padding(top = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                    Cover(img(a.artist.imageId), a.artist.name, "", size = 44.dp)
                    Column(Modifier.padding(start = 14.dp)) {
                        Text(a.artist.name, style = MusixTheme.type.body.copy(fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = MusixTheme.colors.amber))
                        Text("${a.plays} ${plural(a.plays, "плей", "плея", "плеев")}", style = MusixTheme.type.body.copy(fontSize = 13.5.sp, color = MusixTheme.colors.textMuted))
                    }
                }
            }
        }
        Divider("сонар вкуса", 275f)
        ui.map?.takeIf { it.trackIds.isNotEmpty() }?.let { TasteMap(it) }
        Divider("таймлайн прослушиваний", 150f)
        Rhythm(s)
        Divider("что ты дослушиваешь", 275f)
        Engagement(s)
    }
}

internal fun plural(n: Int, one: String, few: String, many: String): String {
    val d10 = n % 10; val d100 = n % 100
    return if (d10 == 1 && d100 != 11) one else if (d10 in 2..4 && d100 !in 12..14) few else many
}

@Composable
private fun StatCard(content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit) {
    val c = MusixTheme.colors
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(22.dp))
        .background(Brush.linearGradient(listOf(Color(0xFF17171C), Color(0xFF0B0B0F))))
        .border(1.dp, c.border, RoundedCornerShape(22.dp)).padding(horizontal = 22.dp, vertical = 24.dp), content = content)
}

/** v1 `StatsDivider`: a dot and a tracked label between two fading hairlines in the hue. */
@Composable
private fun Divider(label: String, hue: Float) {
    val col = oklch(70f, 0.16f, hue)
    Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.weight(1f).height(2.dp).background(Brush.horizontalGradient(listOf(Color.Transparent, col.copy(alpha = 0.6f)))))
        Box(Modifier.padding(start = 12.dp).size(10.dp).clip(CircleShape).background(col))
        Text(label.uppercase(), Modifier.padding(horizontal = 12.dp), style = MusixTheme.type.mono.copy(fontSize = 13.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 0.2.em, color = col))
        Box(Modifier.weight(1f).height(2.dp).background(Brush.horizontalGradient(listOf(col.copy(alpha = 0.6f), Color.Transparent))))
    }
}

/** «Карта твоего звука»: every track on the 2-D taste map, coloured by district. */
@Composable
private fun TasteMap(m: TasteMapOut) {
    val c = MusixTheme.colors
    StatCard {
        Row {
            Text("КАРТА ТВОЕГО ЗВУКА", Modifier.weight(1f), style = MusixTheme.type.mono.copy(fontSize = 11.sp, letterSpacing = 0.2.em, color = c.textSubtle))
            Text("${m.trackIds.size} треков · ${m.clusters.size} районов", style = MusixTheme.type.body.copy(fontSize = 13.sp, color = c.textMuted))
        }
        val hues = m.clusters.associate { it.id to ((it.id * 67 + 190) % 360).toFloat() }
        Canvas(Modifier.padding(top = 14.dp).fillMaxWidth().aspectRatio(1.3f)) {
            val xs = m.x.map { it.toFloat() }; val ys = m.y.map { it.toFloat() }
            val x0 = xs.min(); val x1 = xs.max(); val y0 = ys.min(); val y1 = ys.max()
            for (i in xs.indices) {
                val px = (xs[i] - x0) / (x1 - x0).coerceAtLeast(1e-6f) * size.width
                val py = (ys[i] - y0) / (y1 - y0).coerceAtLeast(1e-6f) * size.height
                drawCircle(oklch(72f, 0.16f, hues[m.cluster[i]] ?: 275f, 0.85f), 3.2f, Offset(px, py))
            }
        }
        androidx.compose.foundation.layout.FlowRow(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            for (cl in m.clusters) Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(8.dp).clip(CircleShape).background(oklch(72f, 0.16f, hues[cl.id] ?: 275f)))
                Text(" ${cl.nameRu}", style = MusixTheme.type.body.copy(fontSize = 12.sp, color = c.textMuted))
            }
        }
    }
}

@Composable
private fun Rhythm(s: StatsOut) {
    val c = MusixTheme.colors
    val r = s.rhythm
    StatCard {
        Row(horizontalArrangement = Arrangement.spacedBy(20.dp)) {
            Readout("${r.streakCurrent}", "дней подряд", 150f)
            Readout("${r.streakBest}", "лучшая серия", 75f)
            r.busiestDay?.let { Readout("${it.count}", "в пик ${it.date.format(DateTimeFormatter.ofPattern("d MMM", Locale("ru")))}", 275f) }
        }
        val hours = r.byHour
        if (hours.isNotEmpty()) {
            Eyebrow("По часам", Modifier.padding(top = 20.dp, bottom = 8.dp))
            Canvas(Modifier.fillMaxWidth().height(64.dp)) {
                val mx = hours.max().coerceAtLeast(1)
                val bw = size.width / hours.size
                hours.forEachIndexed { h, n ->
                    val bh = size.height * n / mx
                    drawRoundRect(oklch(70f, 0.16f, 150f, if (n == mx) 1f else 0.55f), Offset(h * bw + bw * 0.18f, size.height - bh), Size(bw * 0.64f, bh.coerceAtLeast(2f)), CornerRadius(3f))
                }
            }
            Row(Modifier.fillMaxWidth()) {
                for (l in listOf("0", "6", "12", "18", "23")) Text(l, Modifier.weight(1f), style = MusixTheme.type.code.copy(fontSize = 10.sp, color = c.textSubtle))
            }
        }
    }
}

@Composable
private fun Readout(value: String, label: String, hue: Float) {
    Column {
        Text(value, style = MusixTheme.type.body.copy(fontSize = 26.sp, fontWeight = FontWeight.Bold, color = oklch(75f, 0.15f, hue)))
        Text(label, style = MusixTheme.type.body.copy(fontSize = 12.sp, color = MusixTheme.colors.textMuted))
    }
}

@Composable
private fun Engagement(s: StatsOut) {
    val c = MusixTheme.colors
    val e = s.engagement
    val pct = (e.overallCompletion.toFloat() * 100).coerceIn(0f, 100f)
    StatCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Canvas(Modifier.size(64.dp)) {
                drawArc(c.textSubtle.copy(alpha = 0.3f), -90f, 360f, false, style = Stroke(9f))
                drawArc(oklch(70f, 0.17f, 145f), -90f, 360f * pct / 100, false, style = Stroke(9f, cap = StrokeCap.Round))
            }
            Column(Modifier.padding(start = 16.dp)) {
                Text("${pct.toInt()}%", style = MusixTheme.type.body.copy(fontSize = 24.sp, fontWeight = FontWeight.Bold, color = c.text))
                Text("треков ты дослушиваешь до конца", style = MusixTheme.type.body.copy(fontSize = 13.sp, color = c.textMuted))
            }
        }
        if (e.loved.isNotEmpty()) {
            Eyebrow("Не отпускают", Modifier.padding(top = 20.dp, bottom = 8.dp))
            for (t in e.loved.take(5)) Row(Modifier.padding(vertical = 5.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(t.track.titleDisplay ?: t.track.title, Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis, style = MusixTheme.type.body.copy(fontSize = 14.sp, color = c.text))
                Spacer(Modifier.width(8.dp))
                Text("${(t.completion.toFloat() * 100).toInt()}%", style = MusixTheme.type.code.copy(fontSize = 12.sp, color = oklch(70f, 0.17f, 145f)))
            }
        }
    }
}
