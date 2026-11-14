package ru.musixai.app.core.designsystem

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.unit.dp
import com.github.takahirom.roborazzi.captureRoboImage
import org.junit.Test
import org.junit.Rule
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import ru.musixai.app.core.designsystem.BrandMark
import ru.musixai.app.core.designsystem.content.Cover
import ru.musixai.app.core.designsystem.legacy.CtaButton
import ru.musixai.app.core.designsystem.content.Empty
import ru.musixai.app.core.designsystem.legacy.Eyebrow
import ru.musixai.app.core.designsystem.surface.LiquidGlass
import ru.musixai.app.core.designsystem.surface.GlassScene
import ru.musixai.app.core.designsystem.content.MosaicCover
import ru.musixai.app.core.designsystem.legacy.MusixField
import ru.musixai.app.core.designsystem.legacy.SegmentOption
import ru.musixai.app.core.designsystem.legacy.Segmented
import ru.musixai.app.core.designsystem.content.Skel
import ru.musixai.app.core.designsystem.content.Spinner
import ru.musixai.app.core.designsystem.legacy.TabPair
import ru.musixai.app.core.designsystem.legacy.ToggleSwitch

/** The component gallery in both themes, for review against design/golden (not an assertion). */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "w411dp-h891dp-xxhdpi")
class GalleryScreenshots {
    @get:Rule val compose = createComposeRule()

    // Freeze the clock so the spinner and skeleton cannot keep the screenshot's
    // main looper busy indefinitely, especially on the second theme in one JVM.
    private fun capture(dark: Boolean, file: String) {
        compose.mainClock.autoAdvance = false
        compose.setContent { Gallery(dark) }
        compose.mainClock.advanceTimeBy(500)
        compose.onRoot().captureRoboImage(file)
    }

    @Test fun dark() = capture(true, "build/outputs/roborazzi/gallery-dark.png")
    @Test fun light() = capture(false, "build/outputs/roborazzi/gallery-light.png")
}

@Composable
private fun Gallery(dark: Boolean) = MusixTheme(dark) {
    val c = MusixTheme.colors
    Column(Modifier.width(411.dp).background(c.bg).padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) { BrandMark(46.dp); Eyebrow("Твой вайб", Modifier.padding(top = 16.dp)) }
        Text("Электронный пульс и соул-темп", style = MusixTheme.type.title.copy(color = c.text))
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Cover(null, "Группа крови", "Кино", size = 56.dp)
            Cover(null, "Мракобесие и джаз", "Агата Кристи", size = 56.dp)
            MosaicCover(emptyList(), size = 56.dp)
            MosaicCover(listOf(null, null, null), size = 56.dp)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            ToggleSwitch(true, {}); ToggleSwitch(false, {}); Spinner(20.dp)
        }
        Segmented("albums", listOf(SegmentOption("albums", "Альбомы"), SegmentOption("recent", "Недавние"), SegmentOption("stats", "Статистика")), {})
        TabPair(listOf("Песня", "Артист"), 0, {})
        GlassScene(Modifier.fillMaxWidth(), background = {
            Canvas(Modifier.matchParentSize()) {
                drawRect(c.bg)
                drawCircle(Color(0xFF805EA5), size.height * .48f, Offset(size.width * .18f, size.height * .65f))
                drawCircle(Color(0xFF45808B), size.height * .38f, Offset(size.width * .8f, size.height * .25f))
            }
        }) {
            LiquidGlass(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    MusixField("", {}, "строчка из песни…")
                    CtaButton("Войти", {}, Modifier.fillMaxWidth())
                }
            }
        }
        Skel(Modifier.fillMaxWidth().size(height = 46.dp, width = 300.dp), 12.dp)
        Empty()
    }
}
