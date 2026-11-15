package ru.musixai.app.feature.artist

import androidx.compose.ui.geometry.CornerRadius
import ru.musixai.app.core.designsystem.text
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.*
import ru.musixai.app.core.designsystem.MusixIcons
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.core.designsystem.gesture.Press
import ru.musixai.app.core.designsystem.gesture.pressable
import ru.musixai.app.core.designsystem.surface.glassInk

/** The metal of a level as text: its gradient on dark, the deeper one on light. */
@Composable
private fun metalInk(l: Level): Brush = Brush.linearGradient(if (MusixTheme.isDark) l.ink else l.inkLight)

/**
 * «Ты и …» — how often the listener has the artist on and how far along the fan's way they are:
 * the level in its metal and five beads, the radio meter, one line of numbers and what the next
 * step wants (with its bar). A tap opens «Путь фаната» out of it ([onOpen] gets the card): the card
 * itself grows into the panel, its edge and all (MorphMenu's MorphFrom: [youFill], the hairline, [YouRadius]).
 */
@Composable
internal fun YouStrip(ui: ArtistUi, onOpen: (LayoutCoordinates) -> Unit, modifier: Modifier = Modifier, alpha: () -> Float = { 1f }) {
    val c = MusixTheme.colors
    val l = ui.standing.level
    var coords by remember { mutableStateOf<LayoutCoordinates?>(null) }
    val shape = RoundedCornerShape(YouRadius)
    // measured outside the press: the morph starts from the card at rest
    Box(
        modifier.fillMaxWidth().onGloballyPositioned { coords = it }.graphicsLayer { this.alpha = alpha() }
            .semantics { contentDescription = "Ты и ${ui.name}: ${l.name}, ${ui.air.name}" }
            .pressable(role = Press.Row) { coords?.let(onOpen) }
            .background(youFill(), shape).border(1.dp, c.border, shape),
    ) { YouFace(ui) }
}

/** The card's corner and fill: what «Путь фаната» starts from. */
internal val YouRadius = 20.dp

@Composable
internal fun youFill(): Color = if (MusixTheme.isDark) Color.White.copy(alpha = 0.045f) else Color.Black.copy(alpha = 0.03f)

/** What the card says — drawn in the card and riding in the morph's corner as it grows. */
@Composable
internal fun YouFace(ui: ArtistUi) {
    val c = MusixTheme.colors
    val st = ui.standing
    val l = st.level
    Column(Modifier.fillMaxWidth().padding(start = 16.dp, end = 14.dp, top = 14.dp, bottom = 16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Ты и ${ui.name}", Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis,
                style = MusixTheme.text.body.copy(fontSize = 17.sp, fontWeight = FontWeight.SemiBold, letterSpacing = (-0.015).em, color = c.text))
            Icon(MusixIcons.ChevronRight, null, Modifier.size(18.dp), tint = c.textSubtle)
        }
        Row(Modifier.padding(top = 11.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(l.name.uppercase(), style = TextStyle(fontFamily = MusixTheme.text.cap.fontFamily, fontWeight = FontWeight.Bold, fontSize = 12.sp, letterSpacing = 0.14.em, brush = metalInk(l)), maxLines = 1)
            Spacer(Modifier.width(9.dp))
            Beads(st.k, l)
            Spacer(Modifier.weight(1f).widthIn(min = 10.dp))
            Bars(ui.air.bars)
            Spacer(Modifier.width(8.dp))
            Text(ui.air.name, maxLines = 1, style = MusixTheme.text.caption.copy(fontSize = 13.sp, color = c.textMuted))
        }
        val s = if (ui.plays > 0) "${ui.plays} ${playsW(ui.plays)} · ${ui.heardTracks} из ${ui.tracks} ${songsOf(ui.tracks)}" + (if (ui.air.line.isNotEmpty()) " · ${ui.air.line}" else "")
        else "Ещё ни одной песни. Начни с «${ui.albums.firstOrNull()?.clean.orEmpty()}» — с него всё и началось."
        Text(s, Modifier.padding(top = 9.dp), style = MusixTheme.text.reading.copy(fontSize = 14.5.sp, lineHeight = 21.sp, color = c.textMuted))
        Text(if (st.needTo != null) "До уровня «${st.needTo}» — ${st.needRest}" else "Легенда — выше только сцена", Modifier.padding(top = 11.dp),
            style = MusixTheme.text.caption.copy(fontSize = 13.sp, color = c.textSubtle))
        val nx = st.next
        if (nx != null) {
            val track = if (MusixTheme.isDark) Color.White.copy(alpha = 0.1f) else Color.Black.copy(alpha = 0.08f)
            val fill = Brush.horizontalGradient(nx.face)
            Box(Modifier.padding(top = 7.dp).fillMaxWidth().height(3.dp).background(track, RoundedCornerShape(2.dp)).drawBehind {
                drawRoundRect(fill, size = size.copy(width = size.width * st.p.coerceIn(0f, 1f)), cornerRadius = CornerRadius(2.dp.toPx()))
            })
        }
    }
}

@Composable
private fun Beads(k: Int, l: Level) {
    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        for (j in LEVELS.indices) {
            val on = j <= k
            Box(Modifier.size(7.dp).drawBehind {
                if (on) drawCircle(Brush.linearGradient(l.face)) else drawCircle(l.metal.copy(alpha = 0.7f), radius = size.minDimension / 2f - 0.65.dp.toPx(), style = Stroke(1.3.dp.toPx()))
            })
        }
    }
}

@Composable
private fun Bars(on: Int) {
    val c = MusixTheme.colors
    val off = if (MusixTheme.isDark) Color.White.copy(alpha = 0.17f) else Color.Black.copy(alpha = 0.17f)
    Row(Modifier.height(16.dp), verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(2.dp)) {
        floatArrayOf(6f, 8.5f, 11f, 13.5f, 16f).forEachIndexed { j, h ->
            Box(Modifier.size(3.dp, h.dp).background(if (j < on) c.text else off, RoundedCornerShape(1.dp)))
        }
    }
}

/** «Путь фаната»: the five steps from the top one down, the ones taken in their metal. */
@Composable
internal fun FanPath(ui: ArtistUi) {
    val c = MusixTheme.colors
    val st = ui.standing
    val ink = c.text
    Column(Modifier.padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 14.dp)) {
        Text("ПУТЬ ФАНАТА · ${ui.name.uppercase()}", maxLines = 1, overflow = TextOverflow.Ellipsis, style = MusixTheme.text.cap.copy(color = c.textSubtle))
        Text(if (st.k == 4) "Легенда — выше только сцена." else "Сейчас — «${st.level.name}». Следующая ступень — «${LEVELS[st.k + 1].name}».",
            Modifier.padding(top = 6.dp, bottom = 12.dp),
            style = MusixTheme.text.title.copy(fontSize = 20.sp, fontWeight = FontWeight.Bold, lineHeight = 25.sp, letterSpacing = (-0.02).em, color = c.text))
        val rows = LEVELS.indices.reversed().toList()
        rows.forEachIndexed { r, j ->
            val lv = LEVELS[j]
            val got = j <= st.k
            val cur = j == st.k
            val right = when {
                got -> "взят"
                j == st.k + 1 && st.needRest != null -> if (st.byPlays) "ещё ${st.needN} ${timesW(st.needN)}" else st.needRest.replace("дослушать ещё", "ещё")
                else -> ""
            }
            val line = if (got) lv.metal.copy(alpha = 0.5f) else ink.copy(alpha = 0.12f)
            Row(
                Modifier.fillMaxWidth().heightIn(min = 50.dp)
                    .background(if (cur) ink.copy(alpha = 0.06f) else Color.Transparent, RoundedCornerShape(12.dp))
                    .drawBehind {
                        // the line through the dots, from the first row's middle to the last one's
                        val x = 17.dp.toPx()
                        val y0 = if (r == 0) size.height / 2f else -10.dp.toPx()
                        val y1 = if (r == rows.lastIndex) size.height / 2f else size.height + 10.dp.toPx()
                        drawLine(line, Offset(x, y0), Offset(x, y1), 1.5.dp.toPx())
                    }
                    .padding(horizontal = 8.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(Modifier.width(20.dp), contentAlignment = Alignment.Center) {
                    val float = if (MusixTheme.isDark) Color(0xFF1C1A24) else Color.White
                    Box(Modifier.size(12.dp).drawBehind {
                        if (got) { drawCircle(float, radius = size.minDimension / 2f + 2.dp.toPx()); drawCircle(Brush.linearGradient(lv.face)) }
                        else { drawCircle(float); drawCircle(lv.metal.copy(alpha = 0.7f), radius = size.minDimension / 2f - 0.75.dp.toPx(), style = Stroke(1.5.dp.toPx())) }
                    })
                }
                Column(Modifier.weight(1f).padding(horizontal = 10.dp)) {
                    Text(lv.name, style = TextStyle(fontFamily = MusixTheme.text.body.fontFamily, fontWeight = FontWeight.SemiBold, fontSize = 15.sp).let {
                        if (got) it.copy(brush = metalInk(lv)) else it.copy(color = c.text)
                    })
                    Text(lv.rule, Modifier.padding(top = 1.dp), style = MusixTheme.text.caption.copy(fontSize = 12.5.sp, color = c.textSubtle))
                }
                Text(right, maxLines = 1, style = MusixTheme.text.number.copy(fontSize = 12.sp, color = if (got) c.textMuted else c.textSubtle))
            }
        }
    }
}

/** The Grammy case: the number, the place among the library's laureates, a shelf of statues. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun GrammyCase(ui: ArtistUi) {
    val g = ui.grammy ?: return
    val w = g.wins
    val n = g.nominations
    val hollow = maxOf(0, n - w)
    val total = w + hollow
    val gw = if (total > 32) 10.dp else if (total > 22) 12.dp else 14.dp
    val ink = glassInk()
    val ink2 = glassInk(soft = true)
    val gold = if (MusixTheme.isDark) Color(0xFFF0D48A) else Color(0xFF9A6F16)
    Column(Modifier.padding(16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(13.dp)) {
            val num = TextStyle(fontFamily = MusixTheme.text.title.fontFamily, fontWeight = FontWeight.ExtraBold, fontSize = 46.sp, lineHeight = 40.sp, letterSpacing = (-0.05).em)
            Text("${if (w > 0) w else n}", style = if (w > 0) num.copy(brush = GoldText) else num.copy(color = Color(0xFFE3C37A)))
            Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
                Text("ГРЭММИ", style = MusixTheme.text.cap.copy(fontWeight = FontWeight.SemiBold, color = ink))
                Text(
                    buildAnnotatedString {
                        if (w > 0) {
                            withStyle(SpanStyle(color = gold, fontWeight = FontWeight.SemiBold)) { append("№${g.position}") }
                            append(" из ${g.laureates} ${plural(g.laureates, "лауреата", "лауреатов", "лауреатов")} твоей библиотеки")
                            if (n > 0) append(" · $n ${nomsW(n)}")
                        } else append("$n ${nomsW(n)} — и ни одной статуэтки. Академия, ну.")
                    },
                    style = MusixTheme.text.caption.copy(fontSize = 13.sp, lineHeight = 17.5.sp, color = ink2),
                )
            }
        }
        val line = Brush.horizontalGradient(listOf(Color.Transparent, Color(0x66FFECBE), Color(0x66FFECBE), Color.Transparent))
        FlowRow(
            Modifier.padding(top = 13.dp).fillMaxWidth().drawBehind { drawRect(line, Offset(0f, size.height - 1f), size.copy(height = 1f)) }.padding(bottom = 5.dp),
            horizontalArrangement = Arrangement.spacedBy(1.dp), verticalArrangement = Arrangement.spacedBy(5.dp),
        ) {
            repeat(w) { Statue(true, gw) }
            repeat(hollow) { Statue(false, gw) }
        }
    }
}
