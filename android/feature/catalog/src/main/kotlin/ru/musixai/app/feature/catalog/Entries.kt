package ru.musixai.app.feature.catalog

import ru.musixai.app.feature.catalog.Screen.Album
import ru.musixai.app.feature.catalog.Screen.Artist
import ru.musixai.app.feature.catalog.Screen.Assistant
import ru.musixai.app.feature.catalog.Screen.Auth
import ru.musixai.app.feature.catalog.Screen.Chat
import ru.musixai.app.feature.catalog.Screen.Home
import ru.musixai.app.feature.catalog.Screen.Import
import ru.musixai.app.feature.catalog.Screen.Library
import ru.musixai.app.feature.catalog.Screen.Player
import ru.musixai.app.feature.catalog.Screen.Playlist
import ru.musixai.app.feature.catalog.Screen.Quiz
import ru.musixai.app.feature.catalog.Screen.Search
import ru.musixai.app.feature.catalog.Screen.Settings
import ru.musixai.app.feature.catalog.Screen.Stats
import ru.musixai.app.feature.catalog.Screen.Upload

private val ALL = Screen.entries.toList()
private const val STILL = "в покое 0 кадров"

/** Everything the library holds today (stage A), layer by layer. A new component comes with its card. */
val CATALOG: List<CatalogEntry> = listOf(
    // — Основа
    CatalogEntry("text", "Типографика", Layer.Foundation, ALL,
        "Девять ролей текста веба: от подписи до цифр в моноширинном с табличными цифрами.",
        STILL) { TextDemo() },
    CatalogEntry("float", "Плавающая и плита", Layer.Foundation, listOf(Library, Player, Artist, Playlist, Settings, Assistant),
        "float — шиты, тосты, меню: сплошной фон, волосяная кромка, глубокая тень. plate — плиты списков и карточек.",
        STILL) { SurfacesDemo() },

    // — Движение
    CatalogEntry("springs", "Пружины", Layer.Motion, ALL,
        "Одна физика на всё приложение: меню, страница, поп, оседание. Перебитая пружина сохраняет скорость.",
        "кадры только в пути") { SpringsDemo() },
    CatalogEntry("reveal", "Появление и скрытие", Layer.Motion, listOf(Library, Assistant, Player, Settings, Album),
        "Четыре манеры: подъём, складка, схлоп, растворение. Уход — короткий ease-in; без анимаций — сразу.",
        "кадры только в пути", states = listOf("Подъём", "Складка", "Схлоп", "Растворение")) { RevealDemo(it) },
    CatalogEntry("swap", "Смена содержимого", Layer.Motion, listOf(Player, Stats, Library, Assistant),
        "Число, подпись, значок меняются на месте: старое растворяется, новое приходит снизу.",
        "кадры только в пути") { SwapDemo() },
    CatalogEntry("cascade", "Впрыгивание лесенкой", Layer.Motion, listOf(Library, Artist, Playlist, Search, Album),
        "Плитки поднимаются по очереди, шаг 30 мс, вся лесенка — не дольше 216 мс. Только при входе на экран.",
        "кадры только в пути") { CascadeDemo() },
    CatalogEntry("pop", "Поп", Layer.Motion, listOf(Assistant, Library, Player, Album),
        "Отметка «нравится», галочка добавления: один ясный перелёт за 1 и обратно.",
        "кадры только в пути") { PopDemo() },
    CatalogEntry("parking", "Цикл с парковкой", Layer.Motion, listOf(Home, Player),
        "Физика по кадрам (сфера главной), которая засыпает, когда всё замерло. Тяните шарик — счётчик кадров встанет вместе с ним.",
        "кадры только в движении") { ParkingDemo() },
    CatalogEntry("pageFocus", "Смена страницы фокусом", Layer.Motion, ALL,
        "Как в вебе: ничего не едет через экран — уходящая страница теряет фокус, новая собирается из размытия. Так меняются все экраны приложения.",
        "кадры только в пути") { PageFocusDemo() },
    CatalogEntry("coverFlight", "Перелёт обложки", Layer.Motion, listOf(Home, Library, Album, Artist, Search),
        "Обложка, которую запустили, летит в мини-плеер. Живёт в оболочке приложения.",
        "кадры только в полёте") { CoverFlightNote() },
    CatalogEntry("wave", "Волна", Layer.Motion, listOf(Player, Playlist, Home),
        "Линия рябит, пока играет, и ложится ровно на паузе: высота — на пружине без отскока, фаза бежит только пока играет. Рисуется в отрисовке, без перекомпоновки.",
        "кадры только пока играет") { WaveDemo() },

    // — Жесты
    CatalogEntry("press", "Нажатие", Layer.Gesture, ALL,
        "Пять ролей: значок 0.9, вкладка 0.94, чип 0.96, строка 0.99, карточка 0.98. Вибрация — только если задана.",
        STILL) { PressDemo() },
    CatalogEntry("debounce", "Защита от двойного", Layer.Gesture, ALL,
        "Окно 500 мс: двойное нажатие на «Повторить», «Отправить», «Добавить» — одно действие.",
        STILL) { DebounceDemo() },
    CatalogEntry("haptics", "Словарь вибрации", Layer.Gesture, ALL,
        "Девять сигналов, только от пальца. Ворота 45/120 мс глушат дребезг; системная настройка — закон.",
        STILL, haptic = "все девять") { HapticsDemo() },
    CatalogEntry("rubber", "Резинка и бросок", Layer.Gesture, listOf(Player, Library, Playlist),
        "За пределом ход даётся всё труднее; отпустили — решают место и скорость. На этом стоят шиты.",
        STILL) { RubberDemo() },
    CatalogEntry("swipeRemove", "Смахнуть, чтобы убрать", Layer.Gesture, listOf(Player, Playlist, Library),
        "Строка идёт за пальцем влево 1:1, вправо только поддаётся. За 110 dp — корзина и порог; отпустил — строка уходит, тост «Вернуть». Играющую убрать нельзя: «нет»-встряска.",
        "кадры только под пальцем", haptic = "Threshold · ThresholdOff · Reject") { SwipeDemo() },

    // — Поверхности
    CatalogEntry("glass", "Стекло: прозрачное и матовое", Layer.Surface, listOf(Home, Player, Search, Auth, Import),
        "Kyant liquid glass, два стекла по назначению. Прозрачное (Chip, Clear) — кнопка или одиночный элемент, читать нечего. Матовое (Label, Deep) — там, где текст: плотнее тело, в светлой теме плотнее, чем в тёмной.",
        STILL) { GlassDemo() },
    CatalogEntry("morphMenu", "Перетекающее меню", Layer.Surface, listOf(Home, Library, Assistant, Player),
        "Кнопка перетекает в панель и обратно на одной пружине; настоящая кнопка гаснет навстречу — ни кадра подмены.",
        "кадры только в пути") { MorphMenuDemo() },
    CatalogEntry("sheet", "Шит", Layer.Surface, listOf(Library, Player, Artist, Playlist, Assistant),
        "Один за раз, до 74 % высоты. Идёт за пальцем, за открытым — резинка; «назад» тянет вниз вместе с жестом.",
        "кадры только в пути", haptic = "Threshold на середине") { SheetDemo() },
    CatalogEntry("toast", "Тосты", Layer.Surface, listOf(Library, Playlist, Player, Settings),
        "Стопка до трёх: новый впереди, старые меньше и выше. 4 с, держится под пальцем, смахивается вбок.",
        "кадры только в пути") { ToastDemo() },

    // — Контролы
    CatalogEntry("roundButton", "Круглая кнопка", Layer.Control, listOf(Player, Home, Album, Artist, Settings),
        "40 dp в зоне 48. Включённая светится акцентом, значок подпрыгивает: 1.45, 8°, 520 мс.",
        STILL, haptic = "ToggleOn / ToggleOff у переключателя") { RoundButtonDemo() },
    CatalogEntry("pill", "Пилюля", Layer.Control, listOf(Library, Assistant, Artist, Search, Chat),
        "Мягкая, контурная, пунктирная («нет в фонотеке»), акцентная. Слот впереди — точка, значок, обложка.",
        STILL) { PillDemo() },
    CatalogEntry("textLink", "Ссылка", Layer.Control, listOf(Settings, Artist, Album, Assistant),
        "Подчёркивание 1 dp на 4 dp под строкой, 42 % цвета, на каждой строке переноса. Главная ссылка — со стрелкой.",
        STILL) { TextLinkDemo() },
    CatalogEntry("tabs", "Вкладки", Layer.Control, listOf(Library, Settings, Stats, Artist),
        "Черта под активной перетекает двумя краями; узкий экран прокручивает ряд к выбранной.",
        "кадры только в пути") { TabsDemo() },
    CatalogEntry("segments", "Сегменты", Layer.Control, listOf(Settings, Library, Stats, Player),
        "Текучая подсветка идёт за пальцем по ряду, тик на каждом сегменте.",
        "кадры только в пути", haptic = "Tick") { SegmentsDemo() },
    CatalogEntry("morphIcon", "Перетекающий значок", Layer.Control, listOf(Playlist, Library, Album, Player, Search),
        "Плюс → галочка → минус → крест: те же два штриха, восемь концов на своих пружинах.",
        "кадры только в пути") { MorphIconDemo() },
    CatalogEntry("field", "Поле и поиск", Layer.Control, listOf(Search, Assistant, Chat, Library, Auth, Import),
        "48 dp, акцентная кромка в фокусе, крестик приходит с первой буквой. Состояние держит экран.",
        STILL) { FieldDemo() },
    CatalogEntry("playPause", "Пуск и пауза", Layer.Control, listOf(Player, Home, Album, Playlist),
        "Треугольник перетекает в две черты на пружине значка.",
        "кадры только в пути") { PlayPauseDemo() },
    CatalogEntry("richbox", "Richbox", Layer.Control, listOf(Player, Assistant, Upload, Import),
        "Порт mishanaer/richbox (MIT): пунктир ждёт и поворачивается на четверть раз в 1,3 с, заполняется четвертями, рисует знак штрих за штрихом — ✓, ✕, !.",
        "в ожидании — 0,3 с кадров на 1,3 с", states = RICHBOX_STATES) { RichboxDemo(it) },
    CatalogEntry("foldingComposer", "Сворачивающееся поле", Layer.Control, listOf(Player, Assistant, Chat),
        "Пока готовится ответ, поле сворачивается в свою круглую кнопку с Richbox — касание останавливает ответ; рядом одна мерцающая строка о том, что делается.",
        "кадры только в пути и пока мерцает", haptic = "ToggleOff (стоп)") { ComposerDemo() },
    CatalogEntry("songLine", "Полоса песни", Layer.Control, listOf(Player, Quiz),
        "Разделы блоками (припевы светлее), прослушанное — акцентом, не поверх серого; волна над сыгранным; моменты называют себя за 6 с. Перемотка пальцем 1:1: блоки толще, время и раздел — на матовом стекле, тик на каждой границе.",
        "кадры только пока играет", haptic = "Tick на границе раздела") { SongLineDemo() },

    // — Содержимое
    CatalogEntry("cover", "Обложка", Layer.Content, listOf(Home, Library, Album, Artist, Playlist, Search, Player, Quiz),
        "Картинка с blurhash, без неё — свой градиент по названию и инициалы. Мозаика — для плейлистов.",
        STILL) { CoverDemo() },
    CatalogEntry("progressive", "Сначала лёгкая, потом чёткая", Layer.Content, listOf(Player, Album, Artist),
        "Лёгкая картинка сразу (обычно уже в кеше), чёткая проявляется поверх, когда раскодирована, — без пустого кадра между ними. Плеер: 256 → 1024.",
        "кадры только при проявлении") { ProgressiveDemo() },
    CatalogEntry("loading", "Скелет, крутилка, пусто", Layer.Content, listOf(Library, Artist, Playlist, Stats, Upload, Import),
        "Скелет — пока грузится раскладка, крутилка — пока ждём ответа, «пусто» — тихая строка.",
        "кадры пока грузится") { LoadingDemo() },
    CatalogEntry("stateHost", "Состояния экрана", Layer.Content, ALL,
        "Загрузка, пусто, ошибка, готово — в одном месте. Виды растворяются друг в друге, «Повторить» защищён от двойного.",
        "кадры только в пути", states = listOf("Загрузка", "Пусто", "Ошибка", "Готово")) { StateHostDemo(it) },
    CatalogEntry("markdown", "Текст ассистента", Layer.Content, listOf(Assistant, Chat),
        "Абзацы, списки, жирный и курсив, код, ссылки и свои значки сносок.",
        STILL) { MarkdownDemo() },
    CatalogEntry("conversation", "Вопрос и ответ", Layer.Content, listOf(Player, Assistant, Chat),
        "Свой вопрос — справа, в цвете акцента обложки; ответ — текстом для чтения слева; ходы разделены акцентной волосяной линией. Мерцающая строка — что делается сейчас.",
        "мерцание — пока работает") { ConversationDemo() },
)
