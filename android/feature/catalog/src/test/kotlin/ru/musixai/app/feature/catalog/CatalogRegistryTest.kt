package ru.musixai.app.feature.catalog

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class CatalogRegistryTest {
    @Test fun everyComponentEarnsItsPlace() {
        // the rule itself turns a one-screen look away…
        assertFalse(CatalogEntry("x", "x", Layer.Control, listOf(Screen.Home, Screen.Home), "", "") {}.earnsItsPlace())
        // …and nothing in the catalog is one
        assertEquals(emptyList<String>(), CATALOG.filterNot { it.earnsItsPlace() }.map { it.id })
    }

    @Test fun idsAreUnique() {
        assertEquals(emptyList<String>(), CATALOG.groupBy { it.id }.filterValues { it.size > 1 }.keys.toList())
    }
}
