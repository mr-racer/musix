package ru.musixai.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dagger.hilt.android.AndroidEntryPoint
import ru.musixai.app.core.data.DevicePrefs
import ru.musixai.app.core.data.ThemePref
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.ui.MusixApp
import javax.inject.Inject

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    @Inject lateinit var prefs: DevicePrefs

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContent {
            val theme by prefs.theme.collectAsStateWithLifecycle()
            val dark = when (theme) { ThemePref.System -> isSystemInDarkTheme(); ThemePref.Dark -> true; ThemePref.Light -> false }
            MusixTheme(dark) { MusixApp() }
        }
    }
}
