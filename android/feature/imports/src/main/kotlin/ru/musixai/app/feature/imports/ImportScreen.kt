package ru.musixai.app.feature.imports

import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.core.net.toUri
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.jsonPrimitive
import ru.musixai.app.core.data.AccountRepository
import ru.musixai.app.core.data.Realtime
import ru.musixai.app.core.data.YandexAuth
import ru.musixai.app.core.data.YandexSource
import ru.musixai.app.core.designsystem.MusixIcons
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.core.designsystem.component.CtaButton
import ru.musixai.app.core.designsystem.component.Eyebrow
import ru.musixai.app.core.designsystem.component.LiquidGlass
import ru.musixai.app.core.designsystem.component.RoundGlassButton
import ru.musixai.app.core.designsystem.component.Spinner
import ru.musixai.app.core.designsystem.component.ToggleSwitch
import ru.musixai.app.core.designsystem.component.pressable
import javax.inject.Inject

data class ImportUi(
    val linked: Boolean? = null, val login: String? = null, val auth: YandexAuth? = null, val sources: List<YandexSource> = emptyList(),
    val picked: Set<Int> = emptySet(), val job: String? = null, val done: Int = 0, val total: Int = 0, val finished: Boolean = false, val error: String? = null,
)

@HiltViewModel
class ImportViewModel @Inject constructor(private val account: AccountRepository, realtime: Realtime) : ViewModel() {
    private val _ui = MutableStateFlow(ImportUi())
    val ui: StateFlow<ImportUi> = _ui

    init {
        load()
        // progress arrives over the WebSocket as `job` events (contexts/imports/yandex.py)
        viewModelScope.launch {
            realtime.events.collect { e ->
                if (e["type"]?.jsonPrimitive?.content != "job" || e["job"]?.jsonPrimitive?.content != _ui.value.job) return@collect
                _ui.update { it.copy(done = e["done"]?.jsonPrimitive?.content?.toIntOrNull() ?: it.done, total = e["total"]?.jsonPrimitive?.content?.toIntOrNull() ?: it.total,
                    finished = e["state"]?.jsonPrimitive?.content == "done") }
            }
        }
    }

    private fun load() = viewModelScope.launch {
        val l = runCatching { account.yandexLink() }.getOrNull()
        _ui.update { it.copy(linked = l?.linked ?: false, login = l?.login) }
        if (l?.linked == true) _ui.update { it.copy(sources = runCatching { account.yandexSources() }.getOrDefault(emptyList())) }
    }

    /** Yandex's device flow: show the code, the user confirms on ya.ru, we poll the session. */
    fun link() = viewModelScope.launch {
        val a = runCatching { account.yandexStart() }.getOrElse { _ui.update { s -> s.copy(error = "Не удалось начать вход") }; return@launch }
        _ui.update { it.copy(auth = a, error = null) }
        repeat(120) {
            delay(5_000)
            val p = runCatching { account.yandexPoll(a.sessionId) }.getOrNull() ?: return@repeat
            if (p.status == "linked" || p.status == "done") { _ui.update { it.copy(auth = null) }; load(); return@launch }
            if (p.status == "failed" || p.status == "expired") { _ui.update { it.copy(auth = null, error = p.reason ?: "Вход не подтверждён") }; return@launch }
        }
    }

    fun toggle(i: Int) = _ui.update { it.copy(picked = if (i in it.picked) it.picked - i else it.picked + i) }

    fun import() = viewModelScope.launch {
        val s = _ui.value
        val job = runCatching { account.yandexImport(s.picked.map { s.sources[it] }) }.getOrElse { _ui.update { u -> u.copy(error = "Импорт не запустился") }; return@launch }
        _ui.update { it.copy(job = job, done = 0, total = s.picked.sumOf { i -> s.sources[i].trackCount }, finished = false) }
    }
}

/** v1 `YandexImportFlow`: link the account by a device code, pick playlists, import. */
@Composable
fun ImportRoute(onBack: () -> Unit, vm: ImportViewModel = hiltViewModel()) {
    val ui by vm.ui.collectAsStateWithLifecycle()
    val c = MusixTheme.colors
    val ctx = LocalContext.current
    LazyColumn(Modifier.fillMaxSize().background(c.bg).statusBarsPadding(), contentPadding = androidx.compose.foundation.layout.PaddingValues(20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)) {
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                RoundGlassButton(onBack, size = 40.dp) { Icon(MusixIcons.ChevronLeft, "Назад", Modifier.size(18.dp), tint = c.text) }
                Text("Импорт из Яндекс Музыки", Modifier.padding(start = 14.dp), style = MusixTheme.type.title.copy(fontSize = 20.sp, color = c.text))
            }
        }
        ui.error?.let { e -> item { Text(e, style = MusixTheme.type.body.copy(fontSize = 13.sp, color = c.red)) } }
        when {
            ui.linked == null -> item { Spinner(22.dp) }
            ui.auth != null -> item {
                val a = ui.auth!!
                LiquidGlass(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(22.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text("Откройте ${a.verificationUrl} и введите код", style = MusixTheme.type.body.copy(fontSize = 14.sp, color = c.textMuted))
                        Text(a.userCode, style = MusixTheme.type.code.copy(fontSize = 34.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 0.2.em, color = c.text))
                        CtaButton("Открыть Яндекс", { ctx.startActivity(Intent(Intent.ACTION_VIEW, a.verificationUrl.toUri())) }, Modifier.fillMaxWidth())
                        Row(verticalAlignment = Alignment.CenterVertically) { Spinner(14.dp); Text("  Ждём подтверждения…", style = MusixTheme.type.body.copy(fontSize = 13.sp, color = c.textSubtle)) }
                    }
                }
            }
            ui.linked == false -> item {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("С подпиской Плюс плейлисты переезжают в пару кликов: треки скачиваются на сервер и попадают в вашу библиотеку.",
                        style = MusixTheme.type.body.copy(fontSize = 14.sp, lineHeight = 1.5.em, color = c.textMuted))
                    CtaButton("Привязать Яндекс", vm::link, Modifier.fillMaxWidth())
                }
            }
            else -> {
                item { Text("Аккаунт: ${ui.login ?: "привязан"}", style = MusixTheme.type.body.copy(fontSize = 13.sp, color = c.textMuted)) }
                if (ui.job != null) item {
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Eyebrow(if (ui.finished) "Готово" else "Импорт идёт")
                        Text("${ui.done} из ${ui.total}", style = MusixTheme.type.body.copy(fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = c.text))
                    }
                }
                item { Eyebrow("Плейлисты") }
                itemsIndexed(ui.sources) { i, s ->
                    Row(Modifier.fillMaxWidth().pressable { vm.toggle(i) }, verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(s.title, style = MusixTheme.type.body.copy(fontSize = 15.sp, color = c.text))
                            Text("${s.trackCount} треков", style = MusixTheme.type.body.copy(fontSize = 12.sp, color = c.textMuted))
                        }
                        ToggleSwitch(i in ui.picked, { vm.toggle(i) })
                    }
                }
                if (ui.picked.isNotEmpty() && (ui.job == null || ui.finished)) item { CtaButton("Импортировать (${ui.picked.size})", vm::import, Modifier.fillMaxWidth()) }
            }
        }
    }
}
