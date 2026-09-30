package ru.musixai.app.feature.player

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ru.musixai.app.core.designsystem.MusixFontFamilies
import ru.musixai.app.core.designsystem.MusixIcons
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.core.designsystem.component.RoundGlassButton
import ru.musixai.app.core.designsystem.component.pressable
import ru.musixai.app.core.designsystem.hexColor
import ru.musixai.app.core.player.QueueMode

@Composable
fun PlayerRoute(onClose: () -> Unit, onArtist: (String) -> Unit, vm: PlayerViewModel = hiltViewModel()) {
    val ui by vm.ui.collectAsStateWithLifecycle()
    PlayerScreen(ui, vm, onClose, onArtist)
}

/** v1 `PlayerSection` in its phone form (golden player-phone-*): the cover stage, the
 *  title block with the vibe line, the scrubber over the energy envelope, the action row,
 *  the Lossless mark, then the facts rail (or the synced lyrics) and the queue. */
@Composable
fun PlayerScreen(ui: PlayerUi, vm: PlayerViewModel, onClose: () -> Unit, onArtist: (String) -> Unit) {
    val c = MusixTheme.colors
    val dark = MusixTheme.isDark
    val p = ui.player
    val ctx = ui.context
    val palette = ctx?.image?.palette
    // the ambient field: the server palette of the cover, not a device-side color guess
    val glow by animateColorAsState(hexColor(palette?.vibrant)?.copy(alpha = if (dark) 0.34f else 0.22f) ?: Color(0x335874EA), tween(900), label = "glow")
    val glow2 by animateColorAsState(hexColor(palette?.dominant)?.copy(alpha = if (dark) 0.26f else 0.16f) ?: Color(0x22FF78C8), tween(900), label = "glow2")
    Box(Modifier.fillMaxSize().background(c.bg)) {
        Canvas(Modifier.fillMaxSize()) {
            drawRect(Brush.radialGradient(listOf(glow, Color.Transparent), center = Offset(size.width * 0.5f, size.height * 0.22f), radius = size.width * 1.1f))
            drawRect(Brush.radialGradient(listOf(glow2, Color.Transparent), center = Offset(size.width * 0.9f, size.height * 0.55f), radius = size.width * 0.9f))
        }
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).statusBarsPadding().navigationBarsPadding()) {
            Box(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp)) {
                RoundGlassButton(onClose, size = 42.dp) { Icon(MusixIcons.ChevronDown, null, Modifier.size(20.dp), tint = c.text) }
                Text("ЖМИ НА ОБЛОЖКУ, ЧТОБЫ ПОСТАВИТЬ НА ПАУЗУ", Modifier.align(Alignment.Center).padding(start = 48.dp), maxLines = 1, overflow = TextOverflow.Ellipsis,
                    style = MusixTheme.type.mono.copy(fontSize = 10.sp, letterSpacing = 0.16.em, color = c.textMuted))
            }
            CoverStage(ui, onToggle = vm::toggle, onNext = vm::next, onPrev = vm::previous, modifier = Modifier.padding(horizontal = 10.dp))
            Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 14.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Text(p.title.ifEmpty { ctx?.track?.title.orEmpty() }, maxLines = 2, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center,
                    style = MusixTheme.type.body.copy(fontSize = 25.sp, lineHeight = 1.15.em, fontWeight = FontWeight.Bold, letterSpacing = (-0.01).em, color = c.text))
                val artist = ctx?.track?.artists?.firstOrNull()
                Row(Modifier.padding(top = 6.dp).pressable { artist?.let { onArtist(it.id) } }, verticalAlignment = Alignment.CenterVertically) {
                    Text(p.artist, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MusixTheme.type.body.copy(fontSize = 17.sp, color = c.textMuted))
                    Spacer(Modifier.size(6.dp))
                    Icon(MusixIcons.ChevronDown, null, Modifier.size(14.dp), tint = c.textSubtle)
                }
                val meta = listOfNotNull(ctx?.track?.album?.takeIf { it.isNotBlank() }, ctx?.track?.year?.toString()).joinToString(" · ")
                if (meta.isNotEmpty()) Text(meta, Modifier.padding(top = 4.dp), maxLines = 1, overflow = TextOverflow.Ellipsis,
                    style = MusixTheme.type.body.copy(fontSize = 13.sp, color = c.textSubtle))
                ctx?.vibe?.let {
                    Text(it, Modifier.padding(top = 12.dp), textAlign = TextAlign.Center,
                        style = MusixTheme.type.body.copy(fontFamily = MusixFontFamilies.Playfair, fontStyle = FontStyle.Italic, fontSize = 16.sp,
                            lineHeight = 1.35.em, color = if (dark) Color(0xFFBDB0E6) else Color(0xFF5B4A91)))
                }
            }
            Scrubber(p.positionMs, p.durationMs, ui.envelope, vm::seek, Modifier.padding(horizontal = 36.dp))
            ActionRow(ui, vm, Modifier.padding(top = 14.dp))
            if (ctx?.lossless == true) LosslessMark(Modifier.align(Alignment.CenterHorizontally).padding(top = 10.dp))
            Spacer(Modifier.height(18.dp))
            if (ui.chatOpen) TrackChat(ui, vm, Modifier.padding(horizontal = 16.dp).padding(bottom = 12.dp))
            if (ui.lyricsOpen) LyricsPanel(ctx, p.positionMs, vm::seek, Modifier.padding(horizontal = 16.dp), onExplain = { line -> vm.ask("Объясни строчку", line) })
            else FactsRail(ctx, Modifier.padding(horizontal = 12.dp))
            Credits(ctx, Modifier.padding(horizontal = 16.dp, vertical = 12.dp))
            if (ui.addOpen) AddToPlaylist(vm)
            QueueList(p, onJump = vm::jump, onMove = vm::move, onRemove = vm::remove, streaming = p.mode == QueueMode.STREAM,
                modifier = Modifier.padding(horizontal = 12.dp).padding(bottom = 24.dp))
        }
    }
}
