package ru.musixai.app.feature.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import ru.musixai.app.core.data.AccountRepository
import ru.musixai.app.core.data.AuthRepository
import ru.musixai.app.core.data.Device
import ru.musixai.app.core.data.DevicePrefs
import ru.musixai.app.core.data.Release
import ru.musixai.app.core.data.SettingsRepository
import ru.musixai.app.core.data.ThemePref
import ru.musixai.app.core.designsystem.MusixIcons
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.core.designsystem.component.CtaButton
import ru.musixai.app.core.designsystem.component.Eyebrow
import ru.musixai.app.core.designsystem.component.RoundGlassButton
import ru.musixai.app.core.designsystem.component.SegmentOption
import ru.musixai.app.core.designsystem.component.Segmented
import ru.musixai.app.core.designsystem.component.ToggleSwitch
import ru.musixai.app.core.designsystem.component.pressable
import javax.inject.Inject

data class SettingsUi(
    val wifi: String = "lossless", val cellular: String = "high", val normalize: Boolean = true, val theme: ThemePref = ThemePref.System,
    val devices: List<Device> = emptyList(), val cacheMb: Long = 0, val release: Release? = null, val server: String = "",
)

@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val settings: SettingsRepository,
    private val prefs: DevicePrefs,
    private val account: AccountRepository,
    private val auth: AuthRepository,
) : ViewModel() {
    private val extra = MutableStateFlow(SettingsUi())
    val ui: StateFlow<SettingsUi> = combine(settings.value, prefs.theme, extra, auth.server) { v, t, e, srv ->
        val q = v["quality"]?.let { runCatching { it.jsonObject }.getOrNull() }
        e.copy(wifi = q?.get("wifi")?.jsonPrimitive?.content ?: "lossless", cellular = q?.get("cellular")?.jsonPrimitive?.content ?: "high",
            normalize = v["playback"]?.let { runCatching { it.jsonObject["normalize"]?.jsonPrimitive?.booleanOrNull }.getOrNull() } ?: true, theme = t, server = srv)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), SettingsUi())

    init { refresh() }

    private fun refresh() = viewModelScope.launch {
        val d = runCatching { account.devices() }.getOrDefault(emptyList())
        extra.value = extra.value.copy(devices = d, cacheMb = prefs.cacheBytes() / (1 shl 20), release = account.latest())
    }

    fun quality(network: String, tier: String) = viewModelScope.launch { settings.set("quality", network, v = JsonPrimitive(tier)) }
    fun normalize(on: Boolean) = viewModelScope.launch { settings.set("playback", "normalize", v = JsonPrimitive(on)) }
    fun theme(t: ThemePref) = prefs.setTheme(t)
    fun signOutDevice(id: String) = viewModelScope.launch { runCatching { account.signOutDevice(id) }; refresh() }
    fun clearCache() { prefs.clearCaches(); refresh() }
    fun signOut() = viewModelScope.launch { auth.logout() }
}

private val TIERS = listOf(SegmentOption("lossless", "Lossless"), SegmentOption("high", "320"), SegmentOption("economy", "Эконом"))

/** v1 `SettingsPanel` for the phone: quality per network, normalization, the theme, this
 *  account's devices, the cache, the update, and the way out. */
@Composable
fun SettingsRoute(onBack: () -> Unit, onImport: () -> Unit, onUpload: () -> Unit, onUpdate: (Release) -> Unit, vm: SettingsViewModel = hiltViewModel()) {
    val ui by vm.ui.collectAsStateWithLifecycle()
    val c = MusixTheme.colors
    Column(Modifier.fillMaxSize().background(c.bg).verticalScroll(rememberScrollState()).statusBarsPadding().padding(20.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            RoundGlassButton(onBack, size = 40.dp) { Icon(MusixIcons.ChevronLeft, "Назад", Modifier.size(18.dp), tint = c.text) }
            Text("Настройки", Modifier.padding(start = 14.dp), style = MusixTheme.type.title.copy(fontSize = 24.sp, color = c.text))
        }
        Card("Качество звука") {
            Line("Wi-Fi") { Segmented(ui.wifi, TIERS, { vm.quality("wifi", it) }, small = true) }
            Line("Мобильная сеть") { Segmented(ui.cellular, TIERS, { vm.quality("cellular", it) }, small = true) }
            Text("Смена сети применяется со следующего трека.", style = MusixTheme.type.body.copy(fontSize = 12.sp, color = c.textSubtle))
            Line("Выравнивать громкость") { ToggleSwitch(ui.normalize, vm::normalize) }
        }
        Card("Оформление") {
            Segmented(ui.theme, listOf(SegmentOption(ThemePref.System, "Как в системе"), SegmentOption(ThemePref.Dark, "Тёмная"), SegmentOption(ThemePref.Light, "Светлая")), vm::theme, small = true)
        }
        Card("Музыка") {
            Link("Импорт из Яндекс Музыки", onImport)
            Link("Загрузить файлы с телефона", onUpload)
        }
        Card("Устройства") {
            for (d in ui.devices) Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(d.name + if (d.current) " · это устройство" else "", style = MusixTheme.type.body.copy(fontSize = 14.sp, color = c.text))
                    Text(d.platform, style = MusixTheme.type.body.copy(fontSize = 12.sp, color = c.textMuted))
                }
                if (!d.current) Text("Выйти", Modifier.pressable { vm.signOutDevice(d.id) }.padding(8.dp), style = MusixTheme.type.body.copy(fontSize = 13.sp, color = c.red))
            }
        }
        Card("Память") {
            Line("Кэш: ${ui.cacheMb} МБ") { Text("Очистить", Modifier.pressable(onClick = vm::clearCache).padding(8.dp), style = MusixTheme.type.body.copy(fontSize = 13.sp, color = c.accentLight)) }
        }
        Card("Приложение") {
            val r = ui.release
            Text("Сервер: ${ui.server.removePrefix("https://")}", style = MusixTheme.type.body.copy(fontSize = 13.sp, color = c.textMuted))
            if (r != null && r.versionCode > APP_VERSION_CODE) CtaButton("Обновить до ${r.versionName}", { onUpdate(r) }, Modifier.fillMaxWidth())
            else Text("Установлена последняя версия", style = MusixTheme.type.body.copy(fontSize = 13.sp, color = c.textMuted))
        }
        Text("Выйти из аккаунта", Modifier.align(Alignment.CenterHorizontally).pressable(onClick = vm::signOut).padding(12.dp),
            style = MusixTheme.type.body.copy(fontSize = 15.sp, fontWeight = FontWeight.Medium, color = c.red))
    }
}

/** Set by the app at start (BuildConfig lives in :app). */
var APP_VERSION_CODE: Int = 0

@Composable
private fun Card(title: String, content: @Composable ColumnScope.() -> Unit) {
    val c = MusixTheme.colors
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(c.surface).border(1.dp, c.border, RoundedCornerShape(18.dp)).padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Eyebrow(title)
        content()
    }
}

@Composable
private fun Line(label: String, control: @Composable () -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f), style = MusixTheme.type.body.copy(fontSize = 14.sp, color = MusixTheme.colors.text))
        control()
    }
}

@Composable
private fun Link(label: String, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().pressable(onClick = onClick).padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f), style = MusixTheme.type.body.copy(fontSize = 14.sp, color = MusixTheme.colors.text))
        Icon(MusixIcons.ChevronRight, null, Modifier.size(16.dp), tint = MusixTheme.colors.textSubtle)
    }
}
