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
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.widthIn
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

/** v1 «Поиск» modes: the words (titles and lines), the sound, or both. */
enum class Mode(val label: String, val sections: String) { Text("ТЕКСТ", "catalog,lyrics"), Sound("ЗВУК", "sound"), Hybrid("ГИБРИД", "catalog,lyrics,sound") }

/** v1 `SearchSection`'s two tabs: the plain library search, and the chat. */
enum class Tab { Search, Chat }

/** A chat message: mine, or the assistant's answer with the tracks it found. */
data class ChatMsg(val mine: Boolean, val text: String, val tracks: List<Track> = emptyList(), val images: Map<String, ru.musixai.app.core.model.Image> = emptyMap())

data class SearchUi(
    val q: String = "", val mode: Mode = Mode.Hybrid, val busy: Boolean = false, val result: SearchResult? = null, val error: String? = null,
    val decades: List<Pair<String, Int>> = emptyList(), val tags: List<Pair<String, Int>> = emptyList(),
    val years: Set<String> = emptySet(), val picked: Set<String> = emptySet(),
    val tab: Tab = Tab.Search, val recent: List<String> = emptyList(), val filters: Boolean = false,
    val chat: List<ChatMsg> = emptyList(), val chatInput: String = "", val chatStage: String? = null, val contextId: String? = null,
)

@HiltViewModel
class SearchViewModel @Inject constructor(
    state: SavedStateHandle, private val repo: SearchRepository, private val player: PlayerController,
    private val assistant: ru.musixai.app.core.data.AssistantRepository, @dagger.hilt.android.qualifiers.ApplicationContext ctx: android.content.Context,
) : ViewModel() {
    private val prefs = ctx.getSharedPreferences("search", android.content.Context.MODE_PRIVATE)
    private val _ui = MutableStateFlow(SearchUi(q = state.get<String>("q").orEmpty(), recent = prefs.getString(RECENT, null)?.split('\n')?.filter(String::isNotBlank).orEmpty()))
    val ui: StateFlow<SearchUi> = _ui
    private var job: Job? = null

    init {
        if (_ui.value.q.isNotBlank()) submit()
        viewModelScope.launch { runCatching { repo.facets() }.onSuccess { (d, t) -> _ui.update { it.copy(decades = d, tags = t) } } }
    }

    fun tab(t: Tab) = _ui.update { it.copy(tab = t) }
    fun toggleFilters() = _ui.update { it.copy(filters = !it.filters) }

    /** v1's year and sound chips (kept, program §4.3): they narrow every section. */
    fun toggleYear(y: String) { _ui.update { it.copy(years = if (y in it.years) it.years - y else it.years + y) }; if (_ui.value.q.isNotBlank()) submit() }
    fun toggleTag(tg: String) { _ui.update { it.copy(picked = if (tg in it.picked) it.picked - tg else it.picked + tg) }; if (_ui.value.q.isNotBlank()) submit() }

    fun edit(q: String) = _ui.update { it.copy(q = q) }
    fun mode(m: Mode) { _ui.update { it.copy(mode = m) }; if (_ui.value.q.isNotBlank()) submit() }

    fun submit(q: String = _ui.value.q) {
        if (q.isBlank()) return
        remember(q.trim())
        _ui.update { it.copy(q = q, busy = true, error = null) }
        job?.cancel()
        job = viewModelScope.launch {
            val s = _ui.value
            val r = runCatching { repo.search(q.trim(), s.mode.sections, years = s.years, tags = s.picked) }
            _ui.update { it.copy(busy = false, result = r.getOrNull() ?: it.result, error = r.exceptionOrNull()?.let { "Поиск недоступен — нет связи с сервером" }) }
        }
    }

    /** v1 RecentSearchesChips: the last eight queries, newest first, kept on the phone. */
    private fun remember(q: String) = setRecent((listOf(q) + _ui.value.recent.filter { !it.equals(q, ignoreCase = true) }).take(8))
    fun forget(q: String) = setRecent(_ui.value.recent - q)
    private fun setRecent(list: List<String>) { _ui.update { it.copy(recent = list) }; prefs.edit().putString(RECENT, list.joinToString("\n")).apply() }

    fun chatEdit(t: String) = _ui.update { it.copy(chatInput = t) }

    /** The chat tab: the assistant answers in words and with tracks from the library; the context carries over between turns. */
    fun ask(text: String = _ui.value.chatInput) {
        val t = text.trim()
        if (t.isEmpty() || _ui.value.chatStage != null) return
        val history = _ui.value.chat.takeLast(6).map { (if (it.mine) "user" else "assistant") to it.text }
        _ui.update { it.copy(chat = it.chat + ChatMsg(true, t), chatInput = "", chatStage = "Думаю…") }
        viewModelScope.launch {
            val r = runCatching { assistant.ask(t, history, _ui.value.contextId, player.state.value.trackId) { s -> _ui.update { u -> u.copy(chatStage = s) } } }.getOrNull()
            val reply = when {
                r == null -> ChatMsg(false, "Не получилось ответить — нет связи с сервером")
                else -> ChatMsg(false, r.text ?: r.error ?: if (r.tracks.isEmpty()) "Ничего не нашёл" else "Вот что нашлось в библиотеке:", r.tracks, r.images)
            }
            _ui.update { it.copy(chat = it.chat + reply, chatStage = null, contextId = r?.contextId ?: it.contextId) }
        }
    }

    fun newChat() = _ui.update { if (it.chatStage != null) it else it.copy(chat = emptyList(), contextId = null) }

    fun play(tracks: List<Track>, i: Int) = player.playTracks(tracks.map { it.id }, i, "search")

    private companion object { const val RECENT = "recent" }
}

private val SUGGESTIONS = listOf("грустный синти-поп под ночь", "песня про дорогу домой", "энергичный рок для тренировки", "как дождь за окном")

/**
 * v1 `SearchSection` (the owner asked for it back, 2026-10-02): «Поиск» over the title, with
 * a «🔍 Поиск | 💬 Чат» switch.
 * - «Поиск»: the library search itself. It has the bar, the recent queries, ТЕКСТ / ЗВУК /
 *   ГИБРИД, the year and sound filters, and the answer in sections.
 * - «Чат»: the conversation. It has «Что послушаем?» with suggestions, then turns, each
 *   answered in words and with tracks to play.
 */
@Composable
fun SearchRoute(onArtist: (String) -> Unit, onAlbum: (String) -> Unit, vm: SearchViewModel = hiltViewModel()) {
    val ui by vm.ui.collectAsStateWithLifecycle()
    val c = MusixTheme.colors
    Column(Modifier.fillMaxSize().background(c.bg).statusBarsPadding()) {
        Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 16.dp, top = 14.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("РАЗДЕЛ · ПОИСК", style = MusixTheme.type.mono.copy(fontSize = 10.sp, letterSpacing = 0.22.em, color = c.textSubtle))
                Text("Поиск", style = MusixTheme.type.title.copy(fontSize = 26.sp, color = c.text))
            }
            Segmented(ui.tab, listOf(SegmentOption(Tab.Search, "🔍 Поиск"), SegmentOption(Tab.Chat, "💬 Чат")), vm::tab, small = true)
        }
        androidx.compose.animation.Crossfade(ui.tab, label = "tab") { tab ->
            when (tab) {
                Tab.Search -> SearchTab(ui, vm, onArtist, onAlbum)
                Tab.Chat -> ChatTab(ui, vm)
            }
        }
    }
}

@Composable
private fun SearchTab(ui: SearchUi, vm: SearchViewModel, onArtist: (String) -> Unit, onAlbum: (String) -> Unit) {
    val c = MusixTheme.colors
    LazyColumn(Modifier.fillMaxSize(), contentPadding = androidx.compose.foundation.layout.PaddingValues(start = 16.dp, end = 16.dp, top = 10.dp, bottom = 120.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { HeroBar(ui, vm) }
        if (ui.recent.isNotEmpty() && ui.result == null) item {
            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                items(ui.recent) { q ->
                    Row(Modifier.clip(RoundedCornerShape(999.dp)).border(1.dp, c.border, RoundedCornerShape(999.dp)).pressable { vm.edit(q); vm.submit(q) }
                        .padding(start = 12.dp, end = 6.dp, top = 6.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text("↺ $q", maxLines = 1, style = MusixTheme.type.body.copy(fontSize = 12.5.sp, color = c.textMuted))
                        Text("✕", Modifier.padding(start = 6.dp).pressable { vm.forget(q) }.padding(horizontal = 4.dp), style = MusixTheme.type.body.copy(fontSize = 11.sp, color = c.textSubtle))
                    }
                }
            }
        }
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Segmented(ui.mode, Mode.entries.map { SegmentOption(it, it.label) }, vm::mode, small = true)
                Spacer(Modifier.weight(1f))
                Text("${if (ui.filters) "−" else "+"} ФИЛЬТРЫ", Modifier.clip(RoundedCornerShape(999.dp))
                    .background(if (ui.filters || ui.years.isNotEmpty() || ui.picked.isNotEmpty()) c.accentBg else Color.Transparent)
                    .border(1.dp, c.border, RoundedCornerShape(999.dp)).pressable(onClick = vm::toggleFilters).padding(horizontal = 12.dp, vertical = 7.dp),
                    style = MusixTheme.type.mono.copy(fontSize = 11.sp, letterSpacing = 0.15.em, color = c.textMuted))
            }
        }
        if (ui.filters) {
            if (ui.decades.isNotEmpty()) item { Chips("Годы", ui.decades, ui.years, vm::toggleYear) }
            if (ui.tags.isNotEmpty()) item { Chips("Звук", ui.tags, ui.picked, vm::toggleTag) }
        }
        if (ui.result == null && !ui.busy) item {
            Text("Название, артист, альбом или строчка из песни — ищу по всей библиотеке.", Modifier.fillMaxWidth().padding(top = 28.dp),
                textAlign = TextAlign.Center, style = MusixTheme.type.body.copy(fontSize = 14.sp, lineHeight = 1.5.em, color = c.textSubtle))
        }
        ui.error?.let { e -> item { Text(e, style = MusixTheme.type.body.copy(fontSize = 13.sp, color = c.red)) } }
        ui.result?.let { r -> results(r, vm, onArtist, onAlbum) }
    }
}

/** v1 `.hero-bar`: the search input with its submit key. */
@Composable
private fun HeroBar(ui: SearchUi, vm: SearchViewModel) {
    val c = MusixTheme.colors
    LiquidGlass(Modifier.fillMaxWidth()) {
        Row(Modifier.padding(start = 14.dp, end = 6.dp, top = 6.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(MusixIcons.Search, null, Modifier.size(18.dp), tint = c.textSubtle)
            BasicTextField(ui.q, vm::edit, Modifier.weight(1f).padding(horizontal = 10.dp, vertical = 12.dp), singleLine = true,
                textStyle = MusixTheme.type.body.copy(fontSize = 16.sp, color = c.text), cursorBrush = SolidColor(c.accentLight),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search), keyboardActions = KeyboardActions(onSearch = { vm.submit() }),
                decorationBox = { inner -> Box { if (ui.q.isEmpty()) Text("Песня, артист, альбом или строчка…", maxLines = 1, style = MusixTheme.type.body.copy(fontSize = 16.sp, color = c.textSubtle)); inner() } })
            Box(Modifier.size(44.dp).skeButton(12.dp).pressable { vm.submit() }, contentAlignment = Alignment.Center) {
                if (ui.busy) Spinner(18.dp) else Icon(MusixIcons.Next, "Найти", Modifier.size(18.dp), tint = c.textMuted)
            }
        }
    }
}

@Composable
private fun ChatTab(ui: SearchUi, vm: SearchViewModel) {
    val c = MusixTheme.colors
    val list = androidx.compose.foundation.lazy.rememberLazyListState()
    androidx.compose.runtime.LaunchedEffect(ui.chat.size, ui.chatStage) { if (ui.chat.isNotEmpty()) list.animateScrollToItem(list.layoutInfo.totalItemsCount.coerceAtLeast(1) - 1) }
    Column(Modifier.fillMaxSize().imePadding()) {
        LazyColumn(Modifier.weight(1f), state = list, contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 18.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (ui.chat.isEmpty()) {
                item {
                    Column(Modifier.fillMaxWidth().padding(top = 48.dp, bottom = 12.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        Text("Что послушаем?", style = MusixTheme.type.serif.copy(fontSize = 30.sp, color = c.text))
                        Text("Опиши настроение, текст, звук или жанр — я найду это в твоей библиотеке.", Modifier.padding(top = 10.dp),
                            textAlign = TextAlign.Center, style = MusixTheme.type.body.copy(fontSize = 15.sp, lineHeight = 1.5.em, color = c.textMuted))
                    }
                }
                items(SUGGESTIONS) { s ->
                    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                        Text(s, Modifier.clip(RoundedCornerShape(999.dp)).border(1.dp, c.border, RoundedCornerShape(999.dp)).background(Color(0x08FFFFFF))
                            .pressable { vm.ask(s) }.padding(horizontal = 18.dp, vertical = 10.dp),
                            style = MusixTheme.type.body.copy(fontSize = 15.sp, color = c.textMuted))
                    }
                }
            }
            items(ui.chat.size) { i -> ChatBubble(ui.chat[i], vm) }
            ui.chatStage?.let { st ->
                item {
                    Row(Modifier.clip(RoundedCornerShape(16.dp, 16.dp, 16.dp, 5.dp)).background(c.aiBubble).padding(horizontal = 14.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                        Spinner(12.dp); Text("  $st", style = MusixTheme.type.body.copy(fontSize = 13.sp, color = c.textMuted))
                    }
                }
            }
        }
        LiquidGlass(Modifier.fillMaxWidth().padding(start = 14.dp, end = 14.dp, bottom = 12.dp)) {
            Row(Modifier.padding(start = 14.dp, end = 6.dp, top = 6.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                BasicTextField(ui.chatInput, vm::chatEdit, Modifier.weight(1f).padding(vertical = 11.dp), maxLines = 4,
                    textStyle = MusixTheme.type.body.copy(fontSize = 16.sp, color = c.text), cursorBrush = SolidColor(c.accentLight),
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send), keyboardActions = KeyboardActions(onSend = { vm.ask() }),
                    decorationBox = { inner -> Box { if (ui.chatInput.isEmpty()) Text("Опиши музыку…", style = MusixTheme.type.body.copy(fontSize = 16.sp, color = c.textSubtle)); inner() } })
                if (ui.chat.isNotEmpty()) Text("↺", Modifier.padding(horizontal = 6.dp).pressable(onClick = vm::newChat).padding(8.dp), style = MusixTheme.type.body.copy(fontSize = 16.sp, color = c.textMuted))
                Box(Modifier.size(44.dp).skeButton(12.dp).pressable { vm.ask() }, contentAlignment = Alignment.Center) {
                    if (ui.chatStage != null) Spinner(18.dp) else Icon(MusixIcons.Next, "Отправить", Modifier.size(18.dp), tint = c.textMuted)
                }
            }
        }
    }
}

@Composable
private fun ChatBubble(m: ChatMsg, vm: SearchViewModel) {
    val c = MusixTheme.colors
    Column(Modifier.fillMaxWidth(), horizontalAlignment = if (m.mine) Alignment.End else Alignment.Start, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(m.text, Modifier.widthIn(max = 320.dp).clip(if (m.mine) RoundedCornerShape(16.dp, 16.dp, 5.dp, 16.dp) else RoundedCornerShape(16.dp, 16.dp, 16.dp, 5.dp))
            .background(if (m.mine) c.accent else c.aiBubble).padding(horizontal = 15.dp, vertical = 11.dp),
            style = MusixTheme.type.body.copy(fontSize = 15.sp, lineHeight = 1.55.em, color = if (m.mine) Color.White else c.text))
        m.tracks.take(5).forEachIndexed { i, t ->
            Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Color(0x08FFFFFF)).pressable { vm.play(m.tracks, i) }.padding(8.dp),
                verticalAlignment = Alignment.CenterVertically) {
                Cover(t.coverImageId?.let { m.images[it] }, t.album ?: t.title, t.artist, size = 42.dp)
                Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                    Text(t.title, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MusixTheme.type.body.copy(fontSize = 14.5.sp, fontWeight = FontWeight.Medium, color = c.text))
                    Text(t.artist, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MusixTheme.type.body.copy(fontSize = 12.5.sp, color = c.textMuted))
                }
                Icon(MusixIcons.Play, "Играть", Modifier.size(16.dp), tint = c.textSubtle)
            }
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

@Composable
private fun Chips(label: String, items: List<Pair<String, Int>>, on: Set<String>, toggle: (String) -> Unit) {
    val c = MusixTheme.colors
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.padding(end = 10.dp), style = MusixTheme.type.mono.copy(fontSize = 11.sp, color = c.textSubtle))
        LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            items(items) { (v, n) ->
                val sel = v in on
                Row(Modifier.clip(RoundedCornerShape(999.dp)).background(if (sel) c.accentBg else Color(0x0AFFFFFF))
                    .border(1.dp, if (sel) c.accent else Color.Transparent, RoundedCornerShape(999.dp)).pressable { toggle(v) }
                    .padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(v, style = MusixTheme.type.body.copy(fontSize = 12.sp, color = if (sel) c.text else c.textMuted))
                    Text(" $n", style = MusixTheme.type.body.copy(fontSize = 10.sp, color = c.textSubtle))
                }
            }
        }
    }
}
