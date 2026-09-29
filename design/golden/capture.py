"""Golden screenshots of v1: every surface × phone 412×915 / desktop 1440×900 × dark / light.

Two sets:
  - the owner's REAL library on the v1 copy → /mnt/data/musix-snapshots/golden/<date>/
    (not committed: it shows the library);
  - the e2e fixture library (3 generated tracks) → design/golden/fixture/ (committed).
Usage (env /mnt/data/envs/musix-e2e):
  python capture.py --base URL --token JWT --user-id ID --out DIR [--artist SLUG]
"""

import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright

SIZES = {"phone": {"viewport": {"width": 412, "height": 915}, "is_mobile": True, "device_scale_factor": 2},
         "desktop": {"viewport": {"width": 1440, "height": 900}, "device_scale_factor": 1}}


def shoot(page, out, name):
    page.wait_for_timeout(2500)
    page.screenshot(path=str(out / f"{name}.png"))


def run(a):
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    taken = []
    with sync_playwright() as p:
        b = p.chromium.launch(channel="chrome", headless=True)
        for size, opts in SIZES.items():
            for theme in ("dark", "light"):
                c = b.new_context(**opts)
                c.add_init_script(f"""
                    localStorage.setItem('musix_token', {json.dumps(a.token)});
                    localStorage.setItem('musix_user_role', {json.dumps(a.role)});
                    localStorage.setItem('musix_user_id', {json.dumps(a.user_id)});
                    localStorage.setItem('musix_welcome_seen_' + {json.dumps(a.user_id)}, '1');
                    localStorage.setItem('musix_guide_seen_' + {json.dumps(a.user_id)}, '1');
                    localStorage.setItem('musix_lang', 'ru');
                    localStorage.setItem('musix_theme', '{theme}');""")
                page = c.new_page()
                tag = f"{size}-{theme}"
                routes = [("home", "/"), ("search", "/search"), ("library-albums", "/library?tab=albums"),
                          ("library-stats", "/library?tab=stats"), ("assistant", "/assistant")]
                if a.artist:
                    routes.append(("artist", f"/artist/{a.artist}"))
                for name, path in routes:
                    page.goto(a.base + path, wait_until="networkidle")
                    shoot(page, out, f"{name}-{tag}")
                    taken.append(f"{name}-{tag}")
                # the desktop floating nav is hidden on home: go through a section that shows it
                page.goto(a.base + "/search", wait_until="networkidle")
                page.get_by_title("Игра").first.click()
                shoot(page, out, f"quiz-{tag}")
                taken.append(f"quiz-{tag}")
                page.goto(a.base + "/library?tab=albums", wait_until="networkidle")
                page.locator(".lib-album-card").first.click()
                page.wait_for_timeout(1200)
                page.locator(".album-row-in").first.click()
                shoot(page, out, f"player-{tag}")
                taken.append(f"player-{tag}")
                c.close()
                # login: a fresh context without a token
                c = b.new_context(**opts)
                c.add_init_script(f"localStorage.setItem('musix_theme', '{theme}');")
                page = c.new_page()
                page.goto(a.base + "/#login", wait_until="networkidle")
                shoot(page, out, f"login-{tag}")
                taken.append(f"login-{tag}")
                c.close()
        b.close()
    (out / "index.json").write_text(json.dumps(sorted(taken), indent=1))
    print(f"{len(taken)} screenshots → {out}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    for k in ("--base", "--token", "--user-id", "--out"):
        ap.add_argument(k, required=True)
    ap.add_argument("--artist")
    ap.add_argument("--role", default="owner", help="'member' for an account on a server-mode instance")
    run(ap.parse_args())
