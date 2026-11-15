package ru.musixai.app.core.designsystem.content

import ru.musixai.app.core.designsystem.text
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.StartOffset
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ru.musixai.app.core.designsystem.MusixIcons
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.core.designsystem.gesture.HapticCue
import ru.musixai.app.core.designsystem.gesture.Press
import ru.musixai.app.core.designsystem.gesture.pressable
import ru.musixai.app.core.designsystem.motion.popIn
import ru.musixai.app.core.designsystem.motion.rememberReducedMotion

/**
 * «Эквалайзер» (EQ, spec §6): three bars of the playing row, still while the song is paused.
 * Moved here from the player's queue (its second user is the track row).
 */
@Composable
fun Eq(playing: Boolean, color: Color, modifier: Modifier = Modifier, height: Dp = 14.dp) {
    val reduced = rememberReducedMotion()
    Row(modifier.height(height), horizontalArrangement = Arrangement.spacedBy(2.dp), verticalAlignment = Alignment.Bottom) {
        val base = floatArrayOf(0.4f, 1f, 0.65f)
        if (playing && !reduced) {
            val t = rememberInfiniteTransition(label = "eq")
            for (i in 0..2) {
                val h by t.animateFloat(0.25f, 1f, infiniteRepeatable(tween(900), RepeatMode.Reverse, initialStartOffset = StartOffset(300 * i)), label = "eq$i")
                Box(Modifier.width(3.dp).height(height).graphicsLayer { scaleY = h; transformOrigin = TransformOrigin(0.5f, 1f) }.background(color, RoundedCornerShape(1.5.dp)))
            }
        } else for (i in 0..2) Box(Modifier.width(3.dp).height(height * base[i]).background(color, RoundedCornerShape(1.5.dp)))
    }
}

/**
 * «Строка трека» (TrackRow, spec §6 — the album, the artist's songs; later the playlist and the
 * assistant): 48 dp. The number, which an [Eq] replaces while the row is [now]; the title and the
 * [sub] (feat.) on one line; the fire on the most played ([hot]); a dot on one not heard yet
 * ([new]); the time; and «Играть следующим», which becomes the row's place in the queue
 * ([queued], 1 = next) and takes it back on a second tap. With [art] the cover stands instead of
 * the number and the [sub] goes under the title. Gives to .99; the queue button says Confirm.
 */
@Composable
fun TrackRow(
    title: String,
    number: String,
    duration: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    sub: String? = null,
    now: Boolean = false,
    playing: Boolean = false,
    hot: Boolean = false,
    new: Boolean = false,
    queued: Int = 0,
    onQueue: (() -> Unit)? = null,
    accent: Color = MusixTheme.colors.accent,
    divider: Boolean = true,
    art: (@Composable () -> Unit)? = null,
) {
    val c = MusixTheme.colors
    val hair = c.border
    val two = art != null
    Row(
        modifier.fillMaxWidth().heightIn(min = 48.dp)
            .semantics { contentDescription = title + (sub?.let { ", $it" } ?: "") }
            .pressable(role = Press.Row, onClick = onClick)
            .drawBehind {
                if (divider) drawLine(hair, Offset((if (two) 48.dp else 40.dp).toPx(), size.height - 0.5f), Offset(size.width, size.height - 0.5f), 1.dp.toPx())
            }
            .padding(start = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (art != null) Box(Modifier.padding(vertical = 4.dp).padding(end = 6.dp).size(40.dp)) { art() }
        else Box(Modifier.width(34.dp), contentAlignment = Alignment.Center) {
            if (new && !now) Box(Modifier.align(Alignment.CenterStart).padding(start = 0.dp).size(6.dp).background(accent, CircleShape))
            if (now) Eq(playing, accent, height = 13.dp)
            else Text(number, style = MusixTheme.text.number.copy(fontSize = 13.sp, color = c.textSubtle))
        }
        val ink = if (now) accent else c.text
        if (two) Column(Modifier.weight(1f).padding(horizontal = 6.dp)) {
            Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MusixTheme.text.body.copy(fontSize = 15.5.sp, fontWeight = FontWeight.Medium, color = ink))
            if (sub != null) Text(sub, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MusixTheme.text.caption.copy(color = c.textSubtle))
        } else Row(Modifier.weight(1f).padding(horizontal = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
            Text(title, Modifier.weight(1f, fill = false), maxLines = 1, overflow = TextOverflow.Ellipsis,
                style = MusixTheme.text.body.copy(fontSize = 15.5.sp, fontWeight = FontWeight.Medium, color = ink))
            if (sub != null) Text(sub, Modifier.weight(1f, fill = false), maxLines = 1, overflow = TextOverflow.Ellipsis, style = MusixTheme.text.caption.copy(color = c.textSubtle))
        }
        if (hot) Icon(MusixIcons.FireFilled, "слушаешь чаще всего", Modifier.padding(end = 2.dp).size(15.dp), tint = Color(0xFFFF8A3D))
        Text(duration, Modifier.padding(start = 6.dp, end = 2.dp), style = MusixTheme.text.number.copy(fontSize = 13.sp, color = c.textSubtle))
        if (onQueue != null) Box(
            Modifier.size(44.dp).semantics { contentDescription = if (queued > 0) "В очереди $queued-й — убрать" else "Играть следующим" }
                .pressable(role = Press.Icon, haptic = if (queued > 0) null else HapticCue.Confirm, onClick = onQueue),
            contentAlignment = Alignment.Center,
        ) {
            if (queued > 0) Box(
                Modifier.popIn(queued).heightIn(min = 22.dp).background(c.text, RoundedCornerShape(11.dp)).padding(horizontal = 6.dp),
                contentAlignment = Alignment.Center,
            ) { Text("$queued", style = MusixTheme.text.number.copy(fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.bg)) }
            else Icon(MusixIcons.QueueNext, null, Modifier.size(19.dp), tint = c.textSubtle)
        }
    }
}
