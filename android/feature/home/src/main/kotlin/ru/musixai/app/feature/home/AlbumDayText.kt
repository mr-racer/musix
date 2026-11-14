package ru.musixai.app.feature.home

import ru.musixai.app.core.model.DayAlbum
import ru.musixai.app.core.model.DayTrack
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.temporal.ChronoUnit
import kotlin.math.ceil
import kotlin.math.max

/** A line of the card: its parts, the numbers bold (r2: «число жирным»). */
data class Phrase(val parts: List<Pair<String, Boolean>>) {
    val text: String get() = parts.joinToString("") { it.first }
    val bold: List<String> get() = parts.filter { it.second }.map { it.first }
}

/**
 * «Альбом дня»: progress and phrases as pure functions, the r2 model (album-day-model.js)
 * word for word. Songs of a minute or less (skits, intros) never count; the album is played
 * through at 75 % of the counted songs, in any order. The server gives the numbers only.
 */
internal object AlbumDayText {
    const val SKIT_MS = 60_000L
    private const val FINISH = 0.75
    val SONGS = listOf("песня", "песни", "песен")
    private val TIMES = listOf("раз", "раза", "раз")
    private val MONTHS_GEN = listOf("января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря")

    fun plural(n: Int, forms: List<String>): String {
        val a = kotlin.math.abs(n) % 100
        val b = a % 10
        return forms[if (b == 1 && a != 11) 0 else if (b in 2..4 && (a < 12 || a > 14)) 1 else 2]
    }

    fun num(n: Int, forms: List<String>) = "$n ${plural(n, forms)}"

    data class Progress(val heard: Int, val total: Int, val finishAt: Int, val left: Int, val fraction: Float, val done: Boolean)

    fun countable(tracks: List<DayTrack>) = tracks.filter { it.durationMs > SKIT_MS }

    /** [extraHeard]: songs heard on this phone since the home was fetched. */
    fun progress(tracks: List<DayTrack>, extraHeard: Set<String> = emptySet()): Progress {
        val counted = countable(tracks)
        val total = counted.size
        val heard = counted.count { it.heard || it.id in extraHeard }
        val finishAt = ceil(FINISH * total).toInt()
        return Progress(heard, total, finishAt, max(0, finishAt - heard), if (total > 0) heard.toFloat() / total else 0f, total > 0 && heard >= finishAt)
    }

    /** r3's compact button: «Слушать» / «7 из 11» / «Ещё раз». */
    fun buttonLabel(p: Progress) = when {
        p.done -> "Ещё раз"
        p.heard == 0 -> "Слушать"
        else -> "${p.heard} из ${p.total}"
    }

    /** The line under the button once the album is started; [variant] alternates the two mid-way lines. */
    fun progressPhrase(p: Progress, variant: Int, short: Boolean = false): Phrase? {
        if (p.heard == 0 || p.done) return null
        if (p.left == 1) return md("Последняя песня до финиша")
        if (p.heard * 2 >= p.total && variant % 2 == 1) return md("Половина позади. Не сворачивай")
        return md(if (short) "Ещё **${num(p.left, SONGS)}** — и обыграна" else "Ещё **${num(p.left, SONGS)}** — и пластинка обыграна")
    }

    /** The progress slot at rest before the first song: «13 песен · 52 мин». */
    fun restCaption(tracks: List<DayTrack>): String {
        val songs = countable(tracks).size
        val min = (tracks.sumOf { it.durationMs } + 30_000) / 60_000
        return "${num(songs, SONGS)} · $min мин"
    }

    fun quote(title: String, max: Int = 99) = "«${cut(title, max)}»"

    fun name(name: String, max: Int = 99) = cut(name, max)

    private fun cut(s: String, max: Int) = if (s.length <= max) s else s.take(max(1, max - 1)).trimEnd() + "…"

    /** The numbers a phrase needs; [songMax] / [artistMax] keep a phrase to two lines. */
    data class Facts(
        val song: String = "", val n: Int = 0, val k: Int = 0,
        val artist: String = "", val rank: Int? = null, val hours: Int = 0, val otherAlbumsHeard: Int = 0,
        val plays: Int = 0, val monthGen: String = "", val days: Int = 0,
        val songMax: Int = 26, val artistMax: Int = 22,
    )

    fun facts(d: DayAlbum, today: LocalDate, zone: ZoneId = ZoneId.systemDefault()): Facts {
        val last = d.lastPlayedAt?.let { Instant.ofEpochMilli(it).atZone(zone).toLocalDate() }
        return Facts(
            song = d.tracks.firstOrNull { it.id == d.songId }?.title.orEmpty(), n = d.songPlays, k = max(0, countable(d.tracks).size - 1),
            artist = d.artist.orEmpty(), rank = d.artistRank, hours = d.artistPlayedMin / 60, otherAlbumsHeard = d.otherAlbumsHeard,
            plays = d.plays, monthGen = last?.let { MONTHS_GEN[it.monthValue - 1] }.orEmpty(), days = last?.let { ChronoUnit.DAYS.between(it, today).toInt() } ?: 0,
        )
    }

    fun phrases(kind: String, f: Facts): List<Phrase> = when (kind) {
        "one" -> {
            val q = safe(quote(f.song, f.songMax))
            listOf(
                "$q играла **${num(f.n, TIMES)}**. Остальные ${f.k} ${plural(f.k, SONGS)} ревнуют",
                "$q уже можно петь с закрытыми глазами. Теперь открой их на остальные **${f.k}**",
                "**${num(f.n, TIMES)}** $q — это уже не песня, а прописка",
                "Одна песня на репите — это любовь. Целый альбом — уже отношения",
                "Раз $q так заходит, представь, что прячется в соседних **${f.k} ${plural(f.k, listOf("треке", "треках", "треках"))}**",
            ).map(::md)
        }
        "never" -> {
            val a = safe(name(f.artist, f.artistMax))
            listOfNotNull(
                f.rank?.let { "$a у тебя **№$it**, а этот альбом всё ещё в плёнке" },
                if (f.hours >= 1) "**${num(f.hours, listOf("час", "часа", "часов"))}** с $a — и ни минуты отсюда. Непорядок" else null,
                // «старался / старалась / старались»: the library knows no artist's gender, so never
                if (f.otherAlbumsHeard >= 2) "Все альбомы $a затёрты до дыр, а этот как новенький" else null,
            ).ifEmpty { listOf("Этот альбом всё ещё в плёнке. Самое время снять") }.map(::md)
        }
        "long" -> listOfNotNull(
            if (f.monthGen.isNotEmpty()) "**${num(f.plays, TIMES)}**, а потом тишина с ${f.monthGen}. Что случилось?" else null,
            if (f.days > 0) "**${num(f.days, listOf("день", "дня", "дней"))}** без этого альбома. Он считал" else null,
            "На пластинке уже слой пыли. Лучшая тряпочка — проигрыватель",
            "Старый друг лучше новых двух. Особенно после **${num(f.plays, listOf("прослушивания", "прослушиваний", "прослушиваний"))}**",
        ).map(::md)
        else -> emptyList()
    }

    fun finalePhrases() = listOf("Обыграна! От первой песни до последней", "Обыграна! Альбом пройден, можно хвастаться")

    /** The card's phrase changes every three hours of the local day (the owner, 2026-11-14):
     *  00–03 is the day's first slot, 21–24 its eighth. */
    fun phraseSlot(epochMs: Long, zone: ZoneId = ZoneId.systemDefault()): Long {
        val t = Instant.ofEpochMilli(epochMs).atZone(zone)
        return t.toLocalDate().toEpochDay() * 8 + t.hour / 3
    }

    /** The phrase for [slot] out of [n]: the next slot always shows the next one. */
    fun phraseIndex(albumId: String, slot: Long, n: Int): Int =
        if (n <= 1) 0 else Math.floorMod(albumId.hashCode().toLong() + slot, n.toLong()).toInt()

    private val EDITION = Regex(
        """(?i)\b(edition|deluxe|expanded|anniversary|remaster(ed)?|version|extended|edit|clean|explicit|soundtrack|s/t|inspired by|""" +
            """motion picture|slowed|sped up|reverb|remix|japan|bonus|reissue|ep)\b|^from\s""",
    )
    private val BRACKETED = Regex("""^(.*\S)\s*[(\[]([^()\[\]]+)[)\]]$""")
    private val DASHED = Regex("""^(.*\S)\s+[-–—]\s+([^-–—]+)$""")

    /** «Born to Die (The Paradise Edition)» → the name and the edition, which goes to the grey
     *  line under it; brackets that are part of the name («Aglow (Intro)») stay. */
    fun edition(title: String): Pair<String, String?> {
        val t = title.trim()
        for (r in listOf(BRACKETED, DASHED)) {
            val m = r.matchEntire(t) ?: continue
            val (name, ed) = m.destructured
            if (EDITION.containsMatchIn(ed.trim())) return name.trim() to ed.trim()
        }
        return title to null
    }

    fun dayLabel(day: LocalDate) = "${day.dayOfMonth} ${MONTHS_GEN[day.monthValue - 1]}"

    /** A name may not open or close a bold run. */
    private fun safe(s: String) = s.replace("**", "*​*")

    private fun md(s: String): Phrase = Phrase(s.split("**").mapIndexedNotNull { i, part -> if (part.isEmpty()) null else part to (i % 2 == 1) })
}
