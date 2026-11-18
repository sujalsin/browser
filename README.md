# Browser

A personal, Arc-style browser for macOS (Intel and Apple Silicon), built on Electron/Chromium.
Vertical tabs, pinned tabs, a command bar, Clear, Chrome extensions (Bitwarden) — and, coming
next, spaces, Tidy and Brave-style Shields. See [PLAN.md](PLAN.md) for the full roadmap.

## Run it

Needs Node.js 22.12+ (`brew install node`).

```bash
npm install
npm run dev
```

## Build an app for your Macs

```bash
npm run dist:mac          # one universal .dmg that runs on Intel and Apple Silicon
npm run dist:mac:x64      # Intel only (smaller)
npm run dist:mac:arm64    # Apple Silicon only (smaller)
```

The `.dmg` lands in `dist/`. It is ad-hoc signed, which is fine for your own Macs. If you copy it
to another Mac (AirDrop etc.) and macOS says it is damaged or can't be opened, run
`xattr -cr /Applications/Browser.app` once.

To make it your default browser: System Settings → Desktop & Dock → Default web browser.

## Install Bitwarden

Extensions menu → **Install Bitwarden**, then click **Add to Chrome** on the Web Store page.
The Bitwarden button appears under the address pill in the sidebar.

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| ⌘T | New tab (command bar) |
| ⌘L | Edit current URL |
| ⌘W / ⇧⌘T | Close tab / reopen closed tab |
| ⌘S | Toggle sidebar |
| ⇧⌘C | Copy URL |
| ⌘D | Pin / unpin tab |
| ⇧⌘K | Clear Today tabs (moves them to the archive) |
| ⌘1–⌘9 | Go to tab N (⌘9 = last tab) |
| ⌃Tab / ⌃⇧Tab, ⌥⌘↓ / ⌥⌘↑ | Next / previous tab |
| ⌘[ / ⌘] / ⌘R | Back / forward / reload |
| ⌘= / ⌘- / ⌘0 | Zoom in / out / reset |
| ⌥⌘I | Developer tools |

Pinned tabs work like Arc: ⌘W unloads them, and they return to their pinned URL.
Right-click a tab in the sidebar for more options.

## Keep it secure

Chromium security fixes reach this browser through Electron releases. Update at least monthly:

```bash
npm update electron && npm run dist:mac
```

## Project layout

```
src/main/       Electron main process: window, tabs, menu/shortcuts, permissions, extensions
src/preload/    Bridge between the UI and the main process
src/renderer/   React UI: sidebar and command bar
src/shared/     Types and URL handling shared by both sides
```

`npm test` runs the unit tests and `npm run typecheck` checks types.
