package ru.musixai.app.feature.artist

import ru.musixai.app.core.designsystem.text
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import coil3.compose.AsyncImage
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import ru.musixai.app.core.data.ArtistRepository
import ru.musixai.app.core.data.LibraryRepository
import ru.musixai.app.core.designsystem.MusixIcons
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.core.designsystem.control.GlassPlayButton
import ru.musixai.app.core.designsystem.gesture.Press
import ru.musixai.app.core.designsystem.gesture.pressable
import ru.musixai.app.core.designsystem.motion.FlightKey
import ru.musixai.app.core.designsystem.motion.LocalFlightSources
import ru.musixai.app.core.designsystem.motion.WordFlight
import ru.musixai.app.core.designsystem.motion.rememberFlightLocals
import ru.musixai.app.core.designsystem.motion.rememberReducedMotion
import ru.musixai.app.core.designsystem.surface.GlassTone
import ru.musixai.app.core.designsystem.surface.HeadButton
import ru.musixai.app.core.designsystem.surface.HeadPlay
import ru.musixai.app.core.designsystem.surface.LocalToasts
import ru.musixai.app.core.designsystem.surface.MorphFrom
import ru.musixai.app.core.designsystem.surface.MorphMenu
import ru.musixai.app.core.designsystem.surface.ProvideGlassSource
import ru.musixai.app.core.designsystem.surface.ScrollHead
import ru.musixai.app.core.designsystem.surface.glassInk
import ru.musixai.app.core.designsystem.surface.glassSource
import ru.musixai.app.core.designsystem.surface.rememberGlassSource
import ru.musixai.app.core.designsystem.surface.rememberMorph
import ru.musixai.app.core.model.ArtistPage
import ru.musixai.app.core.player.PlayerController
import ru.musixai.app.core.player.PlayerState
import javax.inject.Inject

/** Where [trackId] waits in the queue after the playing song (1 = next), 0 = not queued. */
internal fun queuedAt(s: PlayerState, trackId: String): Int =
    s.queue.firstOrNull { it.index > s.index && it.trackId == trackId }?.let { it.index - s.index } ?: 0

/** «Играть следующим», and a second tap takes it back. */
internal fun PlayerController.toggleNext(trackId: String) {
    val s = state.value
    val q = queuedAt(s, trackId)
    if (q > 0) remove(s.index + q) else playNext(trackId)
}

@HiltViewModel
class ArtistViewModel @Inject constructor(
    state: SavedStateHandle,
    private val repo: ArtistRepository,
    private val library: LibraryRepository,
    private val player: PlayerController,
) : ViewModel() {
    val id: String = checkNotNull(state["id"])
    // what is in memory first (the album prefetches its artist): the page stands at once
    private val page = MutableStateFlow<ArtistPage?>(repo.cached(id))
    internal val ui: StateFlow<ArtistUi?> = page.map { it?.ui() }.stateIn(viewModelScope, SharingStarted.Eagerly, repo.cached(id)?.ui())
    val error = MutableStateFlow(false)
    val offline = MutableStateFlow(false)
    val playerState: StateFlow<PlayerState> = player.state
    val messages = MutableSharedFlow<String>(extraBufferCapacity = 2)
    private val _songs = MutableStateFlow<List<Song>?>(null)
    internal val songs: StateFlow<List<Song>?> = _songs

    /** The artist is on right now: «Слушать» turns into «Пауза». */
    val playingHere: StateFlow<Boolean> = combine(player.state, page) { s, p ->
        s.isPlaying && p != null && s.artist.contains(p.artist.name, ignoreCase = true)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), false)

    init { load() }

    fun load() {
        error.value = false
        viewModelScope.launch {
            runCatching { repo.page(id) }
                .onSuccess { page.value = it; offline.value = false }
                .onFailure { if (page.value == null) error.value = true else offline.value = true }
        }
    }

    fun playArtist() {
        if (playingHere.value) { player.toggle(); return }
        val p = page.value ?: return
        player.playTracks((p.topTracks + p.appearsOn).distinctBy { it.id }.map { it.id }, 0, "artist")
    }

    /** «Поток артиста»: the stream around the artist (`/stream/artist`). */
    fun flow() = viewModelScope.launch {
        runCatching { repo.stream(id) }
            .onSuccess { ids -> if (ids.isNotEmpty()) player.playTracks(ids, 0, "artist-stream") else messages.tryEmit("Поток пока не собрался — мало песен рядом") }
            .onFailure { messages.tryEmit("Нет сети — поток соберётся, когда она вернётся") }
    }

    fun loadSongs() {
        if (_songs.value != null) return
        viewModelScope.launch {
            val tracks = library.tracks(library.artistTrackIds(id))
            val images = library.images(tracks.mapNotNull { it.coverImageId }.toSet())
            val plays = page.value?.plays.orEmpty()
            _songs.value = tracks.map { Song(it, plays[it.id] ?: 0, it.album, it.coverImageId?.let { i -> images[i]?.url(128) }) }
                .sortedWith(compareByDescending<Song> { it.plays }.thenBy { it.track.year ?: 9999 }.thenBy { it.album.orEmpty() }.thenBy { it.track.discNo ?: 0 }.thenBy { it.track.trackNo ?: 0 })
        }
    }

    fun playSong(i: Int) { _songs.value?.let { s -> player.playTracks(s.map { it.track.id }, i, "artist") } }
    fun queue(trackId: String) = player.toggleNext(trackId)
}

/** The artist page's own name, the spot a tapped name flies into (not the shared key: that one is the name tapped). */
internal data class ArtistTitle(val id: String)

/** A tiny mutable box for coordinates read in callbacks and the draw phase (never composition). */
internal class Holder<T>(var v: T)

/**
 * The artist «А · Конверт» (2026-11-15 mock, artist-album-review): the frame — the photo, its
 * blurred lower half, the name or logo, the facts and the glass play; then what there is and the flow; the
 * discography on its axis of years; «Ты и …» under it (the owner, 2026-11-15: the discography goes
 * higher); the biography and all the songs in matte-glass sheets. A head of matte glass slides in
 * beside the back button once the frame is gone, the same 48 dp tall.
 */
@Composable
fun ArtistRoute(onBack: () -> Unit, onAlbum: (String) -> Unit, vm: ArtistViewModel = hiltViewModel()) {
    val ui by vm.ui.collectAsStateWithLifecycle()
    val error by vm.error.collectAsStateWithLifecycle()
    val offline by vm.offline.collectAsStateWithLifecycle()
    val ps by vm.playerState.collectAsStateWithLifecycle()
    val playingHere by vm.playingHere.collectAsStateWithLifecycle()
    val songs by vm.songs.collectAsStateWithLifecycle()
    val c = MusixTheme.colors
    val reduced = rememberReducedMotion()
    val scroll = rememberScrollState()
    val src = rememberGlassSource()
    val sources = LocalFlightSources.current
    val locals = rememberFlightLocals()
    val toasts = LocalToasts.current
    val density = LocalDensity.current
    var bioOpen by remember { mutableStateOf(false) }
    var songsOpen by remember { mutableStateOf(false) }
    var pathOpen by remember { mutableStateOf(false) }
    var grammyOpen by remember { mutableStateOf(false) }
    var pathAnchor by remember { mutableStateOf<Rect?>(null) }
    var grammyAnchor by remember { mutableStateOf<Rect?>(null) }
    var frameShown by remember { mutableStateOf(true) }
    val root = remember { Holder<LayoutCoordinates?>(null) }
    val frame = remember { Holder<LayoutCoordinates?>(null) }
    LaunchedEffect(vm) { vm.messages.collect { toasts?.show(it) } }
    fun local(co: LayoutCoordinates): Rect? = root.v?.takeIf { it.isAttached && co.isAttached }?.localBoundingBoxOf(co, clipBounds = false)

    BoxWithConstraints(Modifier.fillMaxSize().background(c.bg).onGloballyPositioned { root.v = it }) {
        val w = maxWidth
        val fh = frameHeight(w, maxHeight)
        val pad = pagePad(w)
        val pathMorph = rememberMorph(pathOpen, reduced)
        val grammyMorph = rememberMorph(grammyOpen, reduced)
        // the entry: the photo grows out of the circle it was touched on; a name flies into the name
        LaunchedEffect(Unit) {
            val s = sources ?: return@LaunchedEffect
            if (s.still) return@LaunchedEffect
            val photo = s.pressed(FlightKey.artistPhoto(vm.id))
            val word = if (photo == null) s.pressed(FlightKey.artistName(vm.id)) else null
            val from = (photo ?: word)?.rect() ?: return@LaunchedEffect
            if (photo != null) {
                frameShown = false
                s.launch(locals) { done -> FrameFlight(photo, from, { vm.ui.value }, { frame.v?.rootRect() }, w, fh, onLand = { frameShown = true }, done = done) }
            } else if (word != null) {
                // the name is hidden at once (the flight starts a frame later) and comes in under the flyer
                s.hide(ArtistTitle(vm.id))
                s.launch(locals) { done -> WordFlight(word, from, ArtistTitle(vm.id), s, done = done) }
                return@LaunchedEffect
            }
            // whatever happens to a flyer, the page never stays without its frame
            delay(1600); frameShown = true
        }
        // the glass reads the page with its colour under it: blurred over nothing, words would stay sharp through it
        Column(Modifier.fillMaxSize().glassSource(src).background(c.bg).verticalScroll(scroll)) {
            Box(Modifier.fillMaxWidth().height(fh).onGloballyPositioned { frame.v = it }.graphicsLayer { alpha = if (frameShown) 1f else 0f }) {
                FrameArt(ui, { 1f }, Modifier.fillMaxSize())
                FrameText(ui, w, Modifier.align(Alignment.BottomStart), nameSpot = ArtistTitle(vm.id),
                    onGrammy = { co -> grammyAnchor = local(co); grammyOpen = true })
            }
            val u = ui
            when {
                u == null && error -> StateBox("Не получилось загрузить артиста", "Проверь сеть — и попробуем ещё раз.", pad) { vm.load() }
                u == null -> BodySkeleton(pad)
                else -> {
                    Column(Modifier.padding(horizontal = pad)) {
                        MetaLine(u, onSongs = { vm.loadSongs(); songsOpen = true }, onBio = { bioOpen = true })
                        // the play is the glass button on the photo; the flow stays a soft pill under the words
                        BigPill("Поток артиста", MusixIcons.Sparkles, { vm.flow() }, Modifier.padding(top = 12.dp).fillMaxWidth(), enabled = !offline)
                        if (offline) Text("Нет сети — показываю то, что сохранено на телефоне", Modifier.padding(top = 10.dp),
                            style = MusixTheme.text.caption.copy(fontSize = 13.sp, color = c.textSubtle))
                        // the discography first (the owner, 2026-11-15), then the listener and the artist
                        Row(Modifier.padding(top = 28.dp, bottom = 16.dp), verticalAlignment = Alignment.Bottom) {
                            Text("Дискография", Modifier.weight(1f), style = MusixTheme.text.title.copy(fontSize = 22.sp, fontWeight = FontWeight.Bold, letterSpacing = (-0.025).em, color = c.text))
                            Text(if (u.albums.size == 1) "один альбом" else u.range, style = MusixTheme.text.number.copy(fontSize = 12.5.sp, color = c.textSubtle))
                        }
                    }
                    DiscoAxis(u, w) { onAlbum(it.id) }
                    // «Путь фаната» grows out of the strip (drawn over the page below); the strip melts under it
                    YouStrip(u, onOpen = { co -> pathAnchor = local(co); pathOpen = true }, Modifier.padding(start = pad, end = pad, top = 26.dp), alpha = { pathMorph.anchorAlpha })
                    Spacer(Modifier.height(40.dp))
                }
            }
        }
        // the play: clear glass on the photo, at the right of the facts (the owner, 2026-11-15: the blue pill
        // «вообще не вписывается»). Outside the recorded page — glass that read itself would loop — so it rides
        // the scroll by hand; it comes in once the frame has landed and is gone at once while a photo flies.
        val playOn = frameShown && ui != null
        val playIn by animateFloatAsState(if (playOn) 1f else 0f, if (!playOn || reduced) snap() else spring(dampingRatio = 0.8f, stiffness = 380f), label = "play")
        if (playIn > 0.001f) GlassPlayButton(
            playingHere, vm::playArtist, src,
            Modifier.offset { IntOffset((w - pad - PlaySize).roundToPx(), (fh - FrameTextBottom - PlaySize).roundToPx() - scroll.value) }
                .graphicsLayer { alpha = playIn; val s = 0.86f + 0.14f * playIn; scaleX = s; scaleY = s },
            size = PlaySize,
        )
        val headOn by remember { derivedStateOf { scroll.value > with(density) { (fh - 96.dp).toPx() } } }
        ScrollHead(headOn, src, veil = c.bg) {
            val u = ui
            AsyncImage(u?.photo?.url(128), null, Modifier.size(34.dp).clip(CircleShape).background(c.plate), contentScale = ContentScale.Crop)
            Column(Modifier.weight(1f)) {
                Text(u?.name.orEmpty(), maxLines = 1, overflow = TextOverflow.Ellipsis, style = MusixTheme.text.body.copy(fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = glassInk()))
                if (u != null) Text("${u.albums.size} ${albumsW(u.albums.size)} · ${u.standing.level.name}", maxLines = 1, overflow = TextOverflow.Ellipsis,
                    style = MusixTheme.text.caption.copy(fontSize = 12.sp, color = glassInk(soft = true)))
            }
            HeadPlay(playingHere, vm::playArtist)
        }
        HeadButton(MusixIcons.ChevronLeft, "Назад", onBack, source = src, onArt = !headOn)
        ProvideGlassSource(src) {
            val u = ui
            if (u != null) {
                // the card itself grows into «Путь фаната» (the owner, 2026-11-15: «со всеми его границами»)
                MorphMenu(pathMorph, pathAnchor, onClose = { pathOpen = false }, radiusFrom = YouRadius, scrim = 0.3f, tilt = 9f,
                    from = MorphFrom(fill = youFill().compositeOver(c.bg), rim = c.border, face = { YouFace(u) })) { FanPath(u) }
                MorphMenu(grammyMorph, grammyAnchor, onClose = { grammyOpen = false }, radiusFrom = 15.dp, scrim = 0.12f, glass = GlassTone.Deep) { GrammyCase(u) }
            }
        }
        ui?.let { u -> BioSheet(bioOpen, u) { bioOpen = false } }
        SongsSheet(songsOpen, songs, ps.trackId, ps.isPlaying, queued = { queuedAt(ps, it) }, onPlay = vm::playSong, onQueue = vm::queue) { songsOpen = false }
    }
}

@Composable
private fun MetaLine(u: ArtistUi, onSongs: () -> Unit, onBio: () -> Unit) {
    val c = MusixTheme.colors
    val st = MusixTheme.text.body.copy(fontSize = 14.sp, color = c.textMuted)
    Row(Modifier.heightIn(min = 30.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
        Text("${u.albums.size} ${albumsW(u.albums.size)}", style = st, maxLines = 1)
        Text("·", style = st.copy(color = c.textMuted.copy(alpha = 0.45f)))
        MetaLink("${u.tracks} ${songs(u.tracks)}", onSongs)
        if (u.bio.isNotEmpty()) {
            Text("·", style = st.copy(color = c.textMuted.copy(alpha = 0.45f)))
            MetaLink("Биография", onBio)
        }
    }
}

@Composable
private fun MetaLink(text: String, onClick: () -> Unit) {
    val c = MusixTheme.colors
    Row(Modifier.heightIn(min = 30.dp).pressable(role = Press.Chip, onClick = onClick), verticalAlignment = Alignment.CenterVertically) {
        Text(text, maxLines = 1, style = MusixTheme.text.body.copy(fontSize = 14.sp, fontWeight = FontWeight.Medium, color = c.text))
        Icon(MusixIcons.ChevronRight, null, Modifier.size(15.dp), tint = c.textSubtle)
    }
}

/** A big soft pill (48 dp): the artist's flow, «Повторить». The plays are glass ([GlassPlayButton]). */
@Composable
internal fun BigPill(text: String, icon: ImageVector, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
    val c = MusixTheme.colors
    val soft = if (MusixTheme.isDark) Color.White.copy(alpha = 0.08f) else Color.Black.copy(alpha = 0.055f)
    Row(
        modifier.height(48.dp).graphicsLayer { alpha = if (enabled) 1f else 0.45f }
            .pressable(enabled = enabled, role = Press.Chip, onClick = onClick)
            .background(soft, RoundedCornerShape(24.dp)).padding(horizontal = 12.dp),
        horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, null, Modifier.size(18.dp), tint = c.accent)
        Spacer(Modifier.width(8.dp))
        Text(text, maxLines = 1, style = MusixTheme.text.label.copy(fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = c.text))
    }
}

@Composable
private fun BodySkeleton(pad: Dp) {
    Column(Modifier.padding(horizontal = pad)) {
        ru.musixai.app.core.designsystem.content.Skel(Modifier.padding(top = 8.dp).size(220.dp, 14.dp), 7.dp)
        ru.musixai.app.core.designsystem.content.Skel(Modifier.padding(top = 12.dp).fillMaxWidth().height(48.dp), 24.dp)
        Row(Modifier.padding(top = 40.dp), horizontalArrangement = Arrangement.spacedBy(40.dp)) {
            ru.musixai.app.core.designsystem.content.Skel(Modifier.weight(1f).aspectRatio(1f), 8.dp)
            Spacer(Modifier.weight(1f))
        }
    }
}

@Composable
private fun StateBox(title: String, text: String, pad: Dp, onRetry: () -> Unit) {
    val c = MusixTheme.colors
    Column(Modifier.fillMaxWidth().padding(horizontal = pad, vertical = 40.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(title, style = MusixTheme.text.body.copy(fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = c.text))
        Text(text, Modifier.padding(top = 6.dp), style = MusixTheme.text.reading.copy(fontSize = 14.sp, color = c.textMuted))
        BigPill("Повторить", MusixIcons.Shuffle, onRetry, Modifier.padding(top = 16.dp).widthIn(min = 160.dp))
    }
}
