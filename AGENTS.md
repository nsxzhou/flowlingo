# Repository Guidelines

## Project Structure & Module Organization

FlowLingo is a Manifest V3 Chrome/Edge extension. There is no bundler in this repo; source files are loaded directly by `manifest.json`.

- `manifest.json`: Extension entry points (service worker, content scripts, popup, options).
- `src/background/`: Service worker + core logic (routing, planner, LLM integration, cache, persistence).
- `src/content/`: Content script, injected CSS, and vendor code (e.g. `src/content/vendor/Readability.js`).
- `src/ui/`: Extension UI (`popup/` and `options/`, each with `*.html`, `*.css`, `*.js`).
- `src/shared/`: Shared constants/utilities (notably `src/shared/globals.js` for message types and defaults).
- `src/assets/`: Icons and wordlists (e.g. `src/assets/cefr_wordlist/`).

## Build, Test, and Development Commands

This project is developed by loading the repo as an unpacked extension:

- Load: open `chrome://extensions` → enable “Developer mode” → “Load unpacked” → select the repository root.
- Reload after changes: `chrome://extensions` → click “Reload” on FlowLingo.
- Debug:
  - Service worker: `chrome://extensions` → “Service worker” → Inspect.
  - Content script: open DevTools on a target page → Console/Elements.

## Coding Style & Naming Conventions

- JavaScript/CSS/HTML are plain files (no build step). Keep code compatible with Chromium extension contexts.
- Formatting: 2-space indentation, semicolons, and existing IIFE module pattern (e.g. `(function initX(){ ... })();`).
- Prefer adding cross-module message types to `src/shared/globals.js` (`FlowLingo.MessageType`) and route them via `src/background/router.js`.

## Testing Guidelines

No automated test suite is currently wired in. Validate changes manually:

- Load/reload the extension, visit a Chinese article page, and confirm injection/overlay behavior.
- Check both popup and options pages for regressions.

## Commit & Pull Request Guidelines

- Commits are short and descriptive; history commonly uses `type: summary` (e.g. `docs: ...`) and Chinese summaries.
- Keep PRs small and scoped. Include:
  - What changed + why
  - Repro steps (e.g. pages used)
  - Screenshots/recording for UI changes

## Security & Configuration Tips

- Never commit API keys, tokens, or personal endpoints. Use the Options page for runtime configuration and keep local-only helpers out of history.
