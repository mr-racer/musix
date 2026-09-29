"""E2E: background-playback hardening, in real Google Chrome (Android UA).

Against the isolated stack from serve.py (fresh SQLite, throwaway Qdrant,
generated 150 s tracks, fault injection on the stream endpoint).
"""
import json
import os
import time
import urllib.request

import pytest
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8011"
HERE = os.path.dirname(os.path.abspath(__file__))
UA = ("Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36")


def _get(path):
    return json.load(urllib.request.urlopen(BASE + path))


def set_mode(m):
    _get(f"/__e2e/mode?m={m}")


@pytest.fixture(scope="session")
def login():
    req = urllib.request.Request(
        BASE + "/api/v1/auth/login",
        data=json.dumps({"email": "e2e@example.com", "password": "e2e-password-123"}).encode(),
        headers={"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req))


@pytest.fixture(scope="session")
def browser():
    with sync_playwright() as p:
        b = p.chromium.launch(channel="chrome", headless=True,
                              args=["--autoplay-policy=no-user-gesture-required"])
        yield b
        b.close()


@pytest.fixture
def ctx(browser, login):
    set_mode("normal")
    c = browser.new_context(viewport={"width": 412, "height": 915}, is_mobile=True,
                            has_touch=True, user_agent=UA)
    c.add_init_script(f"""
        localStorage.setItem('musix_token', {json.dumps(login['token'])});
        localStorage.setItem('musix_user_role', 'owner');
        localStorage.setItem('musix_lang', 'ru');""")
    yield c
    c.close()
    set_mode("normal")


def open_app(ctx):
    page = ctx.new_page()
    page.errors = []
    page.on("pageerror", lambda e: page.errors.append(str(e)))
    page.goto(BASE + "/")
    page.wait_for_timeout(2500)
    if page.get_by_text("Как пользоваться", exact=False).count():
        page.mouse.click(368, 265)          # the guide's close button
        page.wait_for_timeout(600)
    return page


def start_track(page, n=1):
    page.get_by_text("Библиотека", exact=True).click()
    page.wait_for_timeout(1500)
    page.get_by_text("E2E Album", exact=True).first.click()
    page.wait_for_timeout(1200)
    page.get_by_text(f"E2E Track {n}", exact=True).first.click()


AUDIO = "[...document.querySelectorAll('audio')].find(a => a.dataset.playbackTrackId)"


def audio(page):
    return page.evaluate(f"""() => {{ const a = {AUDIO}; if (!a) return null;
        return {{src: a.currentSrc || a.src, t: a.currentTime, paused: a.paused,
                err: a.error && a.error.code, tid: a.dataset.playbackTrackId}}; }}""")


def journal(page):
    return json.loads(page.evaluate("() => localStorage.getItem('musix_playback_diag') || '[]'"))


def speed_up(page, rate=4.0):
    page.evaluate(f"() => {{ const a = {AUDIO}; a.defaultPlaybackRate = {rate}; a.playbackRate = {rate}; }}")


def wait_for(page, pred, timeout=40.0, step=0.25):
    end = time.time() + timeout
    while time.time() < end:
        v = pred()
        if v:
            return v
        page.wait_for_timeout(int(step * 1000))
    return None


def set_hidden(page, hidden):
    """Synthetic visibility: headless Chrome never changes visibilityState, and
    a headed one would open windows on the owner's desktop. This exercises the
    APP's handlers, not Chrome's own decision to hide or freeze."""
    page.evaluate("""(h) => {
        Object.defineProperty(document, 'hidden', {configurable: true, get: () => h});
        Object.defineProperty(document, 'visibilityState', {configurable: true, get: () => h ? 'hidden' : 'visible'});
        document.dispatchEvent(new Event('visibilitychange'));
    }""", hidden)


def types(page):
    return [e["type"] for e in journal(page)]


# ── 1. Link drops mid-track ──────────────────────────────────────────────────
def test_recovers_from_mid_stream_network_cut(ctx):
    page = open_app(ctx)
    page.wait_for_timeout(1200)            # boot token must be older than nothing — any works
    set_mode("cut")
    start_track(page, 1)
    assert wait_for(page, lambda: (a := audio(page)) and a["t"] > 0.5, 15), "never started"
    speed_up(page)
    first_src = audio(page)["src"]
    # 1 MB of 320 kbps ≈ 26 s of audio; past 40 s means it survived the cut.
    ok = wait_for(page, lambda: (a := audio(page)) and a["t"] > 40 and not a["paused"], 45)
    j = journal(page)
    log = _get("/__e2e/log")
    print("\nstream log:", [(e["outcome"], e["range"], e["tok"]) for e in log])
    print("journal:", [(e["type"], e.get("code"), e.get("attempt"), e.get("pos")) for e in j
                       if e["type"] in ("error", "recover", "playing", "stalled", "waiting", "recover_gave_up")])
    assert any(e["outcome"] == "cut" for e in log), "fault was not injected"
    assert any(e["outcome"] == "503" for e in log), "browser never re-requested after the cut"
    assert ok, f"playback did not survive the cut: {audio(page)}"
    errs = [e for e in j if e["type"] == "error"]
    recs = [e for e in j if e["type"] == "recover"]
    assert errs and errs[0]["code"] in (2, 4), errs
    assert recs and recs[0]["pos"] > 0, f"recovery restarted from 0: {recs}"
    assert audio(page)["src"] != first_src, "src still carries the dead token"
    assert not page.errors, page.errors


# ── 2. Stale stream token (phone slept past the token's lifetime) ────────────
def test_recovers_from_expired_stream_token(ctx):
    page = open_app(ctx)
    page.wait_for_timeout(1500)            # the boot-minted token is now "old"
    set_mode("expired")
    page.wait_for_timeout(1100)            # a token minted from here on is accepted
    start_track(page, 2)
    ok = wait_for(page, lambda: (a := audio(page)) and a["t"] > 3 and not a["paused"], 30)
    j = journal(page)
    log = _get("/__e2e/log")
    print("\nstream log:", [(e["outcome"], e["tok"]) for e in log])
    print("journal:", [(e["type"], e.get("code"), e.get("attempt")) for e in j
                       if e["type"] in ("error", "recover", "playing", "recover_gave_up")])
    assert any(e["outcome"] == "401" for e in log), "expired token was never presented"
    assert ok, f"did not recover from the expired token: {audio(page)}"
    assert any(e["type"] == "recover" for e in j)
    assert not page.errors, page.errors


# ── 3. PWA update while music plays ──────────────────────────────────────────
def test_sw_update_waits_until_nothing_plays(ctx):
    sw = os.path.join(os.environ["E2E_DIST"], "sw.js")
    original = open(sw).read()
    try:
        page = open_app(ctx)
        assert wait_for(page, lambda: page.evaluate("() => !!navigator.serviceWorker.controller"), 15), \
            "service worker never took control"
        start_track(page, 3)
        assert wait_for(page, lambda: (a := audio(page)) and a["t"] > 1, 15)
        page.evaluate("() => { window.__e2eMarker = 1; }")
        with open(sw, "w") as f:                       # "deploy" a new version
            f.write(original + f"\n// e2e bump {time.time()}\n")
        page.evaluate("() => navigator.serviceWorker.getRegistration().then(r => r.update())")
        assert wait_for(page, lambda: "sw_update" in types(page), 20), "new SW never activated"
        page.wait_for_timeout(1500)
        a = audio(page)
        assert page.evaluate("() => window.__e2eMarker") == 1, "page reloaded mid-song"
        assert a and not a["paused"], f"music stopped by the update: {a}"
        # Shown again while STILL playing → still no reload.
        set_hidden(page, True)
        set_hidden(page, False)
        page.wait_for_timeout(1500)
        assert page.evaluate("() => window.__e2eMarker") == 1, "reloaded on show while playing"
        # Nothing playing + page shown again → the deferred reload goes through.
        page.evaluate(f"() => {AUDIO}.pause()")
        set_hidden(page, True)
        with page.expect_navigation(timeout=15000):
            set_hidden(page, False)
        page.wait_for_timeout(1000)
        assert page.evaluate("() => window.__e2eMarker") is None, "deferred reload never happened"
    finally:
        with open(sw, "w") as f:
            f.write(original)


# ── 4. Journal: lifecycle, pause attribution, shipping ───────────────────────
def test_journal_records_lifecycle_and_ships_it(ctx, login):
    page = open_app(ctx)
    start_track(page, 1)
    assert wait_for(page, lambda: (a := audio(page)) and a["t"] > 1, 15)

    # A pause nobody asked for (what audio-focus loss looks like to the page).
    page.evaluate(f"() => {AUDIO}.pause()")
    page.wait_for_timeout(300)
    page.evaluate(f"() => {AUDIO}.play()")
    page.wait_for_timeout(800)
    # A pause the listener asked for: the player's Space shortcut → togglePlay.
    page.keyboard.press("Space")
    page.wait_for_timeout(300)
    pauses = [e["by"] for e in journal(page) if e["type"] == "pause"]
    print("\npause attribution:", pauses)
    assert "other" in pauses, pauses
    page.keyboard.press("Space")           # resume
    page.wait_for_timeout(800)

    # Hide the page, "freeze" it, resume, show it again.
    set_hidden(page, True)
    page.evaluate("() => document.dispatchEvent(new Event('freeze'))")
    page.evaluate("() => document.dispatchEvent(new Event('resume'))")
    before_show = types(page)
    set_hidden(page, False)                 # visible → flushDiag()
    page.wait_for_timeout(2500)
    print("journal types:", before_show)
    assert "hidden" in before_show and "freeze" in before_show and "resume" in before_show, before_show
    assert "user" in pauses, pauses

    path = os.path.join(os.environ["MUSIX_DIAG_DIR"], f"playback_{login['user']['id']}.jsonl")
    assert wait_for(page, lambda: os.path.exists(path), 10), "journal never reached the server"
    shipped = [e["type"] for line in open(path) for e in json.loads(line)["entries"]]
    print("shipped:", shipped)
    assert "freeze" in shipped and "boot" in shipped
    # Shipped entries leave the device; the ones journaled after the upload stay.
    assert "freeze" not in types(page)
    assert not page.errors, page.errors
