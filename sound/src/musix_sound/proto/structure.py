"""Song structure from time-synced lyrics (LRC), snapped to bar starts.

A chorus is what repeats: lines that occur again elsewhere in the lyrics (fuzzy
match) form chorus blocks, unique runs are verses, a unique run late in the song
between choruses is the bridge, long vocal pauses are instrumental breaks.
Section starts move to the nearest downbeat (beat_this) so marks land on the bar,
not on the singer's pickup. Without LRC, audio_sections() falls back to bar-level
novelty in the stems and labels parts by letter.
"""
import difflib
import re

import numpy as np

LINE = re.compile(r"\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)")


def parse_lrc(text):
    out = []
    for raw in (text or "").splitlines():
        m = LINE.match(raw.strip())
        if not m:
            continue
        t = int(m.group(1)) * 60 + float(m.group(2))
        words = m.group(3).strip()
        if words:
            out.append((t, words))
    return out


def norm(s):
    s = re.sub(r"\([^)]*\)", " ", s.lower())  # ad-libs in brackets do not make a line different
    s = re.sub(r"[^\w\s]", " ", s)
    return " ".join(s.split())


def similar(a, b):
    return a == b or (len(a) > 6 and difflib.SequenceMatcher(None, a, b).ratio() >= 0.8)


def snap(t, downbeats, tol=1.6):
    if downbeats is None or len(downbeats) == 0:
        return round(float(t), 2)
    i = int(np.argmin(np.abs(downbeats - t)))
    return round(float(downbeats[i]), 2) if abs(downbeats[i] - t) <= tol else round(float(t), 2)


def line_classes(texts):
    """Union lines that read the same (fuzzy) into one class id."""
    n = len(texts)
    parent = list(range(n))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    for i in range(n):
        for j in range(i + 1, n):
            if texts[i] and similar(texts[i], texts[j]):
                parent[find(j)] = find(i)
    return [find(i) for i in range(n)]


def repeated_blocks(cls, min_len=2):
    """Greedy longest-first: [(group, [start indexes], length)], occurrences never overlap."""
    n = len(cls)
    owner = [None] * n
    groups = []
    for L in range(n // 2, min_len - 1, -1):
        for i in range(n - L + 1):
            if any(o is not None for o in owner[i:i + L]):
                continue
            pat = cls[i:i + L]
            if len(set(pat)) == 1 and L > 2:
                continue  # one line sung many times is a hook, found at a shorter length
            occ, j = [], 0
            while j <= n - L:
                if cls[j:j + L] == pat and all(o is None for o in owner[j:j + L]):
                    occ.append(j)
                    j += L
                else:
                    j += 1
            if len(occ) >= 2:
                g = len(groups)
                for o in occ:
                    for k in range(o, o + L):
                        owner[k] = g
                groups.append((g, occ, L))
    return groups, owner


def lrc_sections(lines, dur, downbeats=None, gap=8.0):
    """[{start, end, kind, label}], kind in intro/verse/chorus/bridge/hook/break/outro."""
    if len(lines) < 4:
        return []
    times = [t for t, _ in lines]
    texts = [norm(w) for _, w in lines]
    groups, owner = repeated_blocks(line_classes(texts))
    n = len(lines)
    span = lambda a, b: times[b] - times[a] + 2.5  # noqa: E731
    cover = {g: sum(span(o, o + L - 1) for o in occ) for g, occ, L in groups}
    chorus = max(cover, key=cover.get) if cover else None
    # runs of lines with the same owner (None = unique lyrics)
    runs = []
    for i in range(n):
        if runs and owner[i] == runs[-1][2] and times[i] - times[i - 1] <= gap:
            runs[-1][1] = i
        else:
            runs.append([i, i, owner[i]])
    # short unique bits (an intro line, a "take this, haters!") join the next run
    merged = []
    for r in runs:
        if merged and merged[-1][2] is None and (merged[-1][1] - merged[-1][0] < 3 and span(merged[-1][0], merged[-1][1]) < 12) \
                and times[r[0]] - times[merged[-1][1]] <= gap:
            r = [merged[-1][0], r[1], r[2]]
            merged.pop()
        if merged and r[2] is None and (r[1] - r[0] < 3 and span(r[0], r[1]) < 12) and times[r[0]] - times[merged[-1][1]] <= gap:
            merged[-1][1] = r[1]
            continue
        merged.append(r)
    # a short repeated tail/head glued to a chorus (a slightly different last line) is the chorus too
    for k, r in enumerate(merged):
        if r[2] not in (None, chorus) and span(r[0], r[1]) < 9:
            near = [merged[j][2] for j in (k - 1, k + 1) if 0 <= j < len(merged)]
            if chorus in near:
                r[2] = chorus
    first_ch = next((k for k, r in enumerate(merged) if r[2] == chorus), None)
    last_ch = max((k for k, r in enumerate(merged) if r[2] == chorus), default=None)
    sec = []
    if times[0] > 6:
        sec.append([0.0, times[0], "intro"])
    med = float(np.median(np.diff(times))) if n > 1 else 3.0
    for k, (a, b, g) in enumerate(merged):
        start, last = times[a], times[b]
        nxt = times[merged[k + 1][0]] if k + 1 < len(merged) else None
        end = nxt if nxt is not None and nxt - last <= gap else last + min(6.0, 1.5 * med)
        if g is None:
            kind = "verse"
        elif g == chorus:
            kind = "chorus"
        elif first_ch is not None and k > first_ch and (last_ch is None or k < last_ch):
            kind = "bridge"
        elif last_ch is not None and k > last_ch:
            kind = "outro_hook"
        else:
            kind = "hook"
        sec.append([start, end, kind])
        if nxt is not None and nxt - end > 2:
            sec.append([end, nxt, "break"])
    if dur - sec[-1][1] > 8:
        sec.append([sec[-1][1], dur, "outro"])
    else:
        sec[-1][1] = dur
    # neighbours of the same kind are one section
    joined = []
    for s in sec:
        if joined and joined[-1][2] == s[2] and s[2] != "verse":
            joined[-1][1] = s[1]
        else:
            joined.append(s)
    # anything under 8 s (except a break or the intro) belongs to the section before it
    tidy = []
    for s in joined:
        if tidy and s[1] - s[0] < 8 and s[2] not in ("break", "intro", "outro"):
            tidy[-1][1] = s[1]
        elif tidy and tidy[-1][2] == s[2] and s[2] != "verse":
            tidy[-1][1] = s[1]
        else:
            tidy.append(s)
    joined = tidy
    for s in joined:
        s[0] = snap(s[0], downbeats)
    for i in range(len(joined) - 1):
        joined[i][1] = joined[i + 1][0]
    return label([s for s in joined if s[1] - s[0] >= 2])


def label(sec):
    names = {"intro": "вступление", "verse": "куплет", "chorus": "припев", "bridge": "бридж",
             "hook": "хук", "outro_hook": "концовка: хук", "break": "проигрыш", "outro": "концовка",
             "part": "часть"}
    nverse = 0
    out = []
    n_ch = sum(1 for s in sec if s[2] == "chorus")
    seen_ch = 0
    for s in sec:
        lab = names[s[2]]
        if s[2] == "verse":
            nverse += 1
            lab = f"куплет {nverse}"
        elif s[2] == "chorus":
            seen_ch += 1
            lab = "последний припев" if n_ch >= 3 and seen_ch == n_ch else "припев"
        elif s[2] == "part":
            lab = s[3]
        out.append(dict(start=round(float(s[0]), 2), end=round(float(s[1]), 2), kind=s[2], label=lab))
    return out


def audio_sections(feats, downbeats, dur, min_bars=4):
    """Fallback without lyrics: bar-level novelty over stem energies + chroma, parts lettered by similarity.

    feats: (n_bars, d) features, one row per bar (bar i spans downbeats[i]..downbeats[i+1]).
    """
    n = len(feats)
    if n < 2 * min_bars:
        return [dict(start=0.0, end=dur, kind="part", label="часть A")]
    f = (feats - feats.mean(0)) / (feats.std(0) + 1e-6)
    nov = np.zeros(n)
    w = min_bars
    for i in range(w, n - w):
        nov[i] = np.linalg.norm(f[i - w:i].mean(0) - f[i:i + w].mean(0))
    cuts = [0]
    for i in np.argsort(-nov):
        if nov[i] < np.percentile(nov[w:n - w], 75):
            break
        if all(abs(i - c) >= min_bars for c in cuts):
            cuts.append(int(i))
    cuts = sorted(cuts) + [n]
    segs = [(cuts[k], cuts[k + 1]) for k in range(len(cuts) - 1)]
    means = [f[a:b].mean(0) for a, b in segs]
    letters, protos = [], []
    for m in means:
        d = [np.linalg.norm(m - p) for p in protos]
        if d and min(d) < 0.9 * np.sqrt(f.shape[1]) * 0.5:
            letters.append("ABCDEFGH"[int(np.argmin(d))])
        else:
            protos.append(m)
            letters.append("ABCDEFGH"[min(len(protos) - 1, 7)])
    sec = []
    for (a, b), let in zip(segs, letters):
        start = float(downbeats[a]) if a < len(downbeats) else dur
        end = float(downbeats[b]) if b < len(downbeats) else dur
        sec.append([start, end, "part", f"часть {let}"])
    sec[0][0] = 0.0
    sec[-1][1] = dur
    return label(sec)
