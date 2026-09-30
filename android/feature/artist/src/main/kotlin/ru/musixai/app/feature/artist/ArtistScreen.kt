package ru.musixai.app.feature.artist

import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
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
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import ru.musixai.app.core.data.ArtistRepository
import ru.musixai.app.core.designsystem.component.rise
import ru.musixai.app.core.designsystem.MusixIcons
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.core.designsystem.component.Cover
import ru.musixai.app.core.designsystem.component.Eyebrow
import ru.musixai.app.core.designsystem.component.RoundGlassButton
import ru.musixai.app.core.designsystem.component.Skel
import ru.musixai.app.core.designsystem.component.pressable
import ru.musixai.app.core.designsystem.oklch
import ru.musixai.app.core.model.ArtistPage
import ru.musixai.app.core.player.PlayerController
import javax.inject.Inject

@HiltViewModel
class ArtistViewModel @Inject constructor(state: SavedStateHandle, private val repo: ArtistRepository, private val player: PlayerController) : ViewModel() {
    private val id: String = checkNotNull(state["id"])
    private val _page = MutableStateFlow<ArtistPage?>(null)
    val page: StateFlow<ArtistPage?> = _page
    val error = MutableStateFlow(false)

    init { viewModelScope.launch { runCatching { repo.page(id) }.onSuccess { _page.value = it }.onFailure { error.value = true } } }

    /** «Включить артиста»: the top tracks as a queue; autoplay continues from the last one. */
    fun playArtist() = _page.value?.let { p -> player.playTracks((p.topTracks + p.appearsOn).distinctBy { it.id }.map { it.id }, 0, "artist") }
    fun play(i: Int) = _page.value?.let { p -> player.playTracks(p.topTracks.map { it.id }, i, "artist") }
}

private val DOSSIER = listOf("name_origin" to "Откуда название", "formed_place" to "Откуда", "formed_year" to "Год основания",
    "grammy_wins" to "Грэмми", "status" to "Статус", "active_from" to "Активны с")

/** v1 `ArtistAtlas` (golden artist-*-phone): the photo on its dark field, the name, the
 *  library's view of the artist, «Включить артиста», the AI bio, the dossier, the albums. */
@Composable
fun ArtistRoute(onBack: () -> Unit, onAlbum: (String) -> Unit, vm: ArtistViewModel = hiltViewModel()) {
    val p by vm.page.collectAsStateWithLifecycle()
    val c = MusixTheme.colors
    Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(if (MusixTheme.isDark) Color(0xFF0B0B10) else c.surface, c.bg)))) {
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).statusBarsPadding()) {
            Row(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                RoundGlassButton(onBack, size = 38.dp) { Icon(MusixIcons.ChevronLeft, "Назад", Modifier.size(18.dp), tint = c.text) }
                Text("БИБЛИОТЕКА / ${p?.artist?.name?.uppercase().orEmpty()}", Modifier.padding(start = 12.dp), maxLines = 1, overflow = TextOverflow.Ellipsis,
                    style = MusixTheme.type.mono.copy(fontSize = 11.sp, letterSpacing = 0.16.em, color = c.textMuted))
            }
            val page = p
            if (page == null) { Skel(Modifier.padding(20.dp).fillMaxWidth().height(320.dp), 18.dp); return@Column }
            Box(Modifier.fillMaxWidth().aspectRatio(1.3f)) {
                val img = page.artist.imageId?.let { page.images[it] }
                AsyncImage(img?.url(1024), null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
                Canvas(Modifier.fillMaxSize()) { drawRect(Brush.verticalGradient(0.55f to Color.Transparent, 1f to c.bg)) }
            }
            Column(Modifier.padding(horizontal = 20.dp)) {
                Text(page.artist.name, style = MusixTheme.type.serif.copy(fontSize = 52.sp, fontWeight = FontWeight.Light, lineHeight = 1.05.em, color = c.text))
                val genre = page.topTracks.mapNotNull { it.genre }.groupingBy { it }.eachCount().maxByOrNull { it.value }?.key
                val place = page.facets["formed_place"]
                listOfNotNull(genre, place).takeIf { it.isNotEmpty() }?.let {
                    Text(it.joinToString(" · ").uppercase(), Modifier.padding(top = 10.dp), style = MusixTheme.type.mono.copy(fontSize = 13.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 0.16.em, color = Color(0xFFD9D2FF)))
                }
                val years = (page.topTracks + page.appearsOn).mapNotNull { it.year }.filter { it > 0 }
                if (years.isNotEmpty()) Text("Десятилетия в твоей библиотеке · ${years.min() / 10 * 10}S–${years.max() / 10 * 10}S", Modifier.padding(top = 12.dp),
                    style = MusixTheme.type.mono.copy(fontSize = 12.sp, letterSpacing = 0.08.em, color = c.textMuted))
                Text("${page.albums.size} АЛЬБОМОВ · ${page.trackCount} ТРЕКОВ", Modifier.padding(top = 6.dp), style = MusixTheme.type.mono.copy(fontSize = 12.sp, letterSpacing = 0.1.em, color = c.textMuted))
                PlayPill(vm::playArtist)
                // v1's section cascade (lib-rise): bio .08 s → dossier .16 s → albums .24 s
                page.bio?.let { Column(Modifier.rise(80, blur = 5.dp)) { Bio(it) } }
                Box(Modifier.rise(160, blur = 5.dp)) { Dossier(page) }
                if (page.albums.isNotEmpty()) Column(Modifier.rise(240, blur = 5.dp)) {
                    Eyebrow("Альбомы", Modifier.padding(top = 26.dp, bottom = 12.dp))
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                        items(page.albums) { a -> Column(Modifier.width(140.dp).pressable { onAlbum(a.id) }) {
                            Cover(a.image, a.title, a.artist.orEmpty(), size = 140.dp, radius = 14.dp)
                            Text(a.title, Modifier.padding(top = 8.dp), maxLines = 1, overflow = TextOverflow.Ellipsis, style = MusixTheme.type.body.copy(fontSize = 14.sp, fontWeight = FontWeight.Medium, color = c.text))
                            Text(listOfNotNull(a.year?.toString(), "${a.tracks} тр").joinToString(" · "), style = MusixTheme.type.body.copy(fontSize = 12.sp, color = c.textMuted))
                        } }
                    }
                }
                if (page.topTracks.isNotEmpty()) Column(Modifier.rise(300, blur = 5.dp)) {
                    Eyebrow("Чаще всего", Modifier.padding(top = 26.dp, bottom = 8.dp))
                    page.topTracks.take(10).forEachIndexed { i, t ->
                        Row(Modifier.fillMaxWidth().pressable { vm.play(i) }.padding(vertical = 7.dp), verticalAlignment = Alignment.CenterVertically) {
                            Cover(t.coverImageId?.let { page.images[it] }, t.album ?: t.title, t.artist, size = 44.dp)
                            Text(t.title, Modifier.weight(1f).padding(horizontal = 14.dp), maxLines = 1, overflow = TextOverflow.Ellipsis, style = MusixTheme.type.body.copy(fontSize = 15.sp, color = c.text))
                        }
                    }
                }
                Spacer(Modifier.height(32.dp))
            }
        }
    }
}

@Composable
private fun PlayPill(onClick: () -> Unit) {
    val c = MusixTheme.colors
    Row(Modifier.padding(top = 22.dp).fillMaxWidth().clip(RoundedCornerShape(999.dp))
        .background(Brush.horizontalGradient(if (MusixTheme.isDark) listOf(Color(0xFF14141E), Color(0xFF1A1830)) else listOf(Color.White, Color(0xFFF3F2F8))))
        .border(1.dp, if (MusixTheme.isDark) Color(0x2EFFFFFF) else Color(0x14000000), RoundedCornerShape(999.dp)).pressable(onClick = onClick).padding(vertical = 12.dp),
        horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(42.dp).clip(CircleShape).background(Brush.radialGradient(listOf(Color(0xFF8A96FF), Color(0xFF4F46E0)))), contentAlignment = Alignment.Center) {
            Icon(MusixIcons.Play, null, Modifier.size(16.dp), tint = Color.White)
        }
        Text("ВКЛЮЧИТЬ АРТИСТА", Modifier.padding(start = 16.dp), style = MusixTheme.type.mono.copy(fontSize = 14.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 0.18.em, color = c.text))
    }
}

@Composable
private fun Bio(text: String) {
    val c = MusixTheme.colors
    var open by remember { mutableStateOf(false) }
    Row(Modifier.padding(top = 26.dp), verticalAlignment = Alignment.CenterVertically) {
        Eyebrow("Биография")
        Text("AI", Modifier.padding(start = 12.dp).border(1.dp, Color(0x809A7BFF), RoundedCornerShape(999.dp)).padding(horizontal = 10.dp, vertical = 2.dp),
            style = MusixTheme.type.mono.copy(fontSize = 10.sp, color = Color(0xFF9A7BFF)))
    }
    Text(text, Modifier.padding(top = 14.dp).animateContentSize(), maxLines = if (open) Int.MAX_VALUE else 7, overflow = TextOverflow.Ellipsis,
        style = MusixTheme.type.serif.copy(fontSize = 17.sp, lineHeight = 1.55.em, color = c.text))
    Text(if (open) "свернуть ↑" else "читать дальше ↓", Modifier.padding(top = 10.dp).pressable { open = !open }, style = MusixTheme.type.body.copy(fontSize = 15.sp, color = c.accentLight))
}

@Composable
private fun Dossier(page: ArtistPage) {
    val c = MusixTheme.colors
    val rows = DOSSIER.mapNotNull { (k, label) -> page.facets[k]?.let { label to it } }
    if (rows.isEmpty()) return
    Column(Modifier.padding(top = 24.dp).fillMaxWidth().clip(RoundedCornerShape(22.dp)).background(Brush.linearGradient(listOf(Color(0xFF17171C), Color(0xFF0D0D12))))
        .border(1.dp, c.border, RoundedCornerShape(22.dp)).padding(22.dp)) {
        Eyebrow("Досье", Modifier.padding(bottom = 14.dp))
        for ((label, value) in rows) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(8.dp).clip(CircleShape).background(oklch(78f, 0.13f, 125f)))
                Text(label.uppercase(), Modifier.padding(start = 10.dp), style = MusixTheme.type.mono.copy(fontSize = 12.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 0.16.em, color = c.textMuted))
            }
            Text(value, Modifier.padding(top = 6.dp, bottom = 14.dp), style = MusixTheme.type.serif.copy(fontSize = 16.sp, lineHeight = 1.5.em, color = c.text))
        }
    }
}
