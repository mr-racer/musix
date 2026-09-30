package ru.musixai.app.feature.library

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import ru.musixai.app.core.data.CatalogRepository
import ru.musixai.app.core.data.LibraryRepository
import ru.musixai.app.core.data.PlaylistRepository
import ru.musixai.app.core.designsystem.MusixIcons
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.core.designsystem.component.Cover
import ru.musixai.app.core.designsystem.component.CtaButton
import ru.musixai.app.core.designsystem.component.MosaicCover
import ru.musixai.app.core.designsystem.component.MusixField
import ru.musixai.app.core.designsystem.component.RoundGlassButton
import ru.musixai.app.core.designsystem.component.pressable
import ru.musixai.app.core.model.Image
import ru.musixai.app.core.model.PlaylistEntry
import ru.musixai.app.core.model.Track
import ru.musixai.app.core.player.PlayerController
import javax.inject.Inject

data class AlbumUi(val title: String = "", val artist: String? = null, val year: Int? = null, val image: Image? = null, val tracks: List<Track> = emptyList(), val artistId: String? = null)

@HiltViewModel
class AlbumViewModel @Inject constructor(state: SavedStateHandle, catalog: CatalogRepository, library: LibraryRepository, private val player: PlayerController) : ViewModel() {
    private val id: String = checkNotNull(state["id"])
    val ui: StateFlow<AlbumUi> = combine(flow { emit(catalog.album(id)) }, catalog.albumTracks(id)) { a, tracks ->
        val img = (a?.coverImageId ?: tracks.firstOrNull()?.coverImageId)?.let { library.images(listOf(it))[it] }
        AlbumUi(a?.title ?: tracks.firstOrNull()?.album.orEmpty(), tracks.firstOrNull()?.artists?.firstOrNull()?.name ?: tracks.firstOrNull()?.artist,
            a?.year ?: tracks.firstOrNull()?.year, img, tracks, tracks.firstOrNull()?.artists?.firstOrNull()?.id)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), AlbumUi())

    fun play(index: Int) = player.playTracks(ui.value.tracks.map { it.id }, index, "album")
}

/** An album is v1's gatefold (Gatefold.kt), shown as a full-screen dialog destination so the
 *  screen it was opened from stays underneath, dimmed, as in v1. */
@Composable
fun AlbumRoute(onBack: () -> Unit, onArtist: (String) -> Unit = {}, vm: AlbumViewModel = hiltViewModel()) {
    val ui by vm.ui.collectAsStateWithLifecycle()
    Gatefold(ui, onPlay = vm::play, onArtist = ui.artistId?.let { id -> { onArtist(id) } }, onClosed = onBack)
}

internal fun fmtDur(ms: Long) = (ms / 1000).let { "%d:%02d".format(it / 60, it % 60) }

data class PlaylistUi(val name: String = "", val entries: List<PlaylistEntry> = emptyList(), val images: Map<String, Image> = emptyMap())

@HiltViewModel
class PlaylistViewModel @Inject constructor(state: SavedStateHandle, private val repo: PlaylistRepository, library: LibraryRepository, private val player: PlayerController) : ViewModel() {
    val id: String = checkNotNull(state["id"])
    val ui: StateFlow<PlaylistUi> = combine(repo.playlists.map { ps -> ps.firstOrNull { it.id == id }?.name.orEmpty() }, repo.entries(id)) { name, entries ->
        PlaylistUi(name, entries, library.images(entries.mapNotNull { it.track.coverImageId }))
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), PlaylistUi())

    fun play(index: Int) = player.playTracks(ui.value.entries.map { it.track.id }, index, "playlist")
    fun rename(name: String) = viewModelScope.launch { repo.rename(id, name) }
    fun remove(itemId: String) = viewModelScope.launch { repo.remove(id, itemId) }
    fun moveUp(i: Int) = viewModelScope.launch {
        val e = ui.value.entries
        if (i <= 0) return@launch
        repo.move(id, e[i].itemId, e.getOrNull(i - 2)?.itemId)
    }
    fun delete(done: () -> Unit) = viewModelScope.launch { repo.delete(id); done() }
}

/** A playlist: edits land in Room at once and reach the server through the outbox, so they
 *  work offline (spec §2). */
@Composable
fun PlaylistRoute(onBack: () -> Unit, vm: PlaylistViewModel = hiltViewModel()) {
    val ui by vm.ui.collectAsStateWithLifecycle()
    val c = MusixTheme.colors
    var editing by remember { mutableStateOf(false) }
    var draft by remember(ui.name) { mutableStateOf(ui.name) }
    LazyColumn(Modifier.fillMaxSize().background(c.bg).statusBarsPadding(), contentPadding = androidx.compose.foundation.layout.PaddingValues(20.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item { RoundGlassButton(onBack, size = 40.dp) { Icon(MusixIcons.ChevronLeft, "Назад", Modifier.size(18.dp), tint = c.text) } }
        item {
            Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                MosaicCover(ui.entries.take(4).map { e -> e.track.coverImageId?.let { ui.images[it] } }, size = 180.dp, radius = 16.dp)
                if (editing) Row(Modifier.padding(top = 14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    MusixField(draft, { draft = it }, "Название", Modifier.weight(1f))
                    CtaButton("OK", { vm.rename(draft.trim()); editing = false })
                } else Text(ui.name, Modifier.padding(top = 14.dp).pressable { editing = true }, style = MusixTheme.type.body.copy(fontSize = 22.sp, fontWeight = FontWeight.Bold, color = c.text))
                Text("${ui.entries.size} треков", style = MusixTheme.type.body.copy(fontSize = 13.sp, color = c.textMuted))
                Row(Modifier.padding(top = 14.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    CtaButton("Слушать", { vm.play(0) })
                    Text("Удалить", Modifier.pressable { vm.delete(onBack) }.padding(12.dp), style = MusixTheme.type.body.copy(fontSize = 14.sp, color = c.red))
                }
            }
        }
        itemsIndexed(ui.entries, key = { _, e -> e.itemId }) { i, e ->
            TrackLine(e.track, e.track.coverImageId?.let { ui.images[it] }, trailing = {
                Row {
                    if (i > 0) Icon(MusixIcons.ChevronLeft, "Выше", Modifier.size(36.dp).pressable { vm.moveUp(i) }.padding(9.dp), tint = c.textSubtle)
                    Icon(MusixIcons.Close, "Убрать", Modifier.size(36.dp).pressable { vm.remove(e.itemId) }.padding(10.dp), tint = c.textSubtle)
                }
            }) { vm.play(i) }
        }
    }
}
