package ru.musixai.app.feature.player

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.core.designsystem.component.CtaButton
import ru.musixai.app.core.designsystem.component.Eyebrow
import ru.musixai.app.core.designsystem.component.MusixField
import ru.musixai.app.core.designsystem.component.pressable

/** «Добавить в плейлист» — inline under the action row (a sheet would cover the cover). */
@Composable
fun AddToPlaylist(vm: PlayerViewModel) {
    val c = MusixTheme.colors
    val lists by vm.allPlaylists.collectAsStateWithLifecycle(emptyList())
    var name by remember { mutableStateOf("") }
    Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp).fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(c.surface)
        .border(1.dp, c.border, RoundedCornerShape(18.dp)).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Eyebrow("В плейлист", Modifier.weight(1f))
            Text("Закрыть", Modifier.pressable { vm.openAdd(false) }, style = MusixTheme.type.body.copy(fontSize = 13.sp, color = c.textMuted))
        }
        for (p in lists.take(8)) Text(p.name, Modifier.fillMaxWidth().pressable { vm.addTo(p) }.padding(vertical = 6.dp),
            style = MusixTheme.type.body.copy(fontSize = 15.sp, color = c.text))
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            MusixField(name, { name = it }, "Новый плейлист", Modifier.weight(1f))
            CtaButton("+", { if (name.isNotBlank()) vm.addTo(null, name.trim()) })
        }
    }
}
