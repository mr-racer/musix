package ru.musixai.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ru.musixai.app.core.designsystem.MusixIcons
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.core.designsystem.brush
import ru.musixai.app.core.designsystem.component.pressable

private data class Tab(val dest: Any, val route: String, val label: String, val icon: androidx.compose.ui.graphics.vector.ImageVector)

/** Four tabs: v2 drops «Рекомендации» (program §4.3); the stats live in the library. */
private val TABS = listOf(
    Tab(HomeDest, "HomeDest", "Главная", MusixIcons.Home),
    Tab(AssistantDest, "AssistantDest", "Ассистент", MusixIcons.Assistant),
    Tab(LibraryDest, "LibraryDest", "Библиотека", MusixIcons.Library),
    Tab(QuizDest, "QuizDest", "Игра", MusixIcons.Quiz),
)

/** v1 `BottomTabBar`: five tabs on the frosted bar, the active one in the accent. */
@Composable
fun BottomTabBar(tab: kotlin.reflect.KClass<*>?, onNav: (Any) -> Unit, modifier: Modifier = Modifier) {
    val c = MusixTheme.colors
    Column(Modifier.fillMaxWidth().background(c.tabBarBg.brush(1080f, 200f))) {
        Box(Modifier.fillMaxWidth().height(1.dp).background(c.border))
        Row(modifier.fillMaxWidth().padding(top = 8.dp, bottom = 6.dp)) {
            for (t in TABS) {
                val on = t.dest::class == (tab ?: HomeDest::class)
                Column(Modifier.weight(1f).pressable { onNav(t.dest) }, horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(t.icon, t.label, Modifier.size(24.dp), tint = if (on) c.accent else c.tabBarInactive)
                    Text(t.label, Modifier.padding(top = 3.dp), maxLines = 1,
                        style = MusixTheme.type.body.copy(fontSize = 11.sp, fontWeight = if (on) FontWeight.SemiBold else FontWeight.Medium, color = if (on) c.accent else c.tabBarInactive))
                }
            }
        }
    }
}
