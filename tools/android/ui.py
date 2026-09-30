"""Drive the emulator by what is on screen: `ui.py tap <text> [index, -1 = last]`, `ui.py type <text>`,
`ui.py has <text>`, `ui.py dump`. Nodes are found in a uiautomator dump by text or
content-desc (Compose exposes both)."""
import os
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

ADB = [os.path.join(os.environ.get("ANDROID_HOME", "/mnt/data/android/sdk"), "platform-tools", "adb"), "-s", "emulator-5554"]


def dump() -> ET.Element:
    for _ in range(3):
        subprocess.run(ADB + ["shell", "uiautomator", "dump", "/sdcard/ui.xml"], capture_output=True)
        out = subprocess.run(ADB + ["exec-out", "cat", "/sdcard/ui.xml"], capture_output=True).stdout
        if out.strip().startswith(b"<?xml"):
            return ET.fromstring(out)
        time.sleep(1)
    raise SystemExit("no ui dump")


def find(text: str, root: ET.Element | None = None, index: int = 0) -> ET.Element | None:
    root = root if root is not None else dump()
    hits = [n for n in root.iter("node") if text in (n.get("text") or "") or text in (n.get("content-desc") or "")]
    return hits[index] if hits and -len(hits) <= index < len(hits) else None


def center(n: ET.Element) -> tuple[int, int]:
    x1, y1, x2, y2 = map(int, re.findall(r"\d+", n.get("bounds")))
    return (x1 + x2) // 2, (y1 + y2) // 2


def tap_text(text: str, index: int = 0, tries: int = 10) -> None:
    for _ in range(tries):
        n = find(text, index=index)
        if n is not None:
            subprocess.run(ADB + ["shell", "input", "tap", *map(str, center(n))], check=True)
            return
        time.sleep(1)
    raise SystemExit(f"not on screen: {text}")


def main() -> None:
    cmd, *args = sys.argv[1:]
    if cmd == "tap":
        tap_text(args[0], int(args[1]) if len(args) > 1 else 0)
    if cmd == "type":
        subprocess.run(ADB + ["shell", "input", "text", args[0].replace(" ", "%s")], check=True)
    elif cmd == "has":
        sys.exit(0 if find(args[0]) is not None else 1)
    elif cmd == "dump":
        for n in dump().iter("node"):
            t = n.get("text") or n.get("content-desc")
            if t:
                print(n.get("bounds"), t[:80])


if __name__ == "__main__":
    main()
