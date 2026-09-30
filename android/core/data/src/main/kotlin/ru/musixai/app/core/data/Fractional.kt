package ru.musixai.app.core.data

/** Fractional-index order keys — the same algorithm as the server's
 *  `contexts/playlists/fractional.py` (rocicorp/fractional-indexing, base-62, bytewise
 *  order), so a key made offline is the key the server stores on replay. */
object Fractional {
    private const val DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
    private const val ZERO = '0'
    private val SMALLEST_INT = "A" + "0".repeat(26)

    private fun midpoint(a: String, b: String?): String {
        require(b == null || a < b) { "$a >= $b" }
        require(!a.endsWith(ZERO) && !(b?.endsWith(ZERO) ?: false)) { "trailing zero" }
        if (!b.isNullOrEmpty()) {
            var n = 0
            while ((if (n < a.length) a[n] else ZERO) == b[n]) n++
            if (n > 0) return b.substring(0, n) + midpoint(a.substring(minOf(n, a.length)), b.substring(n))
        }
        val da = if (a.isNotEmpty()) DIGITS.indexOf(a[0]) else 0
        val db = if (b != null) DIGITS.indexOf(b[0]) else DIGITS.length
        if (db - da > 1) return DIGITS[(da + db + 1) / 2].toString()
        if (b != null && b.length > 1) return b.substring(0, 1)
        return DIGITS[da] + midpoint(if (a.isNotEmpty()) a.substring(1) else "", null)
    }

    private fun intLen(head: Char): Int = when (head) {
        in 'a'..'z' -> head - 'a' + 2
        in 'A'..'Z' -> 'Z' - head + 2
        else -> throw IllegalArgumentException("invalid order key head $head")
    }

    private fun intPart(key: String): String {
        val n = intLen(key[0])
        require(n <= key.length) { "invalid order key $key" }
        return key.substring(0, n)
    }

    private fun validate(key: String) {
        require(key != SMALLEST_INT) { "invalid order key" }
        val i = intPart(key)
        require(!key.substring(i.length).endsWith(ZERO) && key.drop(1).all { it in DIGITS }) { "invalid order key $key" }
    }

    private fun step(x: String, up: Boolean): String? {
        val head = x[0]
        val digs = x.drop(1).toMutableList()
        val (edge, reset) = if (up) DIGITS.last() to ZERO else ZERO to DIGITS.last()
        var i = digs.size - 1
        while (i >= 0 && digs[i] == edge) { digs[i] = reset; i-- }
        if (i >= 0) {
            digs[i] = DIGITS[DIGITS.indexOf(digs[i]) + if (up) 1 else -1]
            return head + digs.joinToString("")
        }
        val h: Char
        val out: List<Char>
        if (up) {
            if (head == 'Z') return "a$ZERO"
            if (head == 'z') return null
            h = head + 1
            out = if (h > 'a') digs + ZERO else digs.dropLast(1)
        } else {
            if (head == 'a') return "Z" + DIGITS.last()
            if (head == 'A') return null
            h = head - 1
            out = if (h < 'Z') digs + DIGITS.last() else digs.dropLast(1)
        }
        return h + out.joinToString("")
    }

    /** A key strictly between [a] and [b]; null = an open end. */
    fun between(a: String?, b: String?): String {
        a?.let(::validate)
        b?.let(::validate)
        require(a == null || b == null || a < b) { "$a must sort before $b" }
        if (a == null) {
            if (b == null) return "a$ZERO"
            val ib = intPart(b)
            if (ib == SMALLEST_INT) return ib + midpoint("", b.substring(ib.length))
            if (ib < b) return ib
            return step(ib, up = false) ?: error("cannot decrement any more")
        }
        val ia = intPart(a)
        val fa = a.substring(ia.length)
        if (b == null) {
            val nxt = step(ia, up = true)
            return nxt ?: (ia + midpoint(fa, null))
        }
        val ib = intPart(b)
        if (ia == ib) return ia + midpoint(fa, b.substring(ib.length))
        val nxt = step(ia, up = true) ?: error("cannot increment any more")
        return if (nxt < b) nxt else ia + midpoint(fa, null)
    }

    /** [n] ordered keys after [a] (append), each after the previous. */
    fun append(a: String?, n: Int): List<String> {
        val out = mutableListOf<String>()
        var last = a
        repeat(n) { last = between(last, null); out += last!! }
        return out
    }
}
