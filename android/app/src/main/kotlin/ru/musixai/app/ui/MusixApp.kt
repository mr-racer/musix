package ru.musixai.app.ui

import androidx.activity.compose.BackHandler
import androidx.activity.compose.PredictiveBackHandler
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.IntOffset
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
import androidx.compose.runtime.DisposableEffect
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
import androidx.navigation.compose.dialog
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
import ru.musixai.app.feature.player.miniPlayerCoverAbove
import ru.musixai.app.core.designsystem.motion.CoverFlight
import ru.musixai.app.core.designsystem.motion.CoverFlightLayer
import ru.musixai.app.core.designsystem.LocalStageHeight
import ru.musixai.app.core.designsystem.motion.LocalCoverFlight
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import ru.musixai.app.feature.player.PlayerRoute
import ru.musixai.app.feature.player.PlayerFold
import ru.musixai.app.feature.player.LocalPlayerFold
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.derivedStateOf
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.runtime.rememberCoroutineScope
import kotlinx.coroutines.launch
import ru.musixai.app.feature.library.LibraryRoute
import ru.musixai.app.feature.library.PlaylistRoute
import ru.musixai.app.feature.search.SearchRoute
import ru.musixai.app.feature.artist.ArtistRoute
import ru.musixai.app.feature.artist.AlbumHost
import ru.musixai.app.feature.artist.AlbumLayer
import ru.musixai.app.feature.artist.LocalAlbums
import ru.musixai.app.feature.artist.rememberAlbumHost
import ru.musixai.app.core.designsystem.motion.FlightLayer
import ru.musixai.app.core.designsystem.motion.FlightSources
import ru.musixai.app.core.designsystem.motion.LocalFlightSources
import androidx.navigation.toRoute
import ru.musixai.app.feature.settings.SettingsRoute
import ru.musixai.app.feature.imports.ImportRoute
import ru.musixai.app.feature.upload.UploadRoute
import ru.musixai.app.feature.quiz.QuizRoute
import ru.musixai.app.feature.stats.StatsRoute
import ru.musixai.app.feature.assistant.AssistantRoute
import ru.musixai.app.core.designsystem.legacy.SegmentOption
import ru.musixai.app.core.designsystem.legacy.Segmented
import androidx.compose.foundation.layout.statusBarsPadding
import javax.inject.Inject
import androidx.navigation.navDeepLink
import ru.musixai.app.core.designsystem.surface.LocalToasts
import ru.musixai.app.core.designsystem.surface.SheetHost
import ru.musixai.app.core.designsystem.surface.ToastHost
import ru.musixai.app.core.designsystem.surface.rememberToasts
import ru.musixai.app.feature.catalog.CatalogRoute
import androidx.compose.animation.AnimatedContentScope
import ru.musixai.app.core.designsystem.motion.PageDirection
import ru.musixai.app.core.designsystem.motion.PageFocus
import ru.musixai.app.core.designsystem.motion.pageFocusBlur
import ru.musixai.app.core.designsystem.motion.rememberPageFocus

// type-safe routes (Navigation 2.8+): the tabs, then the pushed screens
@Serializable data object HomeDest
@Serializable data object AssistantDest
@Serializable data object LibraryDest
@Serializable data object QuizDest
@Serializable data class SearchDest(val q: String? = null)
@Serializable data class ArtistDest(val id: String)
@Serializable data class PlaylistDest(val id: String)
@Serializable data object SettingsDest
@Serializable data object ImportDest
@Serializable data object UploadDest
@Serializable data object CatalogDest

@HiltViewModel
class AppViewModel @Inject constructor(auth: AuthRepository, val player: PlayerController, val updates: AppUpdates,
                                       private val prefetch: ru.musixai.app.feature.player.PlayerPrefetch) : ViewModel() {
    val signedIn = auth.signedIn.stateIn(viewModelScope, SharingStarted.Eagerly, null)

    init {
        viewModelScope.launch { auth.signedIn.collect { if (it) { runCatching { updates.check() }; prefetch.start(viewModelScope) } } }
    }

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
        // «Главная» lands on the home root itself. Restoring its saved stack brought back
        // whatever had been pushed over it (the library opened from the home card), so the
        // button seemed dead from the library (the owner, 2026-10-02).
        restoreState = dest !is HomeDest
    }
}

@Composable
private fun Shell(vm: AppViewModel) {
    LaunchedEffect(Unit) { vm.player.connect() }
    val nav = rememberNavController()
    // a link while the app is open (singleTask: it arrives as a new intent) — musix://catalog
    val activity = androidx.activity.compose.LocalActivity.current as? androidx.activity.ComponentActivity
    DisposableEffect(activity, nav) {
        val listener = androidx.core.util.Consumer<android.content.Intent> { if (it.data != null) nav.handleDeepLink(it) }
        activity?.addOnNewIntentListener(listener)
        onDispose { activity?.removeOnNewIntentListener(listener) }
    }
    // the player folds into the mini player and unfolds out of it (round 2 of the phone player): one value, 0 open … 1 folded
    val fold = remember { PlayerFold() }
    var playerOpen by rememberSaveable { mutableStateOf(false) }
    val foldScope = rememberCoroutineScope()
    LaunchedEffect(Unit) { if (playerOpen) fold.snap(false) }
    LaunchedEffect(fold) { snapshotFlow { fold.p.targetValue < 0.5f }.collect { playerOpen = it } }
    val openPlayer: () -> Unit = { foldScope.launch { fold.to(false) } }
    val entry by nav.currentBackStackEntryAsState()
    val tab = remember(entry) { nav.currentTab() }
    // a cover that starts playing flies into the mini-player's cover (r3 §5.5); before anything
    // has played there is no bar yet, so the dock is where its cover will stand, over the tab bar
    val flight = remember { CoverFlight() }
    val density = LocalDensity.current
    // sheets (one at a time, over everything) and the stack of toasts (above the mini-player)
    val toasts = rememberToasts()
    // «что коснулся, то и летит»: the spots of every screen and the flyers over them; the album over the screens
    val sources = remember { FlightSources() }
    val albums = rememberAlbumHost()
    CompositionLocalProvider(LocalCoverFlight provides flight, LocalToasts provides toasts, LocalPlayerFold provides fold,
        LocalFlightSources provides sources, LocalAlbums provides albums) { SheetHost { Box(Modifier.fillMaxSize().background(MusixTheme.colors.bg).onSizeChanged { fold.height = it.height.toFloat() }) {
        // the page behind the player comes forward as it folds away
        Column(Modifier.fillMaxSize().graphicsLayer {
            val e = fold.p.value.coerceIn(0f, 1f)
            if (e < 1f) { val k = 0.94f + 0.06f * e; scaleX = k; scaleY = k; alpha = 0.35f + 0.65f * e }
        }) {
            // the stage: the screens and the open mini-player over them share it; a screen gives way
            // to the bar, its backdrop goes on under it (LocalStageHeight)
            var stage by remember { mutableIntStateOf(0) }
            Column(Modifier.weight(1f).onSizeChanged { stage = it.height }) {
                Box(Modifier.weight(1f)) {
                    // the page under an open album steps back and dims (the album's «drawBack»)
                    Box(Modifier.fillMaxSize().graphicsLayer {
                        val b = albums.back.coerceIn(0f, 1f)
                        if (b > 0.001f) { val k = 1f - 0.04f * b; scaleX = k; scaleY = k; alpha = 1f - 0.5f * b }
                    }) {
                        CompositionLocalProvider(LocalStageHeight provides stage) { Routes(nav, albums, openPlayer = openPlayer, install = vm::install) }
                    }
                    AlbumLayer(
                        albums,
                        currentArtist = { nav.currentBackStackEntry?.takeIf { it.destination.hasRoute(ArtistDest::class) }?.toRoute<ArtistDest>()?.id },
                        onArtist = { nav.navigate(ArtistDest(it)) },
                    )
                    ToastHost(toasts, Modifier.align(Alignment.BottomCenter))
                }
                Box(Modifier.graphicsLayer {
                    val e = fold.p.value.coerceIn(0f, 1f)
                    alpha = ((e - 0.45f) / 0.5f).coerceIn(0f, 1f); translationY = (1f - e) * 22.dp.toPx()
                }) { MiniPlayer(onOpen = openPlayer) }
            }
            Box(Modifier.onGloballyPositioned { flight.dock = miniPlayerCoverAbove(it.boundsInRoot().top, density) }) {
                BottomTabBar(tab, onNav = { albums.close(); nav.toTab(it) }, Modifier.navigationBarsPadding())
            }
        }
        CoverFlightLayer(flight)
        FlightLayer(sources)
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
        // the player: the cover flies out of the bar's cover and back into it; back (the predictive gesture too) folds it with the finger
        val playerShown by remember { derivedStateOf { fold.shown } }
        val playerHolds by remember { derivedStateOf { fold.p.value < 0.5f } }
        // while it is mostly open the player takes every touch; folding away it lets the page have them
        if (playerShown) Box(Modifier.fillMaxSize().then(if (playerHolds) Modifier.pointerInput(Unit) { awaitEachGesture { awaitFirstDown(requireUnconsumed = false) } } else Modifier)) {
            PredictiveBackHandler(enabled = playerOpen) { progress ->
                try {
                    fold.grab()
                    progress.collect { fold.p.snapTo(it.progress * 0.35f) }
                    fold.to(true)
                } catch (x: kotlin.coroutines.cancellation.CancellationException) {
                    foldScope.launch { fold.to(false) }
                    throw x
                }
            }
            PlayerRoute(fold, onArtist = { foldScope.launch { fold.to(true) }; nav.navigate(ArtistDest(it)) }, onAlbum = { foldScope.launch { fold.to(true) }; albums.open(it) })
        }
    } } }
}

/** A page of the shell: out of focus while it changes (the web's focus change, API 31+). */
@Composable
private fun AnimatedContentScope.Page(content: @Composable () -> Unit) =
    Box(Modifier.fillMaxSize().pageFocusBlur(this)) { content() }

@Composable
private fun Routes(nav: NavHostController, albums: AlbumHost, openPlayer: () -> Unit, install: (ru.musixai.app.core.data.Release) -> Unit) {
    val back: () -> Unit = { nav.popBackStack() }
    // Page changes are the web's «focus» change (the owner, 2026-11-14 — it replaces the slide
    // to the right): nothing travels across the screen. What leaves goes out of focus, what
    // arrives comes into focus (fade, blur 8 dp on API 31+, a short way off, critically damped).
    // Between sections — the tabs — a column, down to a later tab and up to an earlier one;
    // a screen opened over a section comes forward (from 1.03); back steps back (from .975),
    // and the predictive back gesture scrubs that same change.
    val tab: (androidx.navigation.NavBackStackEntry) -> Int = { e -> TAB_ROUTES.indexOfFirst { e.destination.hasRoute(it) } }
    val down = rememberPageFocus(PageDirection.Column, sign = 1)
    val up = rememberPageFocus(PageDirection.Column, sign = -1)
    val forward = rememberPageFocus(PageDirection.Forward)
    val backward = rememberPageFocus(PageDirection.Back)
    // a section change: tab to tab, or a tab press away from a screen that is not kept below
    fun section(from: androidx.navigation.NavBackStackEntry, to: androidx.navigation.NavBackStackEntry, pop: Boolean): PageFocus? {
        val a = tab(from); val b = tab(to)
        if (a >= 0 && b >= 0) return if (b >= a) down else up
        if (!pop && b >= 0 && nav.currentBackStack.value.none { it.id == from.id }) return down
        return null
    }
    NavHost(
        nav, startDestination = HomeDest,
        enterTransition = { (section(initialState, targetState, false) ?: forward).enter },
        exitTransition = { (section(initialState, targetState, false) ?: forward).exit },
        popEnterTransition = { (section(initialState, targetState, true) ?: backward).enter },
        popExitTransition = { (section(initialState, targetState, true) ?: backward).exit },
        // Navigation's default shrinks the screen "into the distance": the gesture scrubs the focus change instead
        predictivePopEnterTransition = { _ -> (section(initialState, targetState, true) ?: backward).enter },
        predictivePopExitTransition = { _ -> (section(initialState, targetState, true) ?: backward).exit },
    ) {
        composable<HomeDest> { Page {
            HomeRoute(onSearch = { q -> nav.navigate(SearchDest(q)) }, onSettings = { nav.navigate(SettingsDest) }, onLibrary = { nav.toTab(LibraryDest) }, onAlbum = albums::open)
        } }
        composable<AssistantDest> { Page { AssistantTab(onArtist = { nav.navigate(ArtistDest(it)) }, onAlbum = albums::open) } }
        composable<LibraryDest> { Page {
            LibraryRoute(onAlbum = albums::open, onPlaylist = { nav.navigate(PlaylistDest(it)) }, stats = { StatsRoute() })
        } }
        composable<QuizDest> { Page { QuizRoute() } }
        composable<SearchDest> { Page { SearchRoute(onArtist = { nav.navigate(ArtistDest(it)) }, onAlbum = albums::open) } }
        // the album is no destination: it is the shell's layer over the screen it opened from (AlbumLayer)
        composable<ArtistDest> { Page { ArtistRoute(onBack = back, onAlbum = albums::open) } }
        composable<PlaylistDest> { Page { PlaylistRoute(onBack = back) } }
        composable<SettingsDest> { Page {
            SettingsRoute(onBack = back, onImport = { nav.navigate(ImportDest) }, onUpload = { nav.navigate(UploadDest) }, onUpdate = { install(it) }, onCatalog = { nav.navigate(CatalogDest) })
        } }
        composable<ImportDest> { Page { ImportRoute(onBack = back) } }
        composable<UploadDest> { Page { UploadRoute(onBack = back) } }
        composable<CatalogDest>(deepLinks = listOf(navDeepLink<CatalogDest>(basePath = "musix://catalog"))) { Page { CatalogRoute(onBack = back) } }
    }
}

/** The «Ассистент» tab: v1's `AssistantSection` (the orb page); exact search opens from home. */
@Composable
private fun AssistantTab(onArtist: (String) -> Unit, @Suppress("UNUSED_PARAMETER") onAlbum: (String) -> Unit) {
    AssistantRoute(onArtist = onArtist)
}

@Composable
private fun Placeholder(title: String) {
    Box(Modifier.fillMaxSize().background(MusixTheme.colors.bg), contentAlignment = Alignment.Center) {
        Text(title, color = MusixTheme.colors.textMuted)
    }
}
