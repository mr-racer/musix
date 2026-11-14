package ru.musixai.app.feature.catalog

import androidx.compose.runtime.Composable

/** The library's layers (2026-11-14 spec §5.1), lowest first: a layer takes only from those below. */
enum class Layer(val title: String, val rule: String) {
    Foundation("Основа", "Цвет, шрифт, поверхности. Ни от чего не зависит."),
    Motion("Движение", "Пружины, появления, перелёты. Только сдвиг, масштаб и прозрачность; в покое — ни кадра."),
    Gesture("Жесты", "Нажатие, перетаскивание, защита от двойного, вибрация."),
    Surface("Поверхности", "Шиты, тосты, меню, стекло — то, что ложится поверх экрана."),
    Control("Контролы", "Кнопки, вкладки, сегменты, поля."),
    Content("Содержимое", "Обложки, текст ассистента, состояния экрана."),
}

/** The screens of the migration plan (§8) — who takes a component. */
enum class Screen(val title: String) {
    Home("Главная"), Library("Библиотека"), Stats("Статистика"), Album("Разворот"), Assistant("Ассистент"),
    Chat("Чат по треку"), Player("Плеер"), Artist("Артист"), Playlist("Плейлист"), Search("Поиск"),
    Settings("Настройки"), Upload("Загрузка"), Import("Импорт"), Quiz("Игра"), Auth("Вход"),
}

/**
 * One card of «Витрина»: what it is, who takes it, what it says to the hand, what it costs —
 * and a live demo. [states] are the demo's chips (loading / empty / …); the chosen one is
 * passed to [demo], "" when there are none.
 */
class CatalogEntry(
    val id: String,
    val name: String,
    val layer: Layer,
    val users: List<Screen>,
    val what: String,
    val cost: String,
    val haptic: String? = null,
    val states: List<String> = emptyList(),
    val demo: @Composable (state: String) -> Unit,
)

/**
 * The rule of entry (§5.2): the library holds a behaviour — motion, a gesture — or a look that
 * at least two screens take. Anything one screen alone needs stays in that screen.
 */
fun CatalogEntry.earnsItsPlace(): Boolean =
    layer == Layer.Motion || layer == Layer.Gesture || users.toSet().size >= 2
