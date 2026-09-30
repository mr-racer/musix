package ru.musixai.app.benchmark

import androidx.benchmark.macro.CompilationMode
import androidx.benchmark.macro.FrameTimingMetric
import androidx.benchmark.macro.StartupMode
import androidx.benchmark.macro.StartupTimingMetric
import androidx.benchmark.macro.junit4.BaselineProfileRule
import androidx.benchmark.macro.junit4.MacrobenchmarkRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Spec §8: cold start to the first frame of home with data; jank scrolling the library. */
@RunWith(AndroidJUnit4::class)
class Budgets {
    @get:Rule val rule = MacrobenchmarkRule()

    @Test fun coldStart() = rule.measureRepeated(PACKAGE, listOf(StartupTimingMetric()), CompilationMode.Partial(), StartupMode.COLD, iterations = 5,
        setupBlock = { ensureSignedIn(); pressHome(); killProcess() }) { startActivityAndWait(); waitHome() }

    @Test fun libraryScroll() = rule.measureRepeated(PACKAGE, listOf(FrameTimingMetric()), CompilationMode.Partial(), iterations = 3,
        setupBlock = { ensureSignedIn() }) { scrollLibrary() }
}

/** The Baseline Profile: start, home, the library scroll (the paths a cold user takes). */
@RunWith(AndroidJUnit4::class)
class BaselineProfile {
    @get:Rule val rule = BaselineProfileRule()

    @Test fun generate() = rule.collect(PACKAGE, includeInStartupProfile = true) {
        ensureSignedIn()
        pressHome()
        startActivityAndWait()
        waitHome()
        scrollLibrary()
    }
}
