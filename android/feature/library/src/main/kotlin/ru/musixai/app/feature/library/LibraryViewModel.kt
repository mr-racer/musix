package ru.musixai.app.feature.library

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import ru.musixai.app.core.data.AlbumSort
import ru.musixai.app.core.data.CatalogRepository
import ru.musixai.app.core.data.HomeRepository
import ru.musixai.app.core.data.LibraryRepository
import ru.musixai.app.core.data.PlaylistRepository
import ru.musixai.app.core.model.AlbumCard
import ru.musixai.app.core.model.Image
import ru.musixai.app.core.model.LibrarySummary
import ru.musixai.app.core.model.Playlist
import ru.musixai.app.core.model.Track
import ru.musixai.app.core.player.PlayerController
import javax.inject.Inject

enum class LibraryTab { Albums, Recent, Playlists, Stats }

data class LibraryUi(
    val tab: LibraryTab = LibraryTab.Albums,
    val summary: LibrarySummary? = null,
    val years: IntRange? = null,
    val albums: List<AlbumCard> = emptyList(),
    val sort: AlbumSort = AlbumSort.Plays,
    val grid: Boolean = true,
    val query: String = "",
    val recent: List<Track> = emptyList(),
    val images: Map<String, Image> = emptyMap(),
    val playlists: List<Pair<Playlist, List<Image?>>> = emptyList(),
)

@HiltViewModel
class LibraryViewModel @Inject constructor(
    private val catalog: CatalogRepository,
    home: HomeRepository,
    private val playlists: PlaylistRepository,
    private val library: LibraryRepository,
    private val player: PlayerController,
) : ViewModel() {
    private val local = MutableStateFlow(LibraryUi())
    private val sort = local.map { it.sort }

    val ui: StateFlow<LibraryUi> = combine(
        local, catalog.summary, catalog.years, catalog.albums(sort), home.home,
    ) { l, s, y, albums, h ->
        val q = l.query.trim().lowercase()
        l.copy(summary = s, years = y, recent = h.recent, images = h.images,
            albums = if (q.isEmpty()) albums else albums.filter { q in it.title.lowercase() || q in (it.artist ?: "").lowercase() })
    }.combine(playlistCards()) { u, p -> u.copy(playlists = p) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), LibraryUi())

    private fun playlistCards() = combine(playlists.playlists, playlists.covers) { ps, covers ->
        val ids = covers.values.flatten().distinct()
        val imgs = library.images(ids)
        ps.map { p -> p to covers[p.id].orEmpty().take(4).map { imgs[it] } }
    }

    init { viewModelScope.launch { runCatching { catalog.refresh() } } }

    fun tab(t: LibraryTab) = local.update { it.copy(tab = t) }
    fun sort(s: AlbumSort) = local.update { it.copy(sort = s) }
    fun grid(g: Boolean) = local.update { it.copy(grid = g) }
    fun query(q: String) = local.update { it.copy(query = q) }
    fun play(tracks: List<Track>, index: Int, context: String) = player.playTracks(tracks.map { it.id }, index, context)
    fun createPlaylist(name: String) = viewModelScope.launch { playlists.create(name) }
}
