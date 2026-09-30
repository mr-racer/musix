# Bundled fonts

`src/main/res/font/*.ttf` are static instances fetched from Google Fonts: Geist, Noto Sans,
Noto Serif Display, Playfair Display, JetBrains Mono. All are under the SIL Open Font
License 1.1 (https://openfontlicense.org). v1 loaded the same families from the Google Fonts
CDN (`frontend/index.html`); the app bundles them so text renders offline and in
screenshot tests.
