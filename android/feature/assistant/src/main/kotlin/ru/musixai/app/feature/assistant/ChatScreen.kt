package ru.musixai.app.feature.assistant

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import ru.musixai.app.core.data.AssistantRepository
import ru.musixai.app.core.designsystem.MusixIcons
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.core.designsystem.brush
import ru.musixai.app.core.designsystem.component.Cover
import ru.musixai.app.core.designsystem.component.LiquidGlass
import ru.musixai.app.core.designsystem.component.Spinner
import ru.musixai.app.core.designsystem.component.pressable
import ru.musixai.app.core.designsystem.component.skeButton
import ru.musixai.app.core.model.Image
import ru.musixai.app.core.model.Track
import ru.musixai.app.core.player.PlayerController
import javax.inject.Inject

data class Msg(val mine: Boolean, val text: String, val tracks: List<Track> = emptyList(), val images: Map<String, Image> = emptyMap())
data class ChatUi(val input: String = "", val messages: List<Msg> = emptyList(), val stage: String? = null, val contextId: String? = null)

@HiltViewModel
class ChatViewModel @Inject constructor(private val repo: AssistantRepository, private val player: PlayerController) : ViewModel() {
    private val _ui = MutableStateFlow(ChatUi())
    val ui: StateFlow<ChatUi> = _ui

    fun edit(s: String) = _ui.update { it.copy(input = s) }

    fun send() {
        val q = _ui.value.input.trim()
        if (q.isEmpty() || _ui.value.stage != null) return
        val history = _ui.value.messages.takeLast(8).map { (if (it.mine) "user" else "assistant") to it.text }
        _ui.update { it.copy(input = "", messages = it.messages + Msg(true, q), stage = "Думаю…") }
        viewModelScope.launch {
            val a = runCatching { repo.ask(q, history, _ui.value.contextId, player.state.value.trackId) { s -> _ui.update { it.copy(stage = s) } } }
            _ui.update { u ->
                a.fold(
                    { r -> u.copy(stage = null, contextId = r.contextId ?: u.contextId,
                        messages = u.messages + Msg(false, r.error?.let { "Не получилось ответить" } ?: r.text ?: if (r.tracks.isNotEmpty()) "Вот что нашлось:" else "Ничего не нашлось", r.tracks, r.images)) },
                    { u.copy(stage = null, messages = u.messages + Msg(false, "Ассистент недоступен — нет связи с сервером")) },
                )
            }
        }
    }

    fun play(tracks: List<Track>, i: Int) = player.playTracks(tracks.map { it.id }, i, "search")
}

/** v1 `AssistantSection` «Чат»: the conversation, stages while it thinks, track cards. */
@Composable
fun ChatRoute(vm: ChatViewModel = hiltViewModel()) {
    val ui by vm.ui.collectAsStateWithLifecycle()
    val c = MusixTheme.colors
    val list = rememberLazyListState()
    LaunchedEffect(ui.messages.size, ui.stage) { if (ui.messages.isNotEmpty()) list.animateScrollToItem(ui.messages.size) }
    Column(Modifier.fillMaxSize().background(c.bg).imePadding()) {
        LazyColumn(Modifier.weight(1f), state = list, contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (ui.messages.isEmpty()) item {
                Column(Modifier.fillMaxWidth().padding(top = 80.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("Спроси гуру", style = MusixTheme.type.serif.copy(fontSize = 28.sp, color = c.text))
                    Text("«спокойные песни под поездку домой», «кто спродюсировал этот трек», «что за сэмпл в Power»", Modifier.padding(top = 10.dp),
                        style = MusixTheme.type.body.copy(fontSize = 14.sp, lineHeight = 1.5.em, color = c.textMuted))
                }
            }
            items(ui.messages) { m -> Bubble(m, vm) }
            ui.stage?.let { s -> item { Row(verticalAlignment = Alignment.CenterVertically) { Spinner(14.dp); Text("  $s", style = MusixTheme.type.body.copy(fontSize = 13.sp, color = c.textMuted)) } } }
        }
        LiquidGlass(Modifier.fillMaxWidth().padding(12.dp), radius = 18.dp) {
            Row(Modifier.padding(horizontal = 14.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                BasicTextField(ui.input, vm::edit, Modifier.weight(1f), textStyle = MusixTheme.type.body.copy(fontSize = 16.sp, color = c.text),
                    cursorBrush = SolidColor(c.accentLight), keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send), keyboardActions = KeyboardActions(onSend = { vm.send() }),
                    decorationBox = { inner -> Box { if (ui.input.isEmpty()) Text("Спроси о музыке…", style = MusixTheme.type.body.copy(fontSize = 16.sp, color = c.textSubtle)); inner() } })
                Box(Modifier.size(42.dp).skeButton(12.dp).pressable(onClick = vm::send), contentAlignment = Alignment.Center) {
                    Icon(MusixIcons.Next, "Отправить", Modifier.size(16.dp), tint = c.textMuted)
                }
            }
        }
    }
}

@Composable
private fun Bubble(m: Msg, vm: ChatViewModel) {
    val c = MusixTheme.colors
    Column(Modifier.fillMaxWidth(), horizontalAlignment = if (m.mine) Alignment.End else Alignment.Start) {
        val shape = RoundedCornerShape(18.dp)
        Text(m.text, Modifier.widthIn(max = 320.dp).clip(shape)
            .then(if (m.mine) Modifier.background(c.userBubble.brush(600f, 200f)) else Modifier.background(c.aiBubble))
            .padding(horizontal = 14.dp, vertical = 10.dp),
            style = MusixTheme.type.body.copy(fontSize = 15.sp, lineHeight = 1.45.em, color = if (m.mine) androidx.compose.ui.graphics.Color.White else c.text))
        m.tracks.take(12).forEachIndexed { i, t ->
            Row(Modifier.padding(top = 8.dp).fillMaxWidth().pressable { vm.play(m.tracks, i) }, verticalAlignment = Alignment.CenterVertically) {
                Cover(t.coverImageId?.let { m.images[it] }, t.album ?: t.title, t.artist, size = 42.dp)
                Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                    Text(t.title, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MusixTheme.type.body.copy(fontSize = 14.sp, fontWeight = FontWeight.Medium, color = c.text))
                    Text(t.artist, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MusixTheme.type.body.copy(fontSize = 12.sp, color = c.textMuted))
                }
            }
        }
    }
}
