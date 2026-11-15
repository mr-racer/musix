package ru.musixai.app.feature.artist

import androidx.compose.ui.graphics.Color
import ru.musixai.app.core.model.AlbumPage
import ru.musixai.app.core.model.ArtistPage
import ru.musixai.app.core.model.ArtistYou
import ru.musixai.app.core.model.Grammy
import ru.musixai.app.core.model.Image
import java.time.Instant
import java.time.ZoneId
import java.util.Locale

/* The artist page's data, shaped once per response — web `artist/model.ts` `prep`, the mock's
   `prep` (design/proposals/android-2026-11-15/artist-album-review). Pure: unit-tested. */

internal fun plural(n: Int, one: String, few: String, many: String): String {
    val a = kotlin.math.abs(n)
    return if (a % 10 == 1 && a % 100 != 11) one else if (a % 10 in 2..4 && a % 100 !in 12..14) few else many
}
internal fun songs(n: Int) = plural(n, "песня", "песни", "песен")
internal fun songsOf(n: Int) = plural(n, "песни", "песен", "песен")
internal fun albumsW(n: Int) = plural(n, "альбом", "альбома", "альбомов")
internal fun playsW(n: Int) = plural(n, "прослушивание", "прослушивания", "прослушиваний")
internal fun timesW(n: Int) = plural(n, "раз", "раза", "раз")
internal fun yearsW(n: Int) = plural(n, "год", "года", "лет")
internal fun nomsW(n: Int) = plural(n, "номинация", "номинации", "номинаций")

private val GENRE = mapOf(
    "Hip-Hop" to "Хип-хоп", "Hip Hop" to "Хип-хоп", "Rap" to "Рэп", "Pop" to "Поп", "Rock" to "Рок", "R&B" to "R&B",
    "Electronic" to "Электроника", "Dance" to "Танцевальная", "Alternative" to "Альтернатива", "Indie" to "Инди",
    "Metal" to "Метал", "Jazz" to "Джаз", "Soul" to "Соул", "Country" to "Кантри", "Classical" to "Классика",
    "Soundtrack" to "Саундтрек", "Reggae" to "Регги", "Punk" to "Панк", "Folk" to "Фолк", "Blues" to "Блюз", "Funk" to "Фанк",
)
// short Russian names where the locale's are long
private val COUNTRY = mapOf("US" to "США", "GB" to "Великобритания", "AE" to "ОАЭ", "KR" to "Южная Корея", "KP" to "КНДР", "CZ" to "Чехия", "RU" to "Россия", "NL" to "Нидерланды")

internal fun countryName(cc: String?): String? {
    val up = cc?.uppercase()?.takeIf { it.length == 2 } ?: return null
    return COUNTRY[up] ?: Locale("", up).getDisplayCountry(Locale("ru")).takeIf { it.isNotBlank() && it != up }
}

/** The flag of a two-letter country code, as the regional indicator pair. */
internal fun flagOf(cc: String?): String? = cc?.uppercase()?.takeIf { it.length == 2 && it.all { ch -> ch in 'A'..'Z' } }
    ?.map { String(Character.toChars(0x1F1E6 + (it - 'A'))) }?.joinToString("")

// what tags add to a reissue's title: shown as a chip next to the clean title
private val EDITION = Regex("""\s*[(\[]([^)\]]*(?:Edition|Deluxe|Version|Remaster|Tour|Anniversary|Expanded)[^)\]]*)[)\]]\s*$""", RegexOption.IGNORE_CASE)
private val EP = Regex("""\s*,?\s*-\s*(EP)$""")

/** «Whatever People Say I Am, That's What I'm Not (Deluxe Edition)» → the title and «Deluxe Edition». */
internal fun cleanTitle(title: String): Pair<String, String?> {
    val m = EDITION.find(title) ?: EP.find(title) ?: return title to null
    val ed = m.groupValues[1].replace(Regex("Australian Tour Edition", RegexOption.IGNORE_CASE), "Tour Edition")
        .replace(Regex("Expanded Edition", RegexOption.IGNORE_CASE), "Expanded")
    return title.substring(0, m.range.first).trimEnd().removeSuffix(",") to ed
}

/** Luminance of #rrggbb, 0..1: a light editorial page colour tames the photo. */
internal fun lum(hex: String?): Float {
    val v = hex?.removePrefix("#")?.takeIf { it.length == 6 }?.toIntOrNull(16) ?: return 0f
    return (0.2126f * (v shr 16) + 0.7152f * ((v shr 8) and 255) + 0.0722f * (v and 255)) / 255f
}

internal fun hex(h: String?): Color? = h?.removePrefix("#")?.takeIf { it.length == 6 }?.toLongOrNull(16)?.let { Color(0xFF000000 or it) }

/** An album on the axis of years. [heard] songs of [n]; [plays] all its plays. */
internal data class Disc(val id: String, val title: String, val clean: String, val ed: String?, val year: Int?, val n: Int, val heard: Int, val plays: Int, val image: Image?) {
    val p: Float get() = if (n > 0) (heard.toFloat() / n).coerceIn(0f, 1f) else 0f
}

/** «весь · 12 песен», «7 из 12», «ещё не слушал». */
internal fun statText(d: Disc): String = when {
    d.p >= 1f -> "весь · ${d.n} ${songs(d.n)}"
    d.heard > 0 -> "${d.heard} из ${d.n}"
    else -> "ещё не слушал"
}

/* ── levels: a fan's way to the stage, the metal by rank (slate, bronze, silver, gold, platinum) ── */
internal class Level(
    val name: String, val at: Int, val rule: String,
    val metal: Color, val face: List<Color>, val ink: List<Color>, val inkLight: List<Color>,
)
internal val LEVELS = listOf(
    Level("На разогреве", 0, "первая песня", Color(0xFF9AA3B5), listOf(Color(0xFFE4E8F0), Color(0xFF8E97A8)), listOf(Color(0xFFEEF1F6), Color(0xFF9AA3B5)), listOf(Color(0xFF6F788A), Color(0xFF4A5264))),
    Level("Танцпол", 10, "10 прослушиваний", Color(0xFFC98A5A), listOf(Color(0xFFF6D3B0), Color(0xFFB9784A), Color(0xFF7A4524)), listOf(Color(0xFFF8DCC0), Color(0xFFC98A5A)), listOf(Color(0xFFA8643A), Color(0xFF6E3C1C))),
    Level("Первый ряд", 50, "50 прослушиваний", Color(0xFFC8CCD6), listOf(Color(0xFFFFFFFF), Color(0xFFC9CDD7), Color(0xFF8A8F9C)), listOf(Color(0xFFFFFFFF), Color(0xFFB4B9C5)), listOf(Color(0xFF7E8492), Color(0xFF525764))),
    Level("Бэкстейдж", 150, "150 и половина альбомов", Color(0xFFE3BD63), listOf(Color(0xFFFFF1C4), Color(0xFFE3BD63), Color(0xFFA87A26)), listOf(Color(0xFFFFF3CF), Color(0xFFD9AE4C)), listOf(Color(0xFFA87C22), Color(0xFF74540E))),
    Level("Легенда", 300, "300 и все альбомы", Color(0xFFCDD6FF), listOf(Color(0xFFFFFFFF), Color(0xFFDFE6F5), Color(0xFFC6CFEE), Color(0xFFF0E2F6), Color(0xFFB9C1D6)), listOf(Color(0xFFF6F8FF), Color(0xFFC9D5FF), Color(0xFFF3DAF6), Color(0xFFDFE8FF)), listOf(Color(0xFF4F5FA6), Color(0xFF8656A6), Color(0xFF3F6EAE))),
)

/** Where the listener stands: level [k], what the next one wants ([needTo], [needRest], [needN]), the way to it [p]. */
internal data class Standing(val k: Int, val needTo: String?, val needRest: String?, val needN: Int, val byPlays: Boolean, val p: Float, val done: Int) {
    val level: Level get() = LEVELS[k]
    val next: Level? get() = LEVELS.getOrNull(k + 1)
}

/** Plays open the first three levels; «Бэкстейдж» also wants half of the albums heard through (half of
 *  an album's songs or more), «Легенда» every album. */
internal fun standing(plays: Int, albums: List<Disc>): Standing {
    val done = albums.count { it.n > 0 && it.heard.toFloat() / it.n >= 0.5f }
    val cov = done.toFloat() / maxOf(1, albums.size)
    var k = 0
    for (j in LEVELS.indices) if (plays >= LEVELS[j].at && (j < 3 || cov >= (if (j == 3) 0.5f else 1f))) k = j
    val nx = LEVELS.getOrNull(k + 1) ?: return Standing(k, null, null, 0, true, 1f, done)
    val covNeed = if (k + 1 == 3) 0.5f else if (k + 1 == 4) 1f else 0f
    return if (plays < nx.at) {
        val l = nx.at - plays
        Standing(k, nx.name, "ещё $l ${playsW(l)}", l, true, plays.toFloat() / nx.at, done)
    } else {
        val l = kotlin.math.ceil(covNeed * albums.size).toInt() - done
        Standing(k, nx.name, "дослушать ещё $l ${albumsW(l)}", l, false, (cov / covNeed).coerceIn(0f, 1f), done)
    }
}

/** How often the artist is on the listener's air: radio words, never a place in a top (the owner,
 *  2026-10-16), with a five-bar meter. */
internal data class Air(val name: String, val bars: Int, val line: String)
private val FREQ = listOf("Не сходит с эфира" to 5, "Тяжёлая ротация" to 4, "В ротации" to 3, "Частый гость эфира" to 2, "Иногда в эфире" to 1, "Редко в эфире" to 1)
internal fun air(you: ArtistYou?): Air {
    val n = you?.artists ?: 0
    val r = you?.rank
    if (you == null || r == null || you.plays == 0 || n < 1) return Air("Ещё не в эфире", 0, "")
    val q = r.toFloat() / n
    val t = if (r == 1) 0 else if (q <= 0.02f) 1 else if (q <= 0.1f) 2 else if (q <= 0.3f) 3 else if (q <= 0.6f) 4 else 5
    val pct = if (n > 1) ((n - r).toFloat() / (n - 1) * 100).toInt() else 100
    return Air(FREQ[t].first, FREQ[t].second, if (r == 1) "чаще всех в твоей библиотеке" else "чаще, чем $pct % твоих артистов")
}

/** The page as the screen needs it. */
internal data class ArtistUi(
    val id: String,
    val name: String,
    val photo: Image?,
    val logo: Image?,
    val page: Color,
    val tint: Color,
    val light: Boolean,
    val flag: String?,
    val country: String?,
    val city: String?,
    val genre: String?,
    val years: String?,
    val dead: Boolean,
    val band: Boolean,
    val formed: Int?,
    val end: Int?,
    val nameOrigin: String?,
    val bio: String,
    val facts: List<String>,
    val albums: List<Disc>,
    val tracks: Int,
    val grammy: Grammy?,
    val plays: Int,
    val heardTracks: Int,
    val standing: Standing,
    val air: Air,
    val range: String,
)

internal fun ArtistPage.ui(albumPlays: Map<String, Int> = emptyMap()): ArtistUi {
    val f = facets
    fun num(k: String) = f[k]?.trim()?.let { v -> v.toIntOrNull() ?: Regex("""\b(\d{4})\b""").find(v)?.groupValues?.get(1)?.toIntOrNull() }
    val all = shelf.ifEmpty { albums.map { ru.musixai.app.core.model.ShelfAlbum(it.id, it.title, it.year, it.tracks, it.image, 0) } }.map { a ->
        val (clean, ed) = cleanTitle(a.title)
        Disc(a.id, a.title, clean, ed, a.year, a.tracks, heard[a.id] ?: 0, albumPlays[a.id] ?: 0, a.image)
    }.sortedWith(compareBy<Disc>({ it.year ?: 9999 }, { it.clean.lowercase() }))
    // singles and two-song leftovers stay off the axis when the artist has real albums
    val full = all.filter { it.n >= 3 }
    val discs = full.ifEmpty { all }
    val first = discs.firstOrNull { it.year != null }?.year
    val status = f["status"]?.lowercase().orEmpty()
    val dead = Regex("deceased|died|умер|скончал").containsMatchIn(status)
    val ended = dead || Regex("disband|split|распал|inactive").containsMatchIn(status)
    val af = num("active_from")
    val formed = num("formed_year") ?: af?.takeIf { first == null || it <= first }
    val start = if (formed != null && first != null) minOf(formed, first) else formed ?: first
    val end = if (ended) num("active_to") else null
    val shot = wide ?: photo ?: artist.imageId?.let { images[it] }
    val tint = hex(shot?.palette?.vibrant) ?: Color(0xFFD4A55A)
    val genre = topTracks.mapNotNull { it.genre }.groupingBy { it }.eachCount().maxByOrNull { it.value }?.key
    val plays = you?.plays ?: 0
    val years = discs.mapNotNull { it.year }
    val range = if (years.isEmpty()) "" else if (years.min() == years.max()) "${years.first()}" else "${years.min()} – ${years.max()}"
    return ArtistUi(
        id = artist.id, name = artist.name, photo = shot, logo = logo,
        page = hex(pageColor) ?: Color(0xFF111111), tint = tint, light = lum(pageColor) > 0.55f,
        flag = flagOf(countryCode), country = countryName(countryCode) ?: country, city = f["formed_place"]?.substringBefore(',')?.trim()?.takeIf { it.isNotEmpty() },
        genre = genre?.let { GENRE[it] ?: it },
        years = when { dead && start != null && end != null -> "$start–$end"; start != null && end != null -> "$start–$end"; start != null -> "с $start"; else -> null },
        dead = dead, band = f["formed_year"] != null, formed = formed, end = end,
        nameOrigin = f["name_origin"]?.trim()?.takeIf { it.isNotEmpty() },
        bio = bio?.trim().orEmpty(), facts = facts,
        albums = discs, tracks = trackCount, grammy = grammy?.takeIf { it.wins > 0 || it.nominations > 0 },
        plays = plays, heardTracks = you?.heardTracks ?: 0,
        standing = standing(plays, discs), air = air(you), range = range,
    )
}

/** Paragraphs of ~380 characters, cut at sentence ends (the biography reads like a page). */
internal fun paragraphs(text: String): List<String> {
    val out = mutableListOf<String>()
    var cur = ""
    for (s in text.split(Regex("""(?<=[.!?»])\s+(?=[A-ZА-ЯЁ«])"""))) {
        cur += (if (cur.isEmpty()) "" else " ") + s
        if (cur.length > 380) { out += cur; cur = "" }
    }
    if (cur.isNotEmpty()) out += cur
    return out
}

/* ── the album ── */

private val MON_P = listOf("январе", "феврале", "марте", "апреле", "мае", "июне", "июле", "августе", "сентябре", "октябре", "ноябре", "декабре")

/** The song played most, when it stands out (web Gatefold: at least 5 plays and 2 more than the next). */
internal fun hotOf(a: AlbumPage): String? {
    val top = a.trackPlays.entries.sortedByDescending { it.value }
    val first = top.firstOrNull() ?: return null
    val second = top.getOrNull(1)?.value ?: 0
    return first.key.takeIf { first.value >= 5 && first.value >= second + 2 }
}

/** The album's lamp line: one sentence of the listener and this record. */
internal fun lamp(a: AlbumPage, zone: ZoneId = ZoneId.systemDefault()): String {
    val n = a.tracks.size
    val heard = a.tracks.count { (a.trackPlays[it.id] ?: 0) > 0 }
    val plays = a.trackPlays.values.sum()
    return when {
        plays == 0 -> "Ещё не распечатан — самое время"
        heard == n && plays >= n * 2 -> "Обыгран до дыр: все $n ${songs(n)}"
        heard == n -> "Дослушан целиком · $plays ${timesW(plays)} вместе"
        heard * 2 < n -> "Начат: $heard из $n — есть что открыть"
        else -> {
            val last = a.lastPlayedAt?.let { MON_P[Instant.ofEpochMilli(it).atZone(zone).monthValue - 1] }
            "$plays ${timesW(plays)} вместе" + (last?.let { " · последний — в $it" } ?: "")
        }
    }
}

internal fun clock(ms: Long): String {
    val s = (ms / 1000).toInt()
    return "%d:%02d".format(s / 60, s % 60)
}
