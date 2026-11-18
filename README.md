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

## Daily use: build the app

`npm run dev` is for working on the browser. It runs a dev server, unminified React and extra
checks, so it is noticeably slower. On the Intel Mac especially, use a built app day to day.

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

When the sidebar is hidden (⌘S), move the pointer to the left edge of the window to show it
over the page, like Arc.

## Shields (ad and tracker blocking)

Click the shield next to the address in the sidebar. The number is how many ads and trackers
were blocked on the current page.

- **Blocks ads and trackers** with the lists uBlock Origin and Brave use (EasyList, EasyPrivacy,
  uBlock Origin filters, Peter Lowe's list) — about 187,000 rules — including hiding empty ad boxes
  and fixing sites that fight ad blockers.
- **Blocks cookie banners** (can be turned off).
- **Removes tracking parameters** like `fbclid` and `gclid` from links you open.
- **Upgrades to HTTPS** when a link is `http://`, and quietly falls back if the site doesn't support it.
- **Turn Shields off for a site** if it breaks: shield → uncheck "Shields on for …". The page reloads.

Filter lists download on first launch (a few seconds) and update once a day in the background.
They are compiled on a background thread and cached, so they don't slow down startup.

## Performance (built for a slow Intel Mac)

- **Tabs load lazily.** After a restart only the tab you are on loads; the rest load when clicked.
- **Idle tabs go to sleep** after 15 minutes (Performance menu → Sleep Inactive Tabs). Sleeping tabs
  use no memory or CPU and keep their back/forward history. Tabs playing audio or with text you
  typed are never put to sleep. Right-click a tab → Put Tab to Sleep to do it by hand.
- **Prefer H.264 video** (Performance menu, on by default on Intel Macs). YouTube normally sends
  VP9/AV1 video, which Intel Macs decode in software, using several CPU cores. H.264 is decoded by
  the GPU instead. YouTube tops out at 1080p in this mode.
- **Cheap UI updates.** The sidebar redraws at most every 50 ms, however busy the pages are.
- **Shields** (above) are the biggest win: ads and trackers are most of a page's CPU use.

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
