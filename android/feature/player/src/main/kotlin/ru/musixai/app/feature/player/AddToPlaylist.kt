package ru.musixai.app.feature.player

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.delay
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.core.designsystem.component.CtaButton
import ru.musixai.app.core.designsystem.component.MusixField
import ru.musixai.app.core.designsystem.component.pressable
import ru.musixai.app.core.model.Playlist

/**
 * «Добавить в плейлист» as a modal over the player. It used to open inline at the bottom of
 * the page, out of sight (the owner, 2026-10-02). It shows the playlists with their counts,
 * a field for a new one, and a short «Добавлено» before it closes.
 */
@Composable
fun AddToPlaylist(vm: PlayerViewModel, title: String) {
    val c = MusixTheme.colors
    val dark = MusixTheme.isDark
    val lists by vm.allPlaylists.collectAsStateWithLifecycle(emptyList())
    var name by remember { mutableStateOf("") }
    var added by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(added) { if (added != null) { delay(900); vm.openAdd(false) } }
    val pick: (Playlist?, String?) -> Unit = { p, fresh -> if (added == null) { vm.addTo(p, fresh, close = false); added = p?.name ?: fresh } }
    Dialog(onDismissRequest = { vm.openAdd(false) }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(Modifier.padding(horizontal = 24.dp).widthIn(max = 420.dp).fillMaxWidth().clip(RoundedCornerShape(24.dp))
            .background(if (dark) Color(0xFF17171E) else Color(0xFFFBFAFF)).border(1.dp, c.border, RoundedCornerShape(24.dp))
            .padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Column {
                Text("В плейлист", style = MusixTheme.type.body.copy(fontSize = 18.sp, fontWeight = FontWeight.SemiBold, color = c.text))
                Text(title, Modifier.padding(top = 2.dp), maxLines = 1, overflow = TextOverflow.Ellipsis,
                    style = MusixTheme.type.body.copy(fontSize = 13.sp, color = c.textMuted))
            }
            if (added != null) {
                Text("✓ Добавлено в «$added»", Modifier.padding(vertical = 18.dp).align(Alignment.CenterHorizontally),
                    style = MusixTheme.type.body.copy(fontSize = 15.sp, fontWeight = FontWeight.Medium, color = c.accentLight))
                return@Column
            }
            Column(Modifier.heightIn(max = 320.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                if (lists.isEmpty()) Text("Плейлистов пока нет — создайте первый ниже", Modifier.padding(vertical = 8.dp),
                    style = MusixTheme.type.body.copy(fontSize = 14.sp, color = c.textMuted))
                for (p in lists) Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).pressable { pick(p, null) }.padding(horizontal = 10.dp, vertical = 11.dp),
                    verticalAlignment = Alignment.CenterVertically) {
                    Text(p.name, Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis, style = MusixTheme.type.body.copy(fontSize = 15.5.sp, color = c.text))
                    Text("${p.itemCount}", style = MusixTheme.type.body.copy(fontSize = 13.sp, color = c.textSubtle))
                }
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                MusixField(name, { name = it }, "Новый плейлист", Modifier.weight(1f))
                CtaButton("Создать", { if (name.isNotBlank()) pick(null, name.trim()) })
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                Text("Отмена", Modifier.clip(RoundedCornerShape(10.dp)).pressable { vm.openAdd(false) }.padding(horizontal = 12.dp, vertical = 8.dp),
                    style = MusixTheme.type.body.copy(fontSize = 14.sp, color = c.textMuted))
            }
            Spacer(Modifier.size(0.dp))
        }
    }
}
