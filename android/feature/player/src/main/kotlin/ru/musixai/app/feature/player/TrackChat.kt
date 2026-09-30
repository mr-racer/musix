package ru.musixai.app.feature.player

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import ru.musixai.app.core.designsystem.MusixIcons
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.core.designsystem.brush
import ru.musixai.app.core.designsystem.component.Eyebrow
import ru.musixai.app.core.designsystem.component.Spinner
import ru.musixai.app.core.designsystem.component.pressable

/** v1 `AIChatDrawer`, inline under the actions: questions about the playing song. */
@Composable
fun TrackChat(ui: PlayerUi, vm: PlayerViewModel, modifier: Modifier = Modifier) {
    val c = MusixTheme.colors
    var q by remember { mutableStateOf("") }
    Column(modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(c.chatPanelBg).border(1.dp, c.border, RoundedCornerShape(18.dp)).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Eyebrow("✦ Спроси о песне")
        for ((mine, text) in ui.chat.takeLast(6)) {
            Box(Modifier.fillMaxWidth(), contentAlignment = if (mine) Alignment.CenterEnd else Alignment.CenterStart) {
                Text(text, Modifier.clip(RoundedCornerShape(14.dp)).then(if (mine) Modifier.background(c.userBubble.brush(500f, 120f)) else Modifier.background(c.aiBubble))
                    .padding(horizontal = 12.dp, vertical = 8.dp), style = MusixTheme.type.body.copy(fontSize = 14.sp, lineHeight = 1.45.em, color = if (mine) Color.White else c.text))
            }
        }
        ui.chatStage?.let { Row(verticalAlignment = Alignment.CenterVertically) { Spinner(12.dp); Text("  $it", style = MusixTheme.type.body.copy(fontSize = 12.sp, color = c.textMuted)) } }
        Row(verticalAlignment = Alignment.CenterVertically) {
            BasicTextField(q, { q = it }, Modifier.weight(1f), textStyle = MusixTheme.type.body.copy(fontSize = 15.sp, color = c.text), cursorBrush = SolidColor(c.accentLight),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send), keyboardActions = KeyboardActions(onSend = { if (q.isNotBlank()) { vm.ask(q.trim()); q = "" } }),
                decorationBox = { inner -> Box { if (q.isEmpty()) Text("О чём эта песня?", style = MusixTheme.type.body.copy(fontSize = 15.sp, color = c.textSubtle)); inner() } })
            Icon(MusixIcons.Next, "Спросить", Modifier.size(36.dp).pressable { if (q.isNotBlank()) { vm.ask(q.trim()); q = "" } }.padding(9.dp), tint = c.textMuted)
        }
    }
}
