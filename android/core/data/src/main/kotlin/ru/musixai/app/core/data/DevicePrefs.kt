package ru.musixai.app.core.data

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton

enum class ThemePref { System, Dark, Light }

/** Per-device preferences (not synced): the theme, the media cache. */
@Singleton
class DevicePrefs @Inject constructor(@ApplicationContext private val ctx: Context) {
    private val prefs = ctx.getSharedPreferences("musix_device", Context.MODE_PRIVATE)
    private val _theme = MutableStateFlow(runCatching { ThemePref.valueOf(prefs.getString("theme", "System")!!) }.getOrDefault(ThemePref.System))
    val theme: StateFlow<ThemePref> = _theme

    fun setTheme(t: ThemePref) { prefs.edit().putString("theme", t.name).apply(); _theme.value = t }

    fun cacheBytes(): Long = listOf("media", "http", "image_cache").sumOf { d -> File(ctx.cacheDir, d).walkTopDown().filter { it.isFile }.sumOf { it.length() } }

    /** The HTTP and image caches only: the media cache is Media3's SimpleCache and is cleared by the player. */
    fun clearCaches() { for (d in listOf("http", "image_cache")) File(ctx.cacheDir, d).deleteRecursively() }
}
