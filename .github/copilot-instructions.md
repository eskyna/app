# Copilot / AI Agent Instructions

Important project rules:

- This repo is a static PWA. Edit source files directly; there is no `dist/` build step.
- After changes, verify required files and `/app/` base paths in `manifest.webmanifest`, `index.html`, `config.example.js` and `sw.js`.
- Keep UI language customer-friendly; do not expose technical color-distance values or field numbers.
- Preserve ESKYNA branding: Montserrat, warm cream/gold palette, `assets/sign_gold.png` as logo.
- Keep customer-name personalization client-side only; do not write names to manifests, caches, versions or logs.
- For PWA/cache changes, bump `CACHE_NAME` in `sw.js`.
