package ru.musixai.app.feature.auth

import androidx.compose.runtime.Immutable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import ru.musixai.app.core.data.AuthRepository
import ru.musixai.app.core.common.ApiError
import javax.inject.Inject

@Immutable
data class AuthUi(
    val server: String = "",
    val editingServer: Boolean = false,
    val register: Boolean = false,
    val email: String = "",
    val password: String = "",
    val invite: String = "",
    val busy: Boolean = false,
    val error: String? = null,
)

@HiltViewModel
class AuthViewModel @Inject constructor(private val auth: AuthRepository) : ViewModel() {
    private val _ui = MutableStateFlow(AuthUi())
    val ui: StateFlow<AuthUi> = _ui

    init {
        viewModelScope.launch { auth.server.collect { s -> _ui.update { it.copy(server = s) } } }
    }

    fun edit(f: AuthUi.() -> AuthUi) = _ui.update { it.f().copy(error = null) }

    fun saveServer(url: String) = viewModelScope.launch {
        auth.setServer(url)
        _ui.update { it.copy(editingServer = false) }
    }

    fun submit() {
        val s = _ui.value
        if (s.busy || s.email.isBlank() || s.password.isEmpty() || (s.register && s.invite.length != 12)) return
        _ui.update { it.copy(busy = true, error = null) }
        viewModelScope.launch {
            val err = runCatching {
                if (s.register) auth.register(s.email, s.password, s.invite) else auth.login(s.email, s.password)
            }.exceptionOrNull()
            _ui.update { it.copy(busy = false, error = err?.let(::message)) }
        }
    }

    private fun message(e: Throwable): String = when {
        e is ApiError && e.status == 401 -> "Неверный email или пароль"
        e is ApiError && e.status == 404 -> "Инвайт не найден или уже использован"
        e is ApiError && e.status == 409 -> "Такой email уже зарегистрирован"
        e is ApiError && e.status == 429 -> "Слишком много попыток — подождите минуту"
        e is ApiError -> "Сервер ответил ${e.status}"
        else -> "Нет связи с сервером"
    }
}
