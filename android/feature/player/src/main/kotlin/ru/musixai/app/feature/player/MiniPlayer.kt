package ru.musixai.app.feature.player

import androidx.compose.foundation.background
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
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil3.compose.AsyncImage
import ru.musixai.app.core.designsystem.HapticCue
import ru.musixai.app.core.designsystem.LocalMusixHaptics
import ru.musixai.app.core.designsystem.MusixIcons
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.core.designsystem.brush
import ru.musixai.app.core.designsystem.component.LocalCoverFlight
import ru.musixai.app.core.designsystem.component.coverFlightTarget
import ru.musixai.app.core.designsystem.component.pressable
import ru.musixai.app.core.player.PlayerState

/** v1 `MiniPlayerBar`: a strip above the tab bar — cover, title, prev/play/next, and a
 *  progress hairline on top (7×10 px padding, 6 px gap). A tap opens the full player. */
@Composable
fun MiniPlayer(onOpen: () -> Unit, vm: PlayerViewModel = hiltViewModel()) {
    val ui by vm.ui.collectAsStateWithLifecycle()
    if (ui.player.trackId == null) return
    MiniPlayerBar(ui.player, onOpen, vm::previous, vm::toggle, vm::next)
}

internal const val MiniCoverTag = "mini-cover"

// The bar's geometry: the layout below is built from it, and so is the dock guess.
private val PadH = 10.dp
private val PadV = 7.dp
private val CoverSize = 40.dp
private val PlaySize = 44.dp // the row's tallest: it sets the bar's height

/** Where the bar's cover will stand once the bar is shown above [top] (root px): the shell's
 *  dock for a cover flight on a cold start, before anything has played. */
fun miniPlayerCoverAbove(top: Float, density: Density): Rect = with(density) {
    val y = top - (PadV * 2 + PlaySize).toPx() + PadV.toPx() + ((PlaySize - CoverSize) / 2).toPx()
    Rect(Offset(PadH.toPx(), y), Size(CoverSize.toPx(), CoverSize.toPx()))
}

@Composable
internal fun MiniPlayerBar(p: PlayerState, onOpen: () -> Unit, onPrevious: () -> Unit, onToggle: () -> Unit, onNext: () -> Unit) {
    val c = MusixTheme.colors
    val haptics = LocalMusixHaptics.current
    Box(Modifier.fillMaxWidth().background(c.tabBarBg.brush(1080f, 140f)).pressable(onClick = onOpen)) {
        val frac = if (p.durationMs > 0) (p.positionMs.toFloat() / p.durationMs).coerceIn(0f, 1f) else 0f
        Box(Modifier.fillMaxWidth(frac).height(2.dp).background(Brush.horizontalGradient(listOf(c.accent, c.accentLight))))
        Row(Modifier.fillMaxWidth().padding(horizontal = PadH, vertical = PadV), verticalAlignment = Alignment.CenterVertically) {
            // covers that start playing land here (CoverFlight)
            AsyncImage(p.artUri, null, Modifier.size(CoverSize).coverFlightTarget(LocalCoverFlight.current).testTag(MiniCoverTag)
                .clip(RoundedCornerShape(8.dp)).background(c.surface2))
            Column(Modifier.weight(1f).padding(horizontal = 10.dp)) {
                Text(p.title, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MusixTheme.type.body.copy(fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.text))
                Text(p.artist, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MusixTheme.type.body.copy(fontSize = 12.sp, color = c.textMuted))
            }
            Icon(MusixIcons.Prev, "Назад", Modifier.size(40.dp).pressable(onClick = onPrevious).padding(11.dp), tint = c.text)
            Icon(if (p.isPlaying) MusixIcons.Pause else MusixIcons.Play, if (p.isPlaying) "Пауза" else "Воспроизвести", Modifier.size(PlaySize).pressable {
                haptics.perform(if (p.isPlaying) HapticCue.ToggleOff else HapticCue.ToggleOn, fromUser = true)
                onToggle()
            }.padding(10.dp), tint = c.text)
            Icon(MusixIcons.Next, "Дальше", Modifier.size(40.dp).pressable(onClick = onNext).padding(11.dp), tint = c.text)
        }
    }
}
