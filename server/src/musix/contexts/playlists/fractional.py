"""Fractional-index order keys: a port of rocicorp/fractional-indexing (D. Greenspan's
"Implementing Fractional Indexing") over base-62, compared bytewise (`COLLATE "C"`).

A key is a variable-length integer part (its head letter encodes the length: a–z
positive, A–Z negative) plus a fraction. Appends and prepends step the integer, so the
common "add to the end" stays at 2–3 chars instead of growing a digit every few inserts
the way a plain midpoint does. Moving an item rewrites only its own key."""

from __future__ import annotations

DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
_ZERO = DIGITS[0]
_SMALLEST_INT = "A" + _ZERO * 26


def _midpoint(a: str, b: str | None) -> str:
    if b is not None and a >= b:
        raise ValueError(f"{a!r} >= {b!r}")
    if a.endswith(_ZERO) or (b and b.endswith(_ZERO)):
        raise ValueError("trailing zero")
    if b:
        n = 0
        while (a[n] if n < len(a) else _ZERO) == b[n]:
            n += 1
        if n > 0:
            return b[:n] + _midpoint(a[n:], b[n:])
    da = DIGITS.index(a[0]) if a else 0
    db = DIGITS.index(b[0]) if b is not None else len(DIGITS)
    if db - da > 1:
        return DIGITS[(da + db + 1) // 2]  # JS Math.round, not banker's rounding
    if b and len(b) > 1:
        return b[:1]
    return DIGITS[da] + _midpoint(a[1:], None)


def _int_len(head: str) -> int:
    if "a" <= head <= "z":
        return ord(head) - ord("a") + 2
    if "A" <= head <= "Z":
        return ord("Z") - ord(head) + 2
    raise ValueError(f"invalid order key head {head!r}")


def _int_part(key: str) -> str:
    n = _int_len(key[0])
    if n > len(key):
        raise ValueError(f"invalid order key {key!r}")
    return key[:n]


def validate(key: str) -> None:
    if key == _SMALLEST_INT:
        raise ValueError("invalid order key")
    i = _int_part(key)
    if key[len(i) :].endswith(_ZERO) or any(c not in DIGITS for c in key[1:]):
        raise ValueError(f"invalid order key {key!r}")


def _step(x: str, up: bool) -> str | None:
    head, digs = x[0], list(x[1:])
    edge, reset = (DIGITS[-1], _ZERO) if up else (_ZERO, DIGITS[-1])
    i = len(digs) - 1
    while i >= 0 and digs[i] == edge:
        digs[i] = reset
        i -= 1
    if i >= 0:
        digs[i] = DIGITS[DIGITS.index(digs[i]) + (1 if up else -1)]
        return head + "".join(digs)
    if up:
        if head == "Z":
            return "a" + _ZERO
        if head == "z":
            return None
        h = chr(ord(head) + 1)
        digs = [*digs, _ZERO] if h > "a" else digs[:-1]
    else:
        if head == "a":
            return "Z" + DIGITS[-1]
        if head == "A":
            return None
        h = chr(ord(head) - 1)
        digs = [*digs, DIGITS[-1]] if h < "Z" else digs[:-1]
    return h + "".join(digs)


def key_between(a: str | None, b: str | None) -> str:
    """A key strictly between a and b; None = open end."""
    if a is not None:
        validate(a)
    if b is not None:
        validate(b)
    if a is not None and b is not None and a >= b:
        raise ValueError(f"{a!r} must sort before {b!r}")
    if a is None:
        if b is None:
            return "a" + _ZERO
        ib = _int_part(b)
        if ib == _SMALLEST_INT:
            return ib + _midpoint("", b[len(ib) :])
        if ib < b:
            return ib
        res = _step(ib, up=False)
        if res is None:
            raise ValueError("cannot decrement any more")
        return res
    ia = _int_part(a)
    fa = a[len(ia) :]
    if b is None:
        nxt = _step(ia, up=True)
        return ia + _midpoint(fa, None) if nxt is None else nxt
    ib = _int_part(b)
    if ia == ib:
        return ia + _midpoint(fa, b[len(ib) :])
    nxt = _step(ia, up=True)
    if nxt is None:
        raise ValueError("cannot increment any more")
    return nxt if nxt < b else ia + _midpoint(fa, None)


def keys_between(a: str | None, b: str | None, n: int) -> list[str]:
    """n ordered keys between a and b (bulk add): balanced, so a batch stays short."""
    if n <= 0:
        return []
    if n == 1:
        return [key_between(a, b)]
    if b is None:
        out = [key_between(a, None)]
        for _ in range(n - 1):
            out.append(key_between(out[-1], None))
        return out
    if a is None:
        out = [key_between(None, b)]
        for _ in range(n - 1):
            out.append(key_between(None, out[-1]))
        return out[::-1]
    mid = n // 2
    c = key_between(a, b)
    return [*keys_between(a, c, mid), c, *keys_between(c, b, n - mid - 1)]
