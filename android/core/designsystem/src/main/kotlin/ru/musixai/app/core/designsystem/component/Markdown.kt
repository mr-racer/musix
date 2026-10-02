package ru.musixai.app.core.designsystem.component

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import ru.musixai.app.core.designsystem.MusixFontFamilies
import ru.musixai.app.core.designsystem.MusixTheme

/**
 * The LLM's markdown for the chat bubbles and the assistant's answers. It renders
 * paragraphs, `-`/`*`/`1.` lists, `>` quotes, `#` headings, *italic*, `code`,
 * [links](…) and ``` blocks.
 * - Bold is drawn as plain text even when the model writes it: the owner's rule
 *   (2026-10-02). Headings get a medium weight, not bold.
 * - It is built for text that is still arriving: an unclosed marker (`**bo`, `` `co ``)
 *   shows as plain text, never as stray symbols.
 * - [inline] lets a caller handle its own tokens (the assistant's `[n]` citation pills):
 *   given a run of plain text, it appends it to the builder and returns true when done.
 */
@Composable
fun Markdown(
    text: String,
    style: TextStyle,
    modifier: Modifier = Modifier,
    inline: ((AnnotatedString.Builder, String) -> Boolean)? = null,
) {
    val c = MusixTheme.colors
    val blocks = remember(text) { parseBlocks(text) }
    val link = TextLinkStyles(SpanStyle(color = c.accentLight, textDecoration = TextDecoration.Underline))
    val code = SpanStyle(fontFamily = MusixFontFamilies.Mono, fontSize = style.fontSize * 0.9f, background = Color(0x1F8080A0))
    fun line(s: String): AnnotatedString = inlineMarkdown(s, link, code, inline)
    Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        for (b in blocks) when (b) {
            is Block.Para -> Text(line(b.text), style = style)
            is Block.Heading -> Text(line(b.text), style = style.copy(fontWeight = FontWeight.Medium, fontSize = style.fontSize * (if (b.level <= 2) 1.12f else 1.04f)))
            is Block.Items -> Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                b.items.forEachIndexed { i, item ->
                    Row {
                        Text(if (b.ordered) "${b.start + i}." else "•", Modifier.widthIn(min = 18.dp).padding(end = 6.dp), style = style.copy(color = c.textMuted))
                        Text(line(item), style = style)
                    }
                }
            }
            is Block.Quote -> Row(Modifier.height(IntrinsicSize.Min)) {
                Box(Modifier.width(2.dp).fillMaxHeight().clip(RoundedCornerShape(1.dp)).background(c.accentLight.copy(alpha = 0.6f)))
                Text(line(b.text), Modifier.padding(start = 10.dp), style = style.copy(fontStyle = FontStyle.Italic, color = c.textMuted))
            }
            is Block.Code -> Text(b.text, Modifier.clip(RoundedCornerShape(8.dp)).background(Color(0x148080A0)).padding(horizontal = 10.dp, vertical = 8.dp),
                style = style.copy(fontFamily = MusixFontFamilies.Mono, fontSize = style.fontSize * 0.9f, lineHeight = 1.4.em))
        }
    }
}

private sealed interface Block {
    data class Para(val text: String) : Block
    data class Heading(val level: Int, val text: String) : Block
    data class Items(val ordered: Boolean, val start: Int, val items: List<String>) : Block
    data class Quote(val text: String) : Block
    data class Code(val text: String) : Block
}

private val BULLET = Regex("""^\s*[-*+•]\s+(.*)$""")
private val NUMBER = Regex("""^\s*(\d{1,3})[.)]\s+(.*)$""")
private val HEADING = Regex("""^\s*(#{1,6})\s+(.*)$""")

private fun parseBlocks(src: String): List<Block> {
    val out = mutableListOf<Block>()
    val para = mutableListOf<String>()
    fun flush() { if (para.isNotEmpty()) { out += Block.Para(para.joinToString("\n")); para.clear() } }
    val lines = src.replace("\r", "").trim().lines()
    var i = 0
    while (i < lines.size) {
        val l = lines[i]
        when {
            l.trimStart().startsWith("```") -> {
                flush()
                val body = mutableListOf<String>()
                i++
                while (i < lines.size && !lines[i].trimStart().startsWith("```")) body += lines[i++]
                out += Block.Code(body.joinToString("\n"))  // an unclosed fence while streaming still shows
            }
            l.isBlank() -> flush()
            HEADING.matches(l) -> { flush(); HEADING.find(l)!!.let { out += Block.Heading(it.groupValues[1].length, it.groupValues[2].trim().trimEnd('#').trim()) } }
            l.trimStart().startsWith(">") -> {
                flush()
                val q = mutableListOf<String>()
                while (i < lines.size && lines[i].trimStart().startsWith(">")) q += lines[i++].trimStart().removePrefix(">").trimStart()
                out += Block.Quote(q.joinToString("\n"))
                continue
            }
            BULLET.matches(l) || NUMBER.matches(l) -> {
                flush()
                val ordered = NUMBER.matches(l)
                val start = if (ordered) NUMBER.find(l)!!.groupValues[1].toInt() else 1
                val items = mutableListOf<String>()
                while (i < lines.size) {
                    val m = (if (ordered) NUMBER else BULLET).find(lines[i])
                    when {
                        m != null -> items += m.groupValues.last().trim()
                        lines[i].isNotBlank() && lines[i].startsWith("  ") && items.isNotEmpty() -> items[items.lastIndex] = items.last() + " " + lines[i].trim()
                        else -> break
                    }
                    i++
                }
                out += Block.Items(ordered, start, items)
                continue
            }
            else -> para += l.trimEnd()
        }
        i++
    }
    flush()
    return out
}

// bold (dropped to plain), italic, code, links — the first alternative that matches wins
private val INLINE = Regex("""\*\*(.+?)\*\*|__(.+?)__|`([^`]+)`|\[([^\]]+)]\((https?://[^)\s]+)\)|(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?!\w)|(?<![\w_])_(?!\s)(.+?)(?<!\s)_(?!\w)""")

private fun inlineMarkdown(s: String, link: TextLinkStyles, code: SpanStyle, inline: ((AnnotatedString.Builder, String) -> Boolean)?): AnnotatedString = buildAnnotatedString {
    fun plain(t: String) {
        // what is left of a marker that has not closed yet (the text is still streaming)
        val clean = t.replace("**", "").replace("__", "")
        if (inline == null || !inline(this, clean)) append(clean)
    }
    var i = 0
    for (m in INLINE.findAll(s)) {
        plain(s.substring(i, m.range.first))
        val g = m.groupValues
        when {
            g[1].isNotEmpty() -> plain(g[1])
            g[2].isNotEmpty() -> plain(g[2])
            g[3].isNotEmpty() -> withStyle(code) { append(g[3]) }
            g[4].isNotEmpty() -> withLink(LinkAnnotation.Url(g[5], link)) { append(g[4]) }
            g[6].isNotEmpty() -> withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { plain(g[6]) }
            g[7].isNotEmpty() -> withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { plain(g[7]) }
        }
        i = m.range.last + 1
    }
    plain(s.substring(i))
}
