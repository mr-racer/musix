package ru.musixai.app.feature.library

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
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyGridScope
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.dropShadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.shadow.Shadow
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ru.musixai.app.core.data.AlbumSort
import ru.musixai.app.core.designsystem.MusixIcons
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.core.designsystem.component.Cover
import ru.musixai.app.core.designsystem.component.CtaButton
import ru.musixai.app.core.designsystem.component.Empty
import ru.musixai.app.core.designsystem.component.MosaicCover
import ru.musixai.app.core.designsystem.component.MusixField
import ru.musixai.app.core.designsystem.component.pressable
import ru.musixai.app.core.designsystem.component.skeButton
import ru.musixai.app.core.designsystem.component.skeInset
import ru.musixai.app.core.model.AlbumCard
import ru.musixai.app.core.model.Track
import java.text.NumberFormat
import java.util.Locale

@Composable
fun LibraryRoute(onAlbum: (String) -> Unit, onPlaylist: (String) -> Unit, stats: @Composable () -> Unit, vm: LibraryViewModel = hiltViewModel()) {
    val ui by vm.ui.collectAsStateWithLifecycle()
    LibraryScreen(ui, vm, onAlbum, onPlaylist, stats)
}

private val TABS = listOf(LibraryTab.Albums to MusixIcons.Grid, LibraryTab.Recent to MusixIcons.Clock, LibraryTab.Playlists to MusixIcons.List, LibraryTab.Stats to MusixIcons.Bars)

/** v1 `LibrarySection` (golden library-*-phone): the summary card, the search, the four tab
 *  buttons, then the tab — the album grid, recent listening, playlists, or the stats. */
@Composable
fun LibraryScreen(ui: LibraryUi, vm: LibraryViewModel, onAlbum: (String) -> Unit, onPlaylist: (String) -> Unit, stats: @Composable () -> Unit) {
    val c = MusixTheme.colors
    val cols = if (ui.tab == LibraryTab.Albums && ui.grid) 2 else 1
    LazyVerticalGrid(GridCells.Fixed(cols), Modifier.fillMaxSize().background(c.bg).statusBarsPadding(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 20.dp, vertical = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        full { SummaryCard(ui) }
        full {
            MusixField(ui.query, vm::query, "Поиск: песня, альбом или исполнитель", textStyle = MusixTheme.type.body.copy(fontSize = 15.sp))
        }
        full {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for ((t, icon) in TABS) TabButton(icon, ui.tab == t, Modifier.weight(1f)) { vm.tab(t) }
            }
        }
        when (ui.tab) {
            LibraryTab.Albums -> albums(ui, vm, onAlbum)
            LibraryTab.Recent -> recent(ui, vm)
            LibraryTab.Playlists -> playlists(ui, vm, onPlaylist)
            LibraryTab.Stats -> full { stats() }
        }
    }
}

private fun LazyGridScope.full(content: @Composable () -> Unit) = item(span = { GridItemSpan(maxLineSpan) }) { content() }

@Composable
private fun SummaryCard(ui: LibraryUi) {
    val c = MusixTheme.colors
    val s = ui.summary ?: return
    val fmt = NumberFormat.getIntegerInstance(Locale.US)
    val years = ui.years?.let { "${it.first}—${it.last}" }
    Box(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Brush.linearGradient(if (MusixTheme.isDark) listOf(Color(0x80221E30), Color(0x66121119)) else listOf(Color(0xF2FFFFFF), Color(0xCCF6F5FA))))
        .border(1.dp, c.border, RoundedCornerShape(18.dp)).padding(horizontal = 20.dp, vertical = 20.dp), contentAlignment = Alignment.Center) {
        Text(buildAnnotatedString {
            val parts = listOfNotNull(fmt.format(s.counts.tracks) to "треков", fmt.format(s.counts.albums) to "альбомов",
                fmt.format(s.counts.artists) to "артистов", s.genres.toString() to "жанров", years?.let { it to "" })
            parts.forEachIndexed { i, (n, w) ->
                if (i > 0) withStyle(SpanStyle(color = c.textSubtle)) { append("  ·  ") }
                withStyle(SpanStyle(color = c.text, fontWeight = FontWeight.SemiBold)) { append(n) }
                if (w.isNotEmpty()) withStyle(SpanStyle(color = c.textMuted)) { append(" $w") }
            }
        }, textAlign = TextAlign.Center, style = MusixTheme.type.body.copy(fontSize = 16.sp, lineHeight = 1.5.em))
    }
}

@Composable
private fun TabButton(icon: ImageVector, active: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val c = MusixTheme.colors
    val shape = RoundedCornerShape(14.dp)
    Box(
        modifier.height(44.dp)
            .then(if (active) Modifier.dropShadow(shape, Shadow(radius = 16.dp, color = Color(0x665874EA), offset = DpOffset(0.dp, 6.dp)))
                .background(Brush.verticalGradient(listOf(Color(0xFF7584FF), Color(0xFF5D54E6))), shape)
            else Modifier.skeButton(14.dp))
            .pressable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) { Icon(icon, null, Modifier.size(22.dp), tint = if (active) Color.White else c.textMuted) }
}

private fun LazyGridScope.albums(ui: LibraryUi, vm: LibraryViewModel, onAlbum: (String) -> Unit) {
    full {
        val c = MusixTheme.colors
        var menu by remember { mutableStateOf(false) }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("${ui.albums.size} альбомов", Modifier.weight(1f), style = MusixTheme.type.mono.copy(fontSize = 13.sp, letterSpacing = 0.06.em, color = c.textSubtle))
            val label = when (ui.sort) { AlbumSort.Plays -> "слушаю чаще"; AlbumSort.Year -> "по году"; AlbumSort.Title -> "А–Я"; AlbumSort.Added -> "недавние" }
            Text("$label ▾", Modifier.skeInset(RoundedCornerShape(12.dp)).pressable { menu = !menu }.padding(horizontal = 12.dp, vertical = 8.dp),
                style = MusixTheme.type.body.copy(fontSize = 13.sp, color = c.textMuted))
            Spacer(Modifier.size(8.dp))
            Icon(MusixIcons.Grid, "Сетка", Modifier.size(36.dp).then(if (ui.grid) Modifier.skeButton(10.dp) else Modifier).pressable { vm.grid(true) }.padding(8.dp), tint = if (ui.grid) c.accentLight else c.textMuted)
            Icon(MusixIcons.List, "Список", Modifier.size(36.dp).then(if (!ui.grid) Modifier.skeButton(10.dp) else Modifier).pressable { vm.grid(false) }.padding(8.dp), tint = if (!ui.grid) c.accentLight else c.textMuted)
        }
        if (menu) Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            for ((s, l) in listOf(AlbumSort.Plays to "слушаю чаще", AlbumSort.Year to "по году", AlbumSort.Title to "А–Я", AlbumSort.Added to "недавние")) {
                Text(l, Modifier.then(if (s == ui.sort) Modifier.skeButton(10.dp) else Modifier.skeInset(RoundedCornerShape(10.dp)))
                    .pressable { vm.sort(s); menu = false }.padding(horizontal = 10.dp, vertical = 7.dp),
                    style = MusixTheme.type.body.copy(fontSize = 12.sp, color = if (s == ui.sort) c.text else c.textMuted))
            }
        }
    }
    if (ui.albums.isEmpty()) full { Empty() }
    items(ui.albums, key = { it.id }) { a -> if (ui.grid) AlbumTile(a) { onAlbum(a.id) } else AlbumLine(a) { onAlbum(a.id) } }
}

@Composable
private fun AlbumTile(a: AlbumCard, onClick: () -> Unit) {
    val c = MusixTheme.colors
    var bounds by remember { mutableStateOf<androidx.compose.ui.geometry.Rect?>(null) }
    Column(Modifier.pressable { AlbumOrigin.rect = bounds; AlbumOrigin.image = a.image; onClick() }) {
        Box(Modifier.onGloballyPositioned { bounds = it.boundsInRoot() }) {
            Cover(a.image, a.title, a.artist.orEmpty(), Modifier.fillMaxWidth(), size = null, radius = 18.dp)
            Text("${a.tracks} тр", Modifier.align(Alignment.TopEnd).padding(10.dp).clip(RoundedCornerShape(999.dp)).background(Color(0xB30D0D12))
                .padding(horizontal = 10.dp, vertical = 5.dp), style = MusixTheme.type.body.copy(fontSize = 12.sp, color = Color(0xFFEEEEF3)))
        }
        Text(a.title, Modifier.padding(top = 10.dp), maxLines = 1, overflow = TextOverflow.Ellipsis,
            style = MusixTheme.type.body.copy(fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = c.text))
        Text(listOfNotNull(a.artist, a.year?.toString()).joinToString(" · "), maxLines = 1, overflow = TextOverflow.Ellipsis,
            style = MusixTheme.type.body.copy(fontSize = 13.sp, color = c.textMuted))
    }
}

@Composable
private fun AlbumLine(a: AlbumCard, onClick: () -> Unit) {
    val c = MusixTheme.colors
    Row(Modifier.fillMaxWidth().pressable(onClick = onClick), verticalAlignment = Alignment.CenterVertically) {
        Cover(a.image, a.title, a.artist.orEmpty(), size = 52.dp)
        Column(Modifier.weight(1f).padding(horizontal = 14.dp)) {
            Text(a.title, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MusixTheme.type.body.copy(fontSize = 15.sp, fontWeight = FontWeight.Medium, color = c.text))
            Text(listOfNotNull(a.artist, a.year?.toString(), "${a.tracks} тр").joinToString(" · "), maxLines = 1, overflow = TextOverflow.Ellipsis,
                style = MusixTheme.type.body.copy(fontSize = 12.5.sp, color = c.textMuted))
        }
    }
}

private fun LazyGridScope.recent(ui: LibraryUi, vm: LibraryViewModel) {
    if (ui.recent.isEmpty()) full { Empty("Вы ещё ничего не слушали") }
    items(ui.recent.size) { i -> TrackLine(ui.recent[i], ui.images[ui.recent[i].coverImageId]) { vm.play(ui.recent, i, "queue") } }
}

@Composable
fun TrackLine(t: Track, image: ru.musixai.app.core.model.Image?, trailing: (@Composable () -> Unit)? = null, onClick: () -> Unit) {
    val c = MusixTheme.colors
    Row(Modifier.fillMaxWidth().pressable(onClick = onClick), verticalAlignment = Alignment.CenterVertically) {
        Cover(image, t.album ?: t.title, t.artist, size = 46.dp)
        Column(Modifier.weight(1f).padding(horizontal = 14.dp)) {
            Text(t.title, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MusixTheme.type.body.copy(fontSize = 15.sp, fontWeight = FontWeight.Medium, color = c.text))
            Text(t.artist, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MusixTheme.type.body.copy(fontSize = 12.5.sp, color = c.textMuted))
        }
        trailing?.invoke()
    }
}

private fun LazyGridScope.playlists(ui: LibraryUi, vm: LibraryViewModel, onPlaylist: (String) -> Unit) {
    full {
        var name by remember { mutableStateOf("") }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            MusixField(name, { name = it }, "Новый плейлист", Modifier.weight(1f))
            CtaButton("Создать", { if (name.isNotBlank()) { vm.createPlaylist(name.trim()); name = "" } })
        }
    }
    if (ui.playlists.isEmpty()) full { Empty("Плейлистов пока нет") }
    items(ui.playlists.size) { i ->
        val (p, covers) = ui.playlists[i]
        val c = MusixTheme.colors
        Row(Modifier.fillMaxWidth().pressable { onPlaylist(p.id) }, verticalAlignment = Alignment.CenterVertically) {
            MosaicCover(covers, size = 58.dp, radius = 10.dp)
            Column(Modifier.weight(1f).padding(horizontal = 14.dp)) {
                Text(p.name, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MusixTheme.type.body.copy(fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = c.text))
                Text("${p.itemCount} треков", style = MusixTheme.type.body.copy(fontSize = 12.5.sp, color = c.textMuted))
            }
        }
    }
}
