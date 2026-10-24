"""LLM texts about the sound (spec §9): code builds the facts, the LLM writes drafts, a judge
picks one, an editor pass rewrites it against the facts, code applies only the owner's
explicit lines. A text is saved only when every step passes; otherwise the row says `none`
(no strong fact) or `rejected`, and nothing is generated again until the facts change.

The song «изюминка» is demo4/signature6.py + textpass.py as the owner last reviewed them
(2026-10-18): sound only, no names or titles, no timecodes, never "the beat drops"; what is
rare for the genre is the trick, and that rarity is marked by code from the Genius tags.
Not ported: the Genius description sentences (prod keeps the page's facts, not its text)."""

from __future__ import annotations

import hashlib
import json
import logging
import re
from typing import Any

from musix.contexts.sound import derive as D
from musix.infra.llm import Llm, strip_fences

log = logging.getLogger("musix.sound")
NO_THINK = {"chat_template_kwargs": {"enable_thinking": False}}
SIGNATURE_VER = 1  # part of facts_hash: a prompt change regenerates

# ── facts ─────────────────────────────────────────────────────────────────────

STRING_ROLES = (
    "Cello",
    "Violin",
    "Viola",
    "Strings",
    "Strings Arranger",
    "Orchestra Arranger",
    "Conductor",
    "Cello Arranger",
)
BRASS_ROLES = (
    "Trumpet",
    "Trombone",
    "French Horn",
    "Brass",
    "Horns Arranger",
    "Saxophone",
    "Woodwind",
    "Flute",
)
CROWD = re.compile(r"толпа|крики толпы|аплодисменты")
GENRE_WORDS = {
    "хип-хоп": {"rap", "hip-hop", "hip", "trap"},
    "рок": {"rock", "punk", "metal", "grunge"},
    "электроника": {"house", "edm", "techno", "electronic", "electronica", "trance"},
    "поп": {"pop"},
}
FORM_RU = {
    "no_chorus": "нет припева",
    "sharp_turn": "резкий поворот посреди песни",
    "tempo_change": "меняется темп",
    "many_parts": "много разных частей",
}
EXTREMES_RU = {
    "very_wide": "очень широкая сцена",
    "near_mono": "почти моно",
    "bone_dry": "совсем сухо",
    "drowned_in_echo": "всё тонет в эхе",
    "sparse": "почти пустая аранжировка",
    "sharp_dynamics": "резкие перепады громкости",
    "voice_in_echo": "голос в сильном эхе",
    "bare_808": "голый 808 под голос",
}


def where(t: float, dur: float) -> str:
    x = t / max(dur, 1)
    return (
        "в самом начале"
        if x < 0.08
        else "в начале"
        if x < 0.25
        else "в середине"
        if x < 0.65
        else "ближе к концу"
        if x < 0.9
        else "в самом конце"
    )


def how_long(sec: float) -> str:
    return (
        "почти минуту"
        if sec < 55
        else "целую минуту"
        if sec < 70
        else "больше минуты"
        if sec < 85
        else "почти полторы минуты"
        if sec < 100
        else "около двух минут"
        if sec < 135
        else "больше двух минут"
    )


def genre(tags: list[str]) -> str:
    """The genre by a vote of the Genius tags, whole words: «Electronic Trap» is not rap
    (Billie Eilish came out hip-hop by a substring), Fall Out Boy's rock tags outvote one
    «Rap» for the featured rapper."""
    votes = dict.fromkeys(GENRE_WORDS, 0)
    for t in tags:
        words = set(
            re.split(r"[\s/]+", t.lower().replace("-pop", " pop").replace("-punk", " punk"))
        )
        for k, ws in GENRE_WORDS.items():
            if words & ws and not (k == "хип-хоп" and words == {"electronic", "trap"}):
                votes[k] += 1
    best = max(votes, key=lambda k: votes[k])
    return best if votes[best] else ""


def credit_people(g: D.Genius) -> dict[str, list[str]]:
    """The credits that put a sound on the record (features5's credit_people)."""
    return {
        r: v
        for r, v in g.credits.items()
        if any(re.search(rx, (r or "").lower()) for rx, _ in D.CREDIT_FAMILY)
        and not (r or "").lower().startswith("video")
    }


def signature_facts(f: dict[str, Any], g: D.Genius) -> list[tuple[str, str]]:
    """(kind, text), the four most distinctive, or [] when nothing is distinctive enough:
    no phrase rather than a recap of traits (17 of 57 demo tracks had none)."""
    out: list[tuple[int, str, str]] = []
    why = f["scales"]["odd"]["why"]
    dur = f["dur"]
    gen = genre(g.tags)

    def rare(what: tuple[str, ...]) -> str:
        return f" (для жанра «{gen}» это редкость)" if gen in what else ""

    cp = credit_people(g)
    for o in why.get("odd", [])[:2]:  # an unusual sound with its place; a crowd is rare anywhere
        name = D.ODD_RU.get(o["cls"], o["cls"])
        crowd = bool(CROWD.search(name))
        out.append(
            (
                10 if crowd else 9,
                "необычный звук",
                f"{where(o['t'], dur)} в миксе слышно: {name}"
                + (" (в студийной записи это редкость)" if crowd else ""),
            )
        )
    for form in why.get("form", []):
        if form == "late_beat":
            t0 = why["first_beat"]
            names = f.get("names") or {}
            ru = {
                "vocals": "голос",
                "bass": "бас",
                "guitar": names.get("guitar"),
                "piano": names.get("piano"),
                "other": names.get("other"),
            }
            before = [
                ru[ln["stem"]]
                for ln in f["lane_list"]
                if ln["stem"] in ru
                and ru[ln["stem"]]
                and any(a < t0 - 5 and b - a >= 4 for a, b in ln["segs"])
            ]
            alone = [str(x) for x in dict.fromkeys(before) if x != "синты и прочее"]
            out.append(
                (
                    10,
                    "форма",
                    f"{how_long(t0)} бита нет совсем"
                    + (f" — звучат только: {', '.join(alone)}" if alone else "")
                    + "; потом вступает бит",
                )
            )
        elif form != "many_parts":
            out.append((6, "форма", FORM_RU[form]))
    strings = [r for r in STRING_ROLES if cp.get(r)]
    if strings:
        n_vln = len(cp.get("Violin") or [])
        parts = (
            (["виолончель"] if cp.get("Cello") else [])
            + ([f"скрипки ({n_vln})" if n_vln > 1 else "скрипка"] if n_vln else [])
            + (["альт"] if cp.get("Viola") else [])
        )
        arr = (
            any(r in cp for r in ("Strings Arranger", "Orchestra Arranger", "Conductor"))
            or n_vln >= 3
        )
        txt = ("оркестровая аранжировка струнных" if arr else "живые струнные") + (
            f": {', '.join(parts)}" if parts else ""
        )
        # an orchestra in hip-hop is the trick (owner ✓); one cello under a wall of sound is not
        out.append(
            (
                (9 if gen in ("хип-хоп", "рок") else 7) if arr else 5,
                "состав записи",
                txt + (rare(("хип-хоп", "рок")) if arr else ""),
            )
        )
    if any(cp.get(r) for r in BRASS_ROLES):
        out.append(
            (
                8 if gen in ("хип-хоп", "рок") else 6,
                "состав записи",
                "живые духовые (трубы, валторны)" + rare(("хип-хоп", "рок")),
            )
        )
    backing = {n for r in ("Additional Vocals", "Background Vocals") for n in (cp.get(r) or [])}
    claps = cp.get("Handclaps") or []
    if len(claps) >= 3:
        out.append((7, "состав записи", f"живые хлопки: хлопают {len(claps)} человека"))
    if cp.get("Scratches") or cp.get("Turntables"):
        out.append((7, "состав записи", "скретчи диджея"))
    if g.credits.get("Vocal Samples"):
        out.append((5, "семпл", "чужой голос из семпла"))
    elif g.samples:
        out.append((4, "семпл", "в треке есть семпл"))
    fill = f["scales"]["tech"]["raw"]["fill"]
    if fill is not None and fill >= 0.36:
        # what the wall is made of, where the credits say; for rock a wall of guitars is the norm
        parts = (
            ([f"живые хлопки ({len(claps)} человека)"] if len(claps) >= 3 else [])
            + ([f"бэк-вокал ({len(backing)} человека)"] if len(backing) >= 3 else [])
            + (["чужой голос из семпла"] if g.credits.get("Vocal Samples") else [])
        )
        out.append(
            (
                6 if gen == "рок" else 9,
                "плотность",
                "очень плотный звук: частоты заняты почти сплошь, как стена"
                + (f"; в этой стене: {', '.join(parts)}" if parts else ""),
            )
        )
    if fill is not None and fill <= 0.12:
        out.append((8, "плотность", "очень разреженный звук: между партиями много пустого места"))
    # traits only where the naming was calibrated; the bass type never was, so it is just «бас»
    tr = [
        ("бас" if t in ("808-бас", "синт-бас", "бас-гитара") else t)
        for t in f["traits"]
        if "эх" not in t and "сух" not in t
    ]
    for e in why.get("extremes", []):
        said = EXTREMES_RU[e]
        extra = (
            f" ({', '.join(x for x in tr if x in ('живые барабаны', 'гитара', 'бас-гитара'))})"
            if e == "very_wide" and any(x in tr for x in ("живые барабаны", "гитара"))
            else ""
        )
        out.append((7, "сведение", said + extra))
    if tr:
        out.append((1, "черты", ", ".join(tr)))
    out.sort(key=lambda r: -r[0])
    if not out or out[0][0] < 7:
        return []
    return [(k, t) for _, k, t in out[:4]]


# ── the LLM passes ───────────────────────────────────────────────────────────

RULES = (
    "Напиши по-русски одну фразу (до 28 слов) о том, что особенного в ЗВУКЕ этой песни, — так, "
    "как сказал бы "
    "знакомый меломан: коротко, живо, обычным языком. Это утверждение о самом звуке, не совет. "
    "Возьми ОДНУ главную "
    "деталь (первую в списке; можно связать со второй) и скажи, что слышно и почему это "
    "особенное. Если в факте "
    "сказано, что для жанра это редкость, — обыграй это.\n"
    "Строго нельзя: имена людей и групп, названия песен и семплов, любые латинские слова; время "
    "в формате м:сс "
    "(говори «в начале», «в середине», «ближе к концу»); про то, что бит или партия пропадает, "
    "обрывается или "
    "замолкает; «Слушай», «Послушай», «Обрати внимание», «В наушниках», «В треке», «Здесь»; «это "
    "не просто …, а …», "
    "«прорастает», «переплетаются», «тонет», «растворяется», «создаёт», «атмосфера», "
    "«уникальный», восклицания. "
    "Про эхо и сухость — только если это отдельный факт. «Редкость для жанра» — только если это "
    "написано в факте, и "
    "только про тот факт. 808 пиши цифрами.\n"
    "Грамматика и согласование родов безупречны. Используй ТОЛЬКО факты ниже, ничего не добавляй.\n"
    "Образцы тона (бери манеру, не слова):\n"
    "«Почти полторы минуты звучат только голос и пианино, и бит после этой тишины ощущается как "
    "удар.»\n"
    "«Струнные звучат плотным слоем: виолончель и шесть скрипок сливаются в одно целое.»\n"
    "«С первых секунд слышен живой гул толпы — для студийной записи редкость.»\n"
    'Ответ — только JSON: {"phrase": "..."}'
)
JUDGE = (
    "Ниже факты о звуке песни и варианты одной фразы про её изюминку. Выбери лучший: он точно "
    "опирается на факты, "
    "ничего не выдумывает, звучит живо и по-человечески, а не как отчёт, и говорит о том, что в "
    "звуке действительно "
    "особенное. Если все варианты скучные, канцелярские или неточные — ответь -1. "
    'Ответ — только JSON: {"best": номер_варианта_с_0_или_-1}'
)
EDITOR = (
    "Ты редактор коротких текстов о звуке музыки для внимательных слушателей. Ниже факты и "
    "черновик. Перепиши "
    "черновик, сохранив смысл и примерную длину:\n"
    "- убери всё, чего нет в фактах: имена, названия, инструменты, сравнения с другими записями, "
    "события, время;\n"
    "- не придумывай связей между фактами: «A, поэтому B» или «редкость для трека с A» — только "
    "если так сказано в "
    "фактах;\n"
    "- образные сравнения, которые не добавляют фактов («как удар», «как стена», «будто в одной "
    "комнате»), оставь: "
    "они делают текст живым;\n"
    "- исправь грамматику, согласование и слова, которых нет в русском языке;\n"
    "- убери штампы и обороты, по которым видно нейросеть («создаёт атмосферу», «это не просто…, "
    "а…», «звучание "
    "альбома», «бросается в глаза», «переплетаются», «растворяется», «прорастает», "
    "«характеризуется»), канцелярит "
    "и повторы;\n"
    "- пусть звучит живо и просто, как рассказ знакомого меломана, без восклицаний.\n"
    "{extra}"
    'Ответ — только JSON: {{"text": "..."}}'
)
SIGNATURE_EDIT = (
    "Это одна фраза. Без имён, названий и латиницы; без таймкодов (говори «в начале», «в "
    "середине», «ближе к "
    "концу»); не говори, что бит или партия пропадает или замолкает; «редкость для жанра» — "
    "только если это есть "
    "в фактах; 808 — цифрами."
)


def check_signature(phrase: str) -> list[str]:
    """Only the owner's explicit lines; wording and claims beyond the facts are the editor's."""
    problems = []
    if re.search(r"[A-Za-z]{2,}", phrase):
        problems.append("имена и названия нельзя")
    if re.search(r"\b\d{1,2}:\d\d\b", phrase):
        problems.append("таймкод")
    return problems


async def _json(llm: Llm, prompt: str, key: str, kind: str, temperature: float, cache: bool) -> Any:
    raw = await llm.ask(
        prompt, kind=kind, temperature=temperature, extra_body=NO_THINK, cache=cache
    )
    raw = strip_fences(raw)
    return json.loads(raw[raw.index("{") : raw.rindex("}") + 1])[key]


async def edit(llm: Llm, facts_text: str, draft: str, extra: str = "") -> str:
    """The draft edited against the facts; the draft itself if the editor fails or wanders."""
    prompt = EDITOR.format(extra=(extra.strip() + "\n") if extra else "") + (
        f"\n\nФакты:\n{facts_text}\n\nЧерновик:\n{draft}"
    )
    try:
        out = str(await _json(llm, prompt, "text", "sound_edit", 0.2, True)).strip()
    except Exception:
        log.warning("sound editor pass failed", exc_info=True)
        return draft
    return out if 0.5 < len(out) / max(1, len(draft)) < 1.6 else draft


def facts_hash(facts: Any, ver: int) -> str:
    return hashlib.sha256(json.dumps([ver, facts], ensure_ascii=False).encode()).hexdigest()[:32]


async def signature(llm: Llm, fl: list[tuple[str, str]], used: list[str]) -> tuple[str, str | None]:
    """(state, text): ok + the phrase, none (no strong fact), rejected (nothing passed)."""
    if not fl:
        return "none", None
    lines = "\n".join(f"{i + 1}. [{k}] {t}" for i, (k, t) in enumerate(fl))
    avoid = (
        ("\nУ других песен фразы начинались так — начни иначе: " + " | ".join(used[-12:]))
        if used
        else ""
    )
    prompt = f"{RULES}{avoid}\n\nФакты о звуке песни:\n{lines}"
    tries: list[tuple[str, list[str]]] = []
    good: list[str] = []
    for i in range(5):  # three candidates that pass the checks, five attempts at most
        if len(good) >= 3:
            break
        hint = (
            ("\n\nПрошлый вариант отклонён: " + "; ".join(tries[-1][1]) + ". Исправь.")
            if tries and i >= 3
            else ""
        )
        try:
            phrase = str(
                await _json(llm, prompt + hint, "phrase", "sound_signature", 0.85, False)
            ).strip()
        except (ValueError, KeyError) as e:  # bad JSON; an unreachable LLM raises Unavailable
            tries.append(("", [f"ошибка: {e}"]))
            continue
        bad = check_signature(phrase)
        if bad:
            tries.append((phrase, bad))
        elif phrase not in good:
            good.append(phrase)
    if not good:
        return "rejected", None  # no phrase beats a bad one
    best = 0
    if len(good) > 1:
        facts_lines = "\n".join(f"- [{k}] {t}" for k, t in fl)
        opts = "\n".join(f"{i}. {c}" for i, c in enumerate(good))
        try:
            best = int(
                await _json(
                    llm,
                    f"{JUDGE}\n\nФакты:\n{facts_lines}\n\nВарианты:\n{opts}",
                    "best",
                    "sound_judge",
                    0.0,
                    True,
                )
            )
        except (ValueError, KeyError):
            best = 0
    if not 0 <= best < len(good):
        return "rejected", None  # the judge found them all dull
    facts_text = "\n".join(f"- [{k}] {t}" for k, t in fl)
    phrase = await edit(llm, facts_text, good[best], SIGNATURE_EDIT)
    if check_signature(phrase):  # the editor broke an explicit line: keep the judged draft
        phrase = good[best]
    return "ok", phrase


# ── album and artist timeline (demo4/album6.py) ──────────────────────────────

ALBUM_VER = 1  # part of facts_hash: a prompt change regenerates
ALBUM_RULES = (
    "Пиши по-русски для человека, который слушает музыку внимательно. 2–3 связных предложения "
    "живым языком, как знакомый меломан рассказывает другу. Сначала — чем узнаётся звук этого "
    "альбома (поле «характер»), потом — что изменилось по сравнению с предыдущим альбомом "
    "артиста (поле «после_предыдущего», назови его и год и ВСЕ пункты из «изменения»). Если "
    "поля «после_предыдущего» нет — просто опиши звук альбома и не упоминай никакие другие "
    "альбомы. Слова «чуть» и «заметно» бери ровно из фактов, не усиливай. Метки слушателей "
    "перескажи как звук (электро-хоп — клубный, качающий; синти-поп — много синтов), не "
    "перечисляй их списком. Если предыдущего альбома нет — не сравнивай ни с чем. Никаких "
    "чисел, оценок, ударов в минуту.\n"
    "Нельзя: «звучание альбома», «характеризуется», «варьируется», «создавая», «атмосфера», "
    "«бросается в глаза», «дымка», «тонкий слой», «прозрачн», «привычн», «чем его другие "
    "работы», «где обычно», «это не просто», «пластинка», «Послушай», восклицания; не "
    "выдумывай инструменты и истории, которых нет в фактах.\n"
    "Образец тона (выдуманный альбом, бери манеру): «После камерного дебюта всё разрослось: "
    "струнные и хор, бас стал главным, и музыка навалилась плотной стеной. По сравнению с "
    "прошлым альбомом звук чуть шире — много эха, как в большом зале.»\n"
    'Ответ — только JSON: {"text": "..."}'
)
TIMELINE_RULES = (
    "Перескажи эти строки о том, как менялся звук {artist} от альбома к альбому, живым языком "
    "для меломана, 3–4 предложения, по порядку и с годами. Слова «чуть» и «заметно» бери как "
    "есть, не усиливай. Не добавляй фактов, не называй числа и не пиши слово «оценки». "
    'Ответ — только JSON: {{"text": "..."}}'
)
NUMBERS = re.compile(r"\d:\d\d|\d+\s*(bpm|удар)", re.IGNORECASE)
LATIN = re.compile(r"[A-Za-z][\w'’&.]*(?:\s+[A-Za-z0-9&][\w'’&.]*)*")


def latin_not_in(text: str, known: str) -> list[str]:
    """Latin names in the text that the facts don't carry (an album the model brought in from
    its own memory)."""
    k = known.lower()
    return [n for n in LATIN.findall(text) if n.lower().rstrip(".") not in k]


def check_album(text: str, known: str) -> list[str]:
    """The owner's lines for album texts: no album or name from outside the facts, no numbers;
    everything else is the editor's job."""
    problems = [f"чужое имя: {n}" for n in latin_not_in(text, known)]
    if NUMBERS.search(text):
        problems.append("числа и таймкоды нельзя")
    return problems


async def album_text(
    llm: Llm, artist: str, facts: dict[str, Any], used: list[str]
) -> tuple[str, str | None]:
    """(state, text): three drafts at rising temperature, each edited and checked."""
    known = json.dumps(facts, ensure_ascii=False)
    prompt = f"Альбом {artist} — «{facts['альбом']}». {ALBUM_RULES}\n\nФакты:\n{known}"
    avoid = ("Начни иначе, чем другие альбомы: " + " | ".join(used[-12:])) if used else ""
    for i in range(3):
        try:
            draft = str(
                await _json(llm, prompt, "text", "sound_album", 0.6 + 0.1 * i, False)
            ).strip()
        except (ValueError, KeyError):
            continue
        text = await edit(llm, known, draft, avoid)
        if not check_album(text, f"{known} {artist}"):
            return "ok", text
    return "rejected", None


async def timeline_text(llm: Llm, artist: str, rows: list[str]) -> tuple[str, str | None]:
    rows_text = "\n".join(rows)
    prompt = TIMELINE_RULES.format(artist=artist) + "\nСтроки:\n" + rows_text
    for i in range(3):
        try:
            draft = str(
                await _json(llm, prompt, "text", "sound_timeline", 0.5 + 0.1 * i, False)
            ).strip()
        except (ValueError, KeyError):
            continue
        text = await edit(llm, rows_text, draft)
        if not check_album(text, f"{rows_text} {artist}"):
            return "ok", text
    return "rejected", None
