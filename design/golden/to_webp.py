"""PNG → WebP (quality 90, method 6) in place: the golden set is a visual reference
("reads as the same app"), and every recapture would otherwise add ~12 MB to git."""

import sys
from pathlib import Path

from PIL import Image

for p in Path(sys.argv[1]).glob("*.png"):
    Image.open(p).save(p.with_suffix(".webp"), "WEBP", quality=90, method=6)
    p.unlink()
