package ru.musixai.app.feature.player

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil3.compose.AsyncImage
import ru.musixai.app.core.designsystem.MusixIcons
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.core.designsystem.brush
import ru.musixai.app.core.designsystem.component.pressable

/** v1 `MiniPlayerBar`: a strip above the tab bar — cover, title, prev/play/next, and a
 *  progress hairline on top (7×10 px padding, 6 px gap). A tap opens the full player. */
@Composable
fun MiniPlayer(onOpen: () -> Unit, vm: PlayerViewModel = hiltViewModel()) {
    val ui by vm.ui.collectAsStateWithLifecycle()
    val p = ui.player
    if (p.trackId == null) return
    val c = MusixTheme.colors
    Box(Modifier.fillMaxWidth().background(c.tabBarBg.brush(1080f, 140f)).pressable(onClick = onOpen)) {
        val frac = if (p.durationMs > 0) (p.positionMs.toFloat() / p.durationMs).coerceIn(0f, 1f) else 0f
        Box(Modifier.fillMaxWidth(frac).height(2.dp).background(Brush.horizontalGradient(listOf(c.accent, c.accentLight))))
        Row(Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 7.dp), verticalAlignment = Alignment.CenterVertically) {
            AsyncImage(p.artUri, null, Modifier.size(40.dp).clip(RoundedCornerShape(8.dp)).background(c.surface2))
            Column(Modifier.weight(1f).padding(horizontal = 10.dp)) {
                Text(p.title, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MusixTheme.type.body.copy(fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.text))
                Text(p.artist, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MusixTheme.type.body.copy(fontSize = 12.sp, color = c.textMuted))
            }
            Icon(MusixIcons.Prev, "Назад", Modifier.size(40.dp).pressable(onClick = vm::previous).padding(11.dp), tint = c.text)
            Icon(if (p.isPlaying) MusixIcons.Pause else MusixIcons.Play, "Пауза", Modifier.size(44.dp).pressable(onClick = vm::toggle).padding(10.dp), tint = c.text)
            Icon(MusixIcons.Next, "Дальше", Modifier.size(40.dp).pressable(onClick = vm::next).padding(11.dp), tint = c.text)
        }
    }
}
