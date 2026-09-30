package ru.musixai.app.feature.auth

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ru.musixai.app.core.designsystem.MusixFontFamilies
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.core.designsystem.component.BrandMark
import ru.musixai.app.core.designsystem.component.CtaButton
import ru.musixai.app.core.designsystem.component.Eyebrow
import ru.musixai.app.core.designsystem.component.LiquidGlass
import ru.musixai.app.core.designsystem.component.MusixField
import ru.musixai.app.core.designsystem.component.TabPair
import ru.musixai.app.core.designsystem.component.pressable

@Composable
fun LoginRoute(vm: AuthViewModel = hiltViewModel()) {
    val ui by vm.ui.collectAsStateWithLifecycle()
    MusixTheme(dark = true) { LoginScreen(ui, vm::edit, vm::saveServer, vm::submit) }  // v1's login is dark in both themes
}

/** v1 `LoginScreen` in its native form: the hero (brand, headline, pitch) over the aurora
 *  and the glass sign-in card; the feature tour stays on the web. */
@Composable
fun LoginScreen(ui: AuthUi, edit: (AuthUi.() -> AuthUi) -> Unit, saveServer: (String) -> Unit, submit: () -> Unit) {
    Box(Modifier.fillMaxSize().background(Color(0xFF0A0A10))) {
        Aurora()
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).statusBarsPadding().imePadding()
                .padding(start = 18.dp, end = 18.dp, top = 56.dp, bottom = 40.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                BrandMark(46.dp)
                Text("MUSIX", style = MusixTheme.type.mono.copy(fontSize = 15.sp, fontWeight = FontWeight.SemiBold,
                    letterSpacing = 0.3.em, color = Color(0xD9EEEEF3)))
            }
            Text(
                "Подними свой Spotify у себя дома",
                modifier = Modifier.padding(top = 22.dp, bottom = 12.dp),
                style = MusixTheme.type.display.copy(fontSize = 30.sp, color = Color(0xFFF1EEFF), textAlign = TextAlign.Center),
            )
            Text(
                "Бесплатно, на твоих файлах и без буллшита в рекомендациях. Не только слушай музыку — узнавай её.",
                modifier = Modifier.widthIn(max = 440.dp),
                style = MusixTheme.type.body.copy(fontSize = 15.sp, lineHeight = 1.55.em, color = Color(0x99EEEEF3), textAlign = TextAlign.Center),
            )
            Spacer(Modifier.height(28.dp))
            LiquidGlass(Modifier.fillMaxWidth().widthIn(max = 460.dp)) {
                Column(Modifier.padding(horizontal = 24.dp, vertical = 28.dp)) {
                    ServerRow(ui, edit, saveServer)
                    Eyebrow("Общий сервер", Modifier.padding(bottom = 18.dp), color = Color(0x80EEEEF3))
                    TabPair(listOf("Войти", "Регистрация"), if (ui.register) 1 else 0, { i -> edit { copy(register = i == 1) } },
                        Modifier.padding(bottom = 18.dp))
                    MusixField(ui.email, { v -> edit { copy(email = v) } }, "email",
                        keyboard = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next, autoCorrectEnabled = false))
                    Spacer(Modifier.height(10.dp))
                    MusixField(ui.password, { v -> edit { copy(password = v) } }, "пароль", password = true,
                        keyboard = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = if (ui.register) ImeAction.Next else ImeAction.Go),
                        actions = KeyboardActions(onGo = { submit() }))
                    if (ui.register) {
                        Spacer(Modifier.height(10.dp))
                        MusixField(ui.invite, { v -> edit { copy(invite = v.take(12)) } }, "инвайт-код (12 символов)",
                            keyboard = KeyboardOptions(capitalization = KeyboardCapitalization.Characters, imeAction = ImeAction.Go, autoCorrectEnabled = false),
                            actions = KeyboardActions(onGo = { submit() }),
                            textStyle = MusixTheme.type.label.copy(fontSize = 14.sp, letterSpacing = 0.1.em))
                    }
                    ui.error?.let {
                        Spacer(Modifier.height(10.dp))
                        Text(it, Modifier.fillMaxWidth().background(Color(0x1FFF5050), RoundedCornerShape(11.dp))
                            .border(1.dp, Color(0x38FF5050), RoundedCornerShape(11.dp)).padding(horizontal = 13.dp, vertical = 9.dp),
                            style = MusixTheme.type.body.copy(fontSize = 13.sp, color = Color(0xFFFF9090)))
                    }
                    Spacer(Modifier.height(18.dp))
                    CtaButton(
                        when { ui.busy -> "Подождите…"; ui.register -> "Создать аккаунт"; else -> "Войти" },
                        submit, Modifier.fillMaxWidth(), enabled = !ui.busy,
                    )
                }
            }
        }
    }
}

@Composable
private fun ServerRow(ui: AuthUi, edit: (AuthUi.() -> AuthUi) -> Unit, saveServer: (String) -> Unit) {
    var draft by remember(ui.server) { mutableStateOf(ui.server) }
    if (!ui.editingServer) {
        Row(Modifier.fillMaxWidth().padding(bottom = 14.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("Сервер: ", style = MusixTheme.type.body.copy(fontSize = 12.5.sp, color = Color(0x8CEEEEF3)))
            Text(ui.server.removePrefix("https://").removePrefix("http://"), Modifier.weight(1f), maxLines = 1,
                overflow = TextOverflow.Ellipsis, style = MusixTheme.type.body.copy(fontSize = 12.5.sp, color = Color(0xD9EEEEF3)))
            Text("Сменить", Modifier.pressable { edit { copy(editingServer = true) } }.padding(horizontal = 10.dp, vertical = 4.dp),
                style = MusixTheme.type.body.copy(fontSize = 13.sp, fontWeight = FontWeight.Medium, color = Color(0x8CEEEEF3)))
        }
    } else {
        Column(Modifier.padding(bottom = 14.dp)) {
            MusixField(draft, { draft = it }, "musixai.ru",
                keyboard = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Done, autoCorrectEnabled = false),
                actions = KeyboardActions(onDone = { saveServer(draft) }))
            Spacer(Modifier.height(10.dp))
            CtaButton("Подключиться", { saveServer(draft) }, Modifier.fillMaxWidth())
        }
    }
}

/** `.login-hero-block` + the two `.login-aurora` blobs (blurred circles ≈ radial fades). */
@Composable
private fun Aurora() {
    Canvas(Modifier.fillMaxSize()) {
        val w = size.width
        val h = size.height
        drawRect(Brush.radialGradient(0f to Color(0xFF1C1830), 0.45f to Color(0xFF12101C), 1f to Color(0xFF0A0A10),
            center = Offset(w * 0.7f, -h * 0.1f), radius = maxOf(w * 1.2f, h * 0.9f)))
        val vmax = maxOf(w, h) / 100f
        drawCircle(Brush.radialGradient(listOf(Color(0x52583DA6), Color.Transparent), center = Offset(-12 * vmax + 23 * vmax, -18 * vmax + 23 * vmax), radius = 23 * vmax * 1.3f),
            radius = 23 * vmax * 1.3f, center = Offset(11 * vmax, 5 * vmax))
        drawCircle(Brush.radialGradient(listOf(Color(0x33007489), Color.Transparent), center = Offset(w + 10 * vmax - 20 * vmax, h + 16 * vmax - 20 * vmax), radius = 20 * vmax * 1.3f),
            radius = 20 * vmax * 1.3f, center = Offset(w - 10 * vmax, h - 4 * vmax))
    }
}
