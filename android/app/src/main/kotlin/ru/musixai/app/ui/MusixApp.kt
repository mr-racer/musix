package ru.musixai.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.stateIn
import ru.musixai.app.core.data.AuthRepository
import ru.musixai.app.core.data.LibraryRepository
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.core.designsystem.component.CtaButton
import ru.musixai.app.core.player.PlayerController
import ru.musixai.app.feature.auth.LoginRoute
import javax.inject.Inject

@HiltViewModel
class AppViewModel @Inject constructor(auth: AuthRepository, library: LibraryRepository, val player: PlayerController) : ViewModel() {
    val signedIn = auth.signedIn.stateIn(viewModelScope, SharingStarted.Eagerly, null)
    val tracks = library.trackCount.stateIn(viewModelScope, SharingStarted.Eagerly, 0)
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

@Composable
private fun Shell(vm: AppViewModel) {
    LaunchedEffect(Unit) { vm.player.connect() }
    val n by vm.tracks.collectAsStateWithLifecycle()
    val p by vm.player.state.collectAsStateWithLifecycle()
    val c = MusixTheme.colors
    Column(Modifier.fillMaxSize().background(c.bg).padding(24.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        Text("signed in · $n tracks", color = c.text)
        Text("${p.mode.wire} · ${if (p.isPlaying) "playing" else if (p.buffering) "buffering" else "paused"} · ${p.positionMs / 1000}s / ${p.durationMs / 1000}s · #${p.index}/${p.queue.size}", color = c.textMuted)
        Text("${p.title} — ${p.artist} · taste=${p.taste}", color = c.text, modifier = Modifier.padding(vertical = 12.dp))
        CtaButton("Поток", { vm.player.startStream() })
        Row(Modifier.padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            CtaButton("⏯", { vm.player.toggle() })
            CtaButton("⏭", { vm.player.next() })
            CtaButton("🔥", { vm.player.react("fire") })
            CtaButton("💧", { vm.player.react("water") })
        }
    }
}
