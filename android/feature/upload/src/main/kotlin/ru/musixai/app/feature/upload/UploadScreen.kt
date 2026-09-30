package ru.musixai.app.feature.upload

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import ru.musixai.app.core.data.AccountRepository
import ru.musixai.app.core.designsystem.MusixIcons
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.core.designsystem.component.CtaButton
import ru.musixai.app.core.designsystem.component.RoundGlassButton
import javax.inject.Inject

data class UploadItem(val name: String, val size: Long, val sent: Long = 0, val state: String = "в очереди")

@HiltViewModel
class UploadViewModel @Inject constructor(@ApplicationContext private val ctx: Context, private val account: AccountRepository) : ViewModel() {
    private val _items = MutableStateFlow<List<UploadItem>>(emptyList())
    val items: StateFlow<List<UploadItem>> = _items

    /** One file at a time (the server hashes and ingests as they land); a failure is shown, the rest go on. */
    fun add(uris: List<Uri>) = viewModelScope.launch {
        val metas = uris.map { u -> meta(u) }
        val base = _items.value.size
        _items.update { it + metas.map { (n, s) -> UploadItem(n, s) } }
        metas.forEachIndexed { i, (name, size) ->
            val idx = base + i
            val result = runCatching {
                account.upload(name, size, { ctx.contentResolver.openInputStream(uris[i])!! }) { sent -> set(idx) { it.copy(sent = sent, state = "загрузка") } }
            }
            set(idx) { it.copy(sent = if (result.isSuccess) size else it.sent, state = result.fold({ r -> if (r == "exists") "уже в библиотеке" else "готово" }, { "ошибка" })) }
        }
    }

    private fun set(i: Int, f: (UploadItem) -> UploadItem) = _items.update { l -> l.mapIndexed { j, x -> if (j == i) f(x) else x } }

    private fun meta(u: Uri): Pair<String, Long> = ctx.contentResolver.query(u, null, null, null, null)?.use { c ->
        c.moveToFirst()
        c.getString(c.getColumnIndexOrThrow(OpenableColumns.DISPLAY_NAME)) to c.getLong(c.getColumnIndexOrThrow(OpenableColumns.SIZE))
    } ?: ("файл" to 0L)
}

/** New in v2: pick audio on the phone → sha256 → a resumable upload into the library. */
@Composable
fun UploadRoute(onBack: () -> Unit, vm: UploadViewModel = hiltViewModel()) {
    val items by vm.items.collectAsStateWithLifecycle()
    val c = MusixTheme.colors
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris -> if (uris.isNotEmpty()) vm.add(uris) }
    LazyColumn(Modifier.fillMaxSize().background(c.bg).statusBarsPadding(), contentPadding = androidx.compose.foundation.layout.PaddingValues(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                RoundGlassButton(onBack, size = 40.dp) { Icon(MusixIcons.ChevronLeft, "Назад", Modifier.size(18.dp), tint = c.text) }
                Text("Загрузка файлов", Modifier.padding(start = 14.dp), style = MusixTheme.type.title.copy(fontSize = 20.sp, color = c.text))
            }
        }
        item {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("FLAC, ALAC, MP3, AAC — файлы остаются вашими. Одинаковые файлы не загружаются второй раз.",
                    style = MusixTheme.type.body.copy(fontSize = 14.sp, lineHeight = 1.5.em, color = c.textMuted))
                CtaButton("Выбрать файлы", { pick.launch(arrayOf("audio/*")) }, Modifier.fillMaxWidth())
            }
        }
        items(items) { it ->
            Column(Modifier.fillMaxWidth()) {
                Row {
                    Text(it.name, Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis, style = MusixTheme.type.body.copy(fontSize = 14.sp, color = c.text))
                    Text(it.state, style = MusixTheme.type.body.copy(fontSize = 12.sp, color = if (it.state == "ошибка") c.red else c.textMuted))
                }
                val f = if (it.size > 0) (it.sent.toFloat() / it.size).coerceIn(0f, 1f) else 0f
                Box(Modifier.padding(top = 6.dp).fillMaxWidth().height(4.dp).clip(RoundedCornerShape(2.dp)).background(c.surface2)) {
                    Box(Modifier.fillMaxWidth(f).height(4.dp).background(c.accent))
                }
            }
        }
    }
}
