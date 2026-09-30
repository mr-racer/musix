package ru.musixai.app

import android.app.Application
import dagger.hilt.android.HiltAndroidApp
import ru.musixai.app.core.data.AuthRepository

@HiltAndroidApp
class MusixApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        AuthRepository.APP_VERSION = BuildConfig.VERSION_NAME
    }
}
