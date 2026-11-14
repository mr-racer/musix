package ru.musixai.app.feature.home

/** r3 §5.1: the hero's form by the page's height (dp between the status bar and the mini-player). */
enum class HeroForm { Compact, Row, Column }

data class HeroSpec(val form: HeroForm, val orb: Float)

/** < 480: a compact row, orb 80 (no «Твой вайб», gaps 6, cover 56); 480–649: a row,
 *  orb 88–104; ≥ 650: a centred column, orb 120–168 growing with the page. */
fun heroSpec(page: Float): HeroSpec = when {
    page < 480f -> HeroSpec(HeroForm.Compact, 80f)
    page < 650f -> HeroSpec(HeroForm.Row, lerp(88f, 104f, (page - 480f) / 169f))
    else -> HeroSpec(HeroForm.Column, lerp(120f, 168f, (page - 650f) / 250f))
}

/** How the hero lays itself out in the height it actually got. */
data class HeroLayout(val column: Boolean, val orb: Float)

/**
 * The page form sets the blocks around the hero; the hero's own arrangement goes by its own
 * height, since a one-line phrase or a day without an album leaves a row page room to stand
 * up (a 104 orb in a row with empty sky above and below was the r2 void again). A column needs
 * the largest row orb (104) over its 100 of title and capsule; its orb is 120 on a row page and
 * grows with a column page. Too short for that, the hero lies down as a row. Compact stays a
 * compact row.
 */
fun heroLayout(spec: HeroSpec, heroHeight: Float): HeroLayout {
    val room = heroHeight - COLUMN_TEXT
    if (spec.form != HeroForm.Compact && room >= ROW_MAX) {
        return HeroLayout(true, minOf(if (spec.form == HeroForm.Column) spec.orb else COLUMN_MIN, room))
    }
    return HeroLayout(false, minOf(spec.orb, ROW_MAX, heroHeight).coerceAtLeast(ORB_MIN))
}

const val COLUMN_TEXT = 100f  // 14 + the title line (26) + 12 + the capsule's 48 target, measured by HomeLayoutTest
private const val ROW_MAX = 104f
private const val COLUMN_MIN = 120f
private const val ORB_MIN = 80f

private fun lerp(a: Float, b: Float, t: Float) = a + (b - a) * t.coerceIn(0f, 1f)
