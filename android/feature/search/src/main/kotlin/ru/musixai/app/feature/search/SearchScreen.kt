package ru.musixai.app.feature.search

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import ru.musixai.app.core.data.SearchRepository
import ru.musixai.app.core.designsystem.MusixIcons
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.core.designsystem.component.Cover
import ru.musixai.app.core.designsystem.component.Empty
import ru.musixai.app.core.designsystem.component.Eyebrow
import ru.musixai.app.core.designsystem.component.LiquidGlass
import ru.musixai.app.core.designsystem.component.SegmentOption
import ru.musixai.app.core.designsystem.component.Segmented
import ru.musixai.app.core.designsystem.component.Spinner
import ru.musixai.app.core.designsystem.component.pressable
import ru.musixai.app.core.designsystem.component.skeButton
import ru.musixai.app.core.model.SearchResult
import ru.musixai.app.core.model.Track
import ru.musixai.app.core.player.PlayerController
import javax.inject.Inject

enum class Mode(val label: String, val sections: String) { Auto("AUTO", "catalog,lyrics,sound"), Text("ТЕКСТ", "lyrics"), Sound("ЗВУК", "sound"), Hyb("HYB", "lyrics,sound") }

data class SearchUi(val q: String = "", val mode: Mode = Mode.Auto, val busy: Boolean = false, val result: SearchResult? = null, val error: String? = null)

@HiltViewModel
class SearchViewModel @Inject constructor(state: SavedStateHandle, private val repo: SearchRepository, private val player: PlayerController) : ViewModel() {
    private val _ui = MutableStateFlow(SearchUi(q = state.get<String>("q").orEmpty()))
    val ui: StateFlow<SearchUi> = _ui
    private var job: Job? = null

    init { if (_ui.value.q.isNotBlank()) submit() }

    fun edit(q: String) = _ui.update { it.copy(q = q) }
    fun mode(m: Mode) { _ui.update { it.copy(mode = m) }; if (_ui.value.q.isNotBlank()) submit() }

    fun submit(q: String = _ui.value.q) {
        if (q.isBlank()) return
        _ui.update { it.copy(q = q, busy = true, error = null) }
        job?.cancel()
        job = viewModelScope.launch {
            val r = runCatching { repo.search(q.trim(), _ui.value.mode.sections) }
            _ui.update { it.copy(busy = false, result = r.getOrNull() ?: it.result, error = r.exceptionOrNull()?.let { "Поиск недоступен — нет связи с сервером" }) }
        }
    }

    fun play(tracks: List<Track>, i: Int) = player.playTracks(tracks.map { it.id }, i, "search")
}

private val SUGGESTIONS = listOf("грустный синти-поп под ночь", "песня про дорогу домой", "энергичный рок для тренировки", "как дождь за окном")

/** v1 `SearchSection` «Поиск»: one input, a mode (auto / lyrics / sound / hybrid), and the
 *  answer in sections — the top hit, tracks, lines, sound, albums, artists. */
@Composable
fun SearchRoute(onArtist: (String) -> Unit, onAlbum: (String) -> Unit, vm: SearchViewModel = hiltViewModel()) {
    val ui by vm.ui.collectAsStateWithLifecycle()
    val c = MusixTheme.colors
    LazyColumn(Modifier.fillMaxSize().background(c.bg), contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 20.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (ui.result == null) item {
            Column(Modifier.fillMaxWidth().padding(top = 80.dp, bottom = 12.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Text("Что послушаем?", style = MusixTheme.type.serif.copy(fontSize = 30.sp, color = c.text))
                Text("Опиши настроение, текст, звук или жанр — я найду это в твоей библиотеке.", Modifier.padding(top = 10.dp),
                    textAlign = TextAlign.Center, style = MusixTheme.type.body.copy(fontSize = 15.sp, lineHeight = 1.5.em, color = c.textMuted))
            }
        }
        item { Composer(ui, vm) }
        if (ui.result == null) {
            items(SUGGESTIONS) { s ->
                Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                    Text(s, Modifier.clip(RoundedCornerShape(999.dp)).border(1.dp, c.border, RoundedCornerShape(999.dp)).background(Color(0x08FFFFFF))
                        .pressable { vm.edit(s); vm.submit(s) }.padding(horizontal = 18.dp, vertical = 10.dp),
                        style = MusixTheme.type.body.copy(fontSize = 15.sp, color = c.textMuted))
                }
            }
        }
        ui.error?.let { e -> item { Text(e, style = MusixTheme.type.body.copy(fontSize = 13.sp, color = c.red)) } }
        ui.result?.let { r -> results(r, vm, onArtist, onAlbum) }
    }
}

@Composable
private fun Composer(ui: SearchUi, vm: SearchViewModel) {
    val c = MusixTheme.colors
    LiquidGlass(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(horizontal = 16.dp, vertical = 14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                BasicTextField(ui.q, vm::edit, Modifier.weight(1f), singleLine = true, textStyle = MusixTheme.type.body.copy(fontSize = 17.sp, color = c.text),
                    cursorBrush = SolidColor(c.accentLight), keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                    keyboardActions = KeyboardActions(onSearch = { vm.submit() }),
                    decorationBox = { inner -> Box { if (ui.q.isEmpty()) Text("Опиши музыку…", style = MusixTheme.type.body.copy(fontSize = 17.sp, color = c.textSubtle)); inner() } })
                Box(Modifier.size(46.dp).skeButton(14.dp).pressable { vm.submit() }, contentAlignment = Alignment.Center) {
                    if (ui.busy) Spinner(18.dp) else Icon(MusixIcons.Next, "Найти", Modifier.size(18.dp), tint = c.textMuted)
                }
            }
            Spacer(Modifier.height(12.dp))
            Segmented(ui.mode, Mode.entries.map { SegmentOption(it, it.label) }, vm::mode, small = true)
        }
    }
}

private fun androidx.compose.foundation.lazy.LazyListScope.results(r: SearchResult, vm: SearchViewModel, onArtist: (String) -> Unit, onAlbum: (String) -> Unit) {
    if (r.degraded.isNotEmpty()) item { Text("Часть поиска недоступна: ${r.degraded.joinToString()}", style = MusixTheme.type.body.copy(fontSize = 12.sp, color = MusixTheme.colors.amber)) }
    val nothing = r.top.isEmpty() && r.tracks.isEmpty() && r.lyrics.isEmpty() && r.sound.isEmpty() && r.albums.isEmpty() && r.artists.isEmpty()
    if (nothing) item { Empty("Ничего не нашлось") }
    if (r.artists.isNotEmpty() || r.albums.isNotEmpty()) item {
        LazyRow(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            items(r.artists) { a -> Column(Modifier.pressable { onArtist(a.id) }, horizontalAlignment = Alignment.CenterHorizontally) {
                Cover(a.imageId?.let { r.images[it] }, a.name, "", size = 88.dp, radius = 44.dp)
                Text(a.name, Modifier.padding(top = 6.dp), maxLines = 1, style = MusixTheme.type.body.copy(fontSize = 13.sp, color = MusixTheme.colors.text))
            } }
            items(r.albums) { a -> Column(Modifier.pressable { onAlbum(a.id) }) {
                Cover(a.coverImageId?.let { r.images[it] }, a.title, "", size = 88.dp)
                Text(a.title, Modifier.padding(top = 6.dp).size(width = 88.dp, height = 18.dp), maxLines = 1, overflow = TextOverflow.Ellipsis, style = MusixTheme.type.body.copy(fontSize = 13.sp, color = MusixTheme.colors.text))
            } }
        }
    }
    section("Треки", r.tracks, r, vm)
    section("По строчке", r.lyrics, r, vm)
    section("По звучанию", r.sound, r, vm)
}

private fun androidx.compose.foundation.lazy.LazyListScope.section(title: String, tracks: List<Track>, r: SearchResult, vm: SearchViewModel) {
    if (tracks.isEmpty()) return
    item { Eyebrow(title, Modifier.padding(top = 8.dp)) }
    itemsIndexed(tracks) { i, t ->
        val c = MusixTheme.colors
        Row(Modifier.fillMaxWidth().pressable { vm.play(tracks, i) }, verticalAlignment = Alignment.CenterVertically) {
            Cover(t.coverImageId?.let { r.images[it] }, t.album ?: t.title, t.artist, size = 46.dp)
            Column(Modifier.weight(1f).padding(horizontal = 14.dp)) {
                Text(t.title, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MusixTheme.type.body.copy(fontSize = 15.sp, fontWeight = FontWeight.Medium, color = c.text))
                Text(t.artist, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MusixTheme.type.body.copy(fontSize = 12.5.sp, color = c.textMuted))
            }
        }
    }
}
