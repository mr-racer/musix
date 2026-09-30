package ru.musixai.app.benchmark

import androidx.benchmark.macro.MacrobenchmarkScope
import androidx.test.uiautomator.By
import androidx.test.uiautomator.Direction
import androidx.test.uiautomator.Until

const val PACKAGE = "ru.musixai.app"  // the plugin's benchmarkRelease / nonMinifiedRelease keep the release id

/** Server and dev login for the bench build (instrumentation args, never hard-coded secrets:
 *  the dev account is tools/android/dev_account.sh's). */
private fun arg(name: String, default: String) =
    androidx.test.platform.app.InstrumentationRegistry.getArguments().getString(name) ?: default

/** Waits for [text] and taps it; Compose may recompose between the wait and the find. */
private fun MacrobenchmarkScope.tap(text: String, last: Boolean = false, timeout: Long = 5_000) {
    val end = System.currentTimeMillis() + timeout
    while (System.currentTimeMillis() < end) {
        val hits = device.findObjects(By.text(text))
        val o = if (last) hits.lastOrNull() else hits.firstOrNull()
        if (o != null) runCatching { o.click(); return }
        Thread.sleep(200)
    }
    error("not on screen: $text")
}

private fun MacrobenchmarkScope.type(index: Int, value: String) {
    device.wait(Until.hasObject(By.clazz("android.widget.EditText")), 5_000)
    device.findObjects(By.clazz("android.widget.EditText"))[index].text = value
}

/** Logs in once when the login screen shows (the data dir survives cold starts). */
fun MacrobenchmarkScope.ensureSignedIn() {
    startActivityAndWait()
    if (device.wait(Until.hasObject(By.text("Сменить")), 4_000) != true) return
    tap("Сменить")
    device.wait(Until.hasObject(By.text("Подключиться")), 5_000)
    type(0, arg("server", "http://127.0.0.1:18010"))
    tap("Подключиться")
    device.wait(Until.hasObject(By.text("Сменить")), 5_000)
    type(0, arg("email", "mig-owner@example.com"))
    type(1, arg("password", "mig-pass-123"))
    tap("Войти", last = true)
    device.wait(Until.hasObject(By.text("ТВОЙ ВАЙБ")), 30_000)
}

fun MacrobenchmarkScope.waitHome() { device.wait(Until.hasObject(By.text("ТВОЙ ВАЙБ")), 10_000) }

fun MacrobenchmarkScope.scrollLibrary() {
    device.findObject(By.text("Библиотека"))?.click()
    device.wait(Until.hasObject(By.textContains("альбомов")), 10_000)
    val grid = device.findObject(By.scrollable(true)) ?: return
    grid.setGestureMargin(device.displayWidth / 5)
    repeat(6) { grid.fling(Direction.DOWN) }
    repeat(3) { grid.fling(Direction.UP) }
}
