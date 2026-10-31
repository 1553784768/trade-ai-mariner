# Offline font fixtures

These are the unchanged WOFF2 assets emitted by `next/font/google` during the initial successful production build. Families and weights match SPEC §4. `sha256.json` records the original asset hashes. No substitute fonts are used.

`scripts/cache-test-fonts.mjs` regenerates this cache after a successful build. Playwright uses Next's `NEXT_FONT_GOOGLE_MOCKED_RESPONSES` test hook to avoid external font requests; the fixture launcher uses the same cache. Ordinary live builds keep the normal Google font loader.

`scripts/prepare-test-fonts.cjs` embeds these original WOFF2 bytes as data URLs in the cached CSS and writes the generated responses into the ignored `artifacts/` directory. This keeps both the CSS and font binary requests offline under Turbopack. The browser loads the original fonts, not fallbacks.
