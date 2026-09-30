package ru.musixai.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.stateIn
import ru.musixai.app.core.data.AuthRepository
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.feature.auth.LoginRoute
import javax.inject.Inject

@HiltViewModel
class AppViewModel @Inject constructor(auth: AuthRepository, library: ru.musixai.app.core.database.LibraryDao) : ViewModel() {
    val signedIn = auth.signedIn.stateIn(viewModelScope, SharingStarted.Eagerly, null)
    val tracks = library.trackCount().stateIn(viewModelScope, SharingStarted.Eagerly, 0)
}

/** The root: the login flow until a session exists, then the app shell. */
@Composable
fun MusixApp(vm: AppViewModel = hiltViewModel()) {
    val signedIn by vm.signedIn.collectAsStateWithLifecycle()
    when (signedIn) {
        null -> Box(Modifier.fillMaxSize().background(MusixTheme.colors.bg))
        false -> LoginRoute()
        true -> Box(Modifier.fillMaxSize().background(MusixTheme.colors.bg), contentAlignment = Alignment.Center) {
            val n by vm.tracks.collectAsStateWithLifecycle()
            Text("signed in · $n tracks", color = MusixTheme.colors.text)
        }
    }
}
