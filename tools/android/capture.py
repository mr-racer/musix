"""Screens for the phase 4 review, both themes: `capture.py <out dir> [package]`.
The app must be signed in; the script starts «Поток» itself so the player has a track."""
import subprocess
import sys
import time
from pathlib import Path

import ui

OUT = Path(sys.argv[1])
PKG = sys.argv[2] if len(sys.argv) > 2 else "ru.musixai.app"
ADB = ui.ADB


def sh(*a: str) -> None:
    subprocess.run(ADB + ["shell", *a], capture_output=True)


def shot(name: str) -> None:
    time.sleep(2.5)
    data = subprocess.run(ADB + ["exec-out", "screencap", "-p"], capture_output=True).stdout
    (OUT / f"{name}.png").write_bytes(data)
    print(name)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    sh("am", "force-stop", PKG)
    sh("am", "start", "-n", f"{PKG}/ru.musixai.app.MainActivity")
    time.sleep(6)
    sh("input", "tap", "160", "784"); time.sleep(6)  # the orb starts «Поток»: the mini player is up
    for theme in ("dark", "light"):
        # the app follows the system theme: a uimode switch recreates the activity, playback stays
        sh("cmd", "uimode", "night", "yes" if theme == "dark" else "no"); time.sleep(3)
        ui.tap_text("Главная", -1); shot(f"home-{theme}")
        ui.tap_text("Библиотека", -1); time.sleep(1)
        sh("input", "tap", "168", "645"); shot(f"library-albums-{theme}")  # the library reopens on its last tab
        sh("input", "tap", "915", "640"); time.sleep(2); shot(f"library-stats-{theme}")
        ui.tap_text("Ассистент", -1); shot(f"search-{theme}")
        ui.tap_text("Игра", -1); shot(f"quiz-{theme}")
        ui.tap_text("Главная", -1); time.sleep(1)
        sh("input", "tap", "300", "2110"); time.sleep(3); shot(f"player-{theme}")
        sh("input", "tap", "540", "1484"); time.sleep(4); shot(f"artist-{theme}")  # the artist line → the atlas
        for _ in range(3):  # back out of the atlas (and the player, if it stayed open) to the tabs
            sh("input", "keyevent", "KEYCODE_BACK"); time.sleep(1.5)
            if ui.find("Главная", index=-1) is not None:
                break


if __name__ == "__main__":
    main()
