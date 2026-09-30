package ru.musixai.app.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.navigation.NavDestination.Companion.hasRoute
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import ru.musixai.app.core.data.AuthRepository
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.core.player.PlayerController
import ru.musixai.app.feature.auth.LoginRoute
import ru.musixai.app.feature.home.HomeRoute
import ru.musixai.app.feature.player.MiniPlayer
import ru.musixai.app.feature.player.PlayerRoute
import ru.musixai.app.feature.library.AlbumRoute
import ru.musixai.app.feature.library.LibraryRoute
import ru.musixai.app.feature.library.PlaylistRoute
import ru.musixai.app.feature.search.SearchRoute
import ru.musixai.app.feature.artist.ArtistRoute
import ru.musixai.app.feature.settings.SettingsRoute
import ru.musixai.app.feature.imports.ImportRoute
import ru.musixai.app.feature.upload.UploadRoute
import ru.musixai.app.feature.quiz.QuizRoute
import ru.musixai.app.feature.stats.StatsRoute
import ru.musixai.app.feature.assistant.ChatRoute
import ru.musixai.app.core.designsystem.component.SegmentOption
import ru.musixai.app.core.designsystem.component.Segmented
import androidx.compose.foundation.layout.statusBarsPadding
import javax.inject.Inject

// type-safe routes (Navigation 2.8+): the tabs, then the pushed screens
@Serializable data object HomeDest
@Serializable data object AssistantDest
@Serializable data object LibraryDest
@Serializable data object QuizDest
@Serializable data class SearchDest(val q: String? = null)
@Serializable data class ArtistDest(val id: String)
@Serializable data class AlbumDest(val id: String)
@Serializable data class PlaylistDest(val id: String)
@Serializable data object SettingsDest
@Serializable data object ImportDest
@Serializable data object UploadDest

@HiltViewModel
class AppViewModel @Inject constructor(auth: AuthRepository, val player: PlayerController, val updates: AppUpdates) : ViewModel() {
    val signedIn = auth.signedIn.stateIn(viewModelScope, SharingStarted.Eagerly, null)

    init { viewModelScope.launch { auth.signedIn.collect { if (it) runCatching { updates.check() } } } }

    fun install(r: ru.musixai.app.core.data.Release) = viewModelScope.launch { runCatching { updates.install(r) }.onFailure { updates.progress.value = "Не удалось: ${it.message}" } }
}

/** The root: the login flow until a session exists, then the app shell. */
@Composable
fun MusixApp(vm: AppViewModel = hiltViewModel()) {
    val signedIn by vm.signedIn.collectAsStateWithLifecycle()
    when (signedIn) {
        null -> Box(Modifier.fillMaxSize().background(MusixTheme.colors.bg))
        false -> LoginRoute()
        true -> Shell(vm)
    }
}

private val TAB_ROUTES = listOf(HomeDest::class, AssistantDest::class, LibraryDest::class, QuizDest::class)

/** The tab the current screen belongs to: the nearest tab root under it in the back stack
 *  (an artist opened from the library is still the library tab). */
internal fun NavHostController.currentTab(): kotlin.reflect.KClass<*>? =
    currentBackStack.value.lastOrNull { e -> TAB_ROUTES.any { e.destination.hasRoute(it) } }
        ?.let { e -> TAB_ROUTES.first { e.destination.hasRoute(it) } }

/** A tab press. The same tab again = back to its root: the save/restore pair would pop the
 *  nested screens and put them straight back, so «Главная» seemed to do nothing. Another
 *  tab = the usual switch, each tab keeping its own stack. */
internal fun NavHostController.toTab(dest: Any) {
    val here = currentBackStack.value.lastOrNull { e -> TAB_ROUTES.any { e.destination.hasRoute(it) } }
    if (here != null && here.destination.hasRoute(dest::class)) {
        popBackStack(here.destination.id, inclusive = false)
        return
    }
    navigate(dest) {
        popUpTo(graph.findStartDestination().id) { saveState = true }
        launchSingleTop = true
        restoreState = true
    }
}

@Composable
private fun Shell(vm: AppViewModel) {
    LaunchedEffect(Unit) { vm.player.connect() }
    val nav = rememberNavController()
    var playerOpen by rememberSaveable { mutableStateOf(false) }
    val entry by nav.currentBackStackEntryAsState()
    val tab = remember(entry) { nav.currentTab() }
    Box(Modifier.fillMaxSize().background(MusixTheme.colors.bg)) {
        Column(Modifier.fillMaxSize()) {
            Box(Modifier.weight(1f)) { Routes(nav, openPlayer = { playerOpen = true }, install = vm::install) }
            MiniPlayer(onOpen = { playerOpen = true })
            BottomTabBar(tab, onNav = nav::toTab, Modifier.navigationBarsPadding())
        }
        val offer by vm.updates.offer.collectAsStateWithLifecycle()
        val progress by vm.updates.progress.collectAsStateWithLifecycle()
        offer?.let { r ->
            androidx.compose.material3.AlertDialog(
                onDismissRequest = vm.updates::dismiss,
                title = { Text("MusiX ${r.versionName}") },
                text = { Text(progress ?: r.notes.ifBlank { "Доступна новая версия приложения." }) },
                confirmButton = { androidx.compose.material3.TextButton({ vm.install(r) }) { Text("Обновить") } },
                dismissButton = { androidx.compose.material3.TextButton(vm.updates::dismiss) { Text("Позже") } },
            )
        }
        AnimatedVisibility(playerOpen, enter = slideInVertically(tween(320)) { it }, exit = slideOutVertically(tween(260)) { it }) {
            BackHandler { playerOpen = false }
            PlayerRoute(onClose = { playerOpen = false }, onArtist = { playerOpen = false; nav.navigate(ArtistDest(it)) })
        }
    }
}

@Composable
private fun Routes(nav: NavHostController, openPlayer: () -> Unit, install: (ru.musixai.app.core.data.Release) -> Unit) {
    val back: () -> Unit = { nav.popBackStack() }
    NavHost(nav, startDestination = HomeDest) {
        composable<HomeDest> {
            HomeRoute(onSearch = { q -> nav.navigate(SearchDest(q)) }, onSettings = { nav.navigate(SettingsDest) }, onLibrary = { nav.navigate(LibraryDest) })
        }
        composable<AssistantDest> { AssistantTab(onArtist = { nav.navigate(ArtistDest(it)) }, onAlbum = { nav.navigate(AlbumDest(it)) }) }
        composable<LibraryDest> {
            LibraryRoute(onAlbum = { nav.navigate(AlbumDest(it)) }, onPlaylist = { nav.navigate(PlaylistDest(it)) }, stats = { StatsRoute() })
        }
        composable<QuizDest> { QuizRoute() }
        composable<SearchDest> { SearchRoute(onArtist = { nav.navigate(ArtistDest(it)) }, onAlbum = { nav.navigate(AlbumDest(it)) }) }
        composable<ArtistDest> { ArtistRoute(onBack = back, onAlbum = { nav.navigate(AlbumDest(it)) }) }
        composable<AlbumDest> { AlbumRoute(onBack = back) }
        composable<PlaylistDest> { PlaylistRoute(onBack = back) }
        composable<SettingsDest> {
            SettingsRoute(onBack = back, onImport = { nav.navigate(ImportDest) }, onUpload = { nav.navigate(UploadDest) }, onUpdate = { install(it) })
        }
        composable<ImportDest> { ImportRoute(onBack = back) }
        composable<UploadDest> { UploadRoute(onBack = back) }
    }
}

/** The «Ассистент» tab: v1's «Поиск | Чат» pair; the chat lands with the assistant block. */
@Composable
private fun AssistantTab(onArtist: (String) -> Unit, onAlbum: (String) -> Unit) {
    var chat by rememberSaveable { mutableStateOf(false) }
    Column(Modifier.fillMaxSize().background(MusixTheme.colors.bg)) {
        Box(Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 20.dp, vertical = 10.dp), contentAlignment = Alignment.CenterEnd) {
            Segmented(chat, listOf(SegmentOption(false, "🔍 Поиск"), SegmentOption(true, "💬 Чат")), { chat = it }, small = true)
        }
        Box(Modifier.weight(1f)) {
            if (chat) ChatRoute() else SearchRoute(onArtist = onArtist, onAlbum = onAlbum)
        }
    }
}

@Composable
private fun Placeholder(title: String) {
    Box(Modifier.fillMaxSize().background(MusixTheme.colors.bg), contentAlignment = Alignment.Center) {
        Text(title, color = MusixTheme.colors.textMuted)
    }
}
