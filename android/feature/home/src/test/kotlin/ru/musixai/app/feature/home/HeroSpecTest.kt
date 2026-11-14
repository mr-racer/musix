package ru.musixai.app.feature.home

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** r3 §5.1: the free height flows into the hero; the page height picks its form. */
class HeroSpecTest {
    @Test fun `a short page is a compact row, a middle one a row, a tall one a column`() {
        assertEquals(HeroForm.Compact, heroSpec(450f).form)
        assertEquals(HeroForm.Row, heroSpec(480f).form)
        assertEquals(HeroForm.Row, heroSpec(649f).form)
        assertEquals(HeroForm.Column, heroSpec(650f).form)
    }

    @Test fun `the orb grows with the page inside each form's range`() {
        assertEquals(80f, heroSpec(450f).orb, 0f)
        assertEquals(88f, heroSpec(480f).orb, 0f)
        assertEquals(104f, heroSpec(649f).orb, 0.5f)
        assertEquals(120f, heroSpec(650f).orb, 0f)
        assertEquals(168f, heroSpec(1000f).orb, 0f)
        val mid = heroSpec(760f).orb
        assert(mid in 120f..168f) { "$mid" }
    }

    @Test fun `a column page fills its hero, minus the 100 of title and capsule`() {
        val l = heroLayout(heroSpec(800f), heroHeight = 228f)
        assertTrue(l.column)
        assertEquals(128f, l.orb, 0f)
        assertEquals(heroSpec(800f).orb, heroLayout(heroSpec(800f), heroHeight = 400f).orb, 0f)
    }

    @Test fun `a row page whose hero has the room stands up as a column, orb 120`() {
        // 393 x 640 with a one-line phrase: the hero gets ~243 dp, a 104 orb in a row left it empty
        val l = heroLayout(heroSpec(600f), heroHeight = 243f)
        assertTrue(l.column)
        assertEquals(120f, l.orb, 0f)
    }

    @Test fun `a hero too short for a 104 orb over its text lies down as a row`() {
        val l = heroLayout(heroSpec(800f), heroHeight = 196f)  // 196 − 100 = 96 < 104
        assertFalse(l.column)
        assertEquals(104f, l.orb, 0f)
        assertEquals(96f, heroLayout(heroSpec(600f), heroHeight = 96f).orb, 0f)
        assertEquals(80f, heroLayout(heroSpec(500f), heroHeight = 60f).orb, 0f)  // the floor
    }

    @Test fun `a compact page stays a compact row however tall its hero`() {
        val l = heroLayout(heroSpec(450f), heroHeight = 300f)
        assertFalse(l.column)
        assertEquals(80f, l.orb, 0f)
    }
}
