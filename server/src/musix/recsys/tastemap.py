"""«Сонар вкуса» (the stats tab's map): the library's CLAP vectors → 2-D PCA → a small
k-means (v1 `taste_map_service`, ported; numpy SVD instead of scikit-learn). Each island
is named by the sound axes on which it leans ≥ 0.5 σ from the library — plain listener
words, no model prose."""

from __future__ import annotations

import numpy as np

MIN_TRACKS, Z_THRESHOLD = 8, 0.5
AXES = ("energy", "vocal_lead", "spacious", "experimental", "brightness", "acousticness")
WORDS = {
    "ru": {
        "energy": ("Энергичная", "Спокойная"),
        "vocal_lead": ("Вокальная", "Инструментальная"),
        "spacious": ("Просторная", "Камерная"),
        "experimental": ("Экспериментальная", "Ровная"),
        "brightness": ("Яркая", "Тёмная"),
        "acousticness": ("Акустичная", "Электронная"),
    },
    "en": {
        "energy": ("Energetic", "Calm"),
        "vocal_lead": ("Vocal", "Instrumental"),
        "spacious": ("Spacious", "Intimate"),
        "experimental": ("Experimental", "Steady"),
        "brightness": ("Bright", "Dark"),
        "acousticness": ("Acoustic", "Electronic"),
    },
}


def kmeans(X: np.ndarray, k: int, iters: int = 24, seed: int = 0) -> tuple[np.ndarray, np.ndarray]:
    """Lloyd's k-means with k-means++ seeding, deterministic (v1's)."""
    rng = np.random.default_rng(seed)
    n = X.shape[0]
    k = max(1, min(k, n))
    idx = [int(rng.integers(n))]
    d2 = ((X - X[idx[0]]) ** 2).sum(1)
    for _ in range(1, k):
        total = float(d2.sum())
        nxt = int(rng.choice(n, p=d2 / total if total > 0 else None))
        idx.append(nxt)
        d2 = np.minimum(d2, ((X - X[nxt]) ** 2).sum(1))
    C = X[idx].astype(np.float64).copy()
    labels = np.full(n, -1)
    for _ in range(iters):
        nl = ((X[:, None, :] - C[None, :, :]) ** 2).sum(2).argmin(1)
        if np.array_equal(nl, labels):
            break
        labels = nl
        for j in range(k):
            if (m := labels == j).any():
                C[j] = X[m].mean(0)
    return labels, C


def build(ids: list[str], X: np.ndarray, axes: list[dict[str, float] | None]) -> dict[str, object]:
    """{"trackIds", "x", "y", "cluster": parallel lists, "clusters": [{id, nameRu, nameEn,
    size, cx, cy, spread, sampleTrackIds}]} — empty under MIN_TRACKS."""
    n = len(ids)
    if n < MIN_TRACKS:
        return {"trackIds": [], "x": [], "y": [], "cluster": [], "clusters": []}
    Xc = X - X.mean(0)
    _, _, vt = np.linalg.svd(Xc, full_matrices=False)
    coords = Xc @ vt[:2].T
    s = float(np.percentile(np.abs(coords), 98)) or 1.0
    coords = np.clip(coords / s, -1.05, 1.05)
    labels, C = kmeans(coords, int(min(8, max(3, round(n / 40)))))
    Z = np.full((n, len(AXES)), np.nan)
    for i, a in enumerate(axes):
        for j, name in enumerate(AXES):
            if a and isinstance(a.get(name), int | float):
                Z[i, j] = a[name]
    mu, sd = np.nanmean(Z, 0), np.nanstd(Z, 0)
    Z = (Z - mu) / np.where(sd > 1e-9, sd, 1)

    def island_name(mask: np.ndarray, lang: str) -> str:
        cz = np.nanmean(Z[mask], 0) if np.isfinite(Z[mask]).any() else np.zeros(len(AXES))
        cz = np.nan_to_num(cz)
        strong = [a for a in np.argsort(-np.abs(cz)) if abs(cz[a]) >= Z_THRESHOLD]
        if not strong:
            return "Разное" if lang == "ru" else "Mixed"
        w = [WORDS[lang][AXES[a]][0 if cz[a] > 0 else 1] for a in strong[:2]]
        return w[0] if len(w) == 1 else f"{w[0]}{' и ' if lang == 'ru' else ' & '}{w[1].lower()}"

    clusters = []
    for j in range(C.shape[0]):
        mask = labels == j
        if not mask.any():
            continue
        d = ((coords[mask] - C[j]) ** 2).sum(1)
        members = [ids[i] for i in np.where(mask)[0]]
        clusters.append(
            {
                "id": j,
                "nameRu": island_name(mask, "ru"),
                "nameEn": island_name(mask, "en"),
                "size": int(mask.sum()),
                "cx": round(float(C[j][0]), 4),
                "cy": round(float(C[j][1]), 4),
                "spread": round(max(0.08, min(float(np.sqrt(d.mean())), 0.9)), 4),
                "sampleTrackIds": [members[int(o)] for o in np.argsort(d)[:4]],
            }
        )
    # columnar: ~40 % of the row form's bytes for a 6k-track library
    return {
        "trackIds": list(ids),
        "x": [round(float(v), 3) for v in coords[:, 0]],
        "y": [round(float(v), 3) for v in coords[:, 1]],
        "cluster": [int(v) for v in labels],
        "clusters": clusters,
    }
