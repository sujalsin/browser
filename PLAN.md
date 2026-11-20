# Browser — Plan

A personal, local, Arc-style browser to replace Arc. Vertical tabs, spaces, Tidy,
Arc's keyboard-first workflow, and Brave-style Shields — without the AI features.

## Requirements

| Requirement | Decision |
|---|---|
| Machines | Intel Mac on macOS Tahoe (26) and Apple Silicon (M5) on Tahoe |
| Performance | Must feel fast on the (slow) Intel Mac: lazy loading, tab sleeping, H.264 video, ad blocking |
| Engine | Electron (Chromium), latest stable — currently 45.x, ships `darwin-x64` and `darwin-arm64` |
| Must-have extension | **Bitwarden** (via `electron-chrome-extensions` + Chrome Web Store install) |
| Tidy | Both: **Clear** (archive unpinned Today tabs) and **Tidy** (rule-based grouping into folders, no AI) |
| Distribution | Local only. Built per-machine or as a universal `.dmg`, ad-hoc signed |

Note: macOS Tahoe is the last macOS release for Intel Macs. Chromium/Electron will keep
supporting it for a while after, but expect Intel support to end eventually (likely 2028+).

## Why Electron

- Every site works like it does in Chrome/Arc (same engine).
- `WebContentsView` gives us full control over tab layout, so the whole Arc UI is just our own React app.
- One session (cookie jar) per space/profile comes for free (`session.fromPartition`).
- Mature ad-block engine with an Electron integration (`@ghostery/adblocker-electron`).
- Builds for Intel and Apple Silicon from the same code.

Rejected: forking Chromium (100 GB+ checkout, multi-hour builds, 4-week rebase treadmill),
Swift + WebKit (no Chrome extensions → no reliable Bitwarden), Tauri (multi-webview not mature).

**Ongoing cost:** Chromium security fixes arrive through Electron releases. Bump Electron
at least monthly (`npm update electron`) — this is non-negotiable for a daily-driver browser.

## Architecture

```
┌─ Main process (Node) ───────────────────────────────────────┐
│  BrowserShell: one BrowserWindow (UI) + WebContentsView/tab  │
│  TabManager: model + lazy views (tabs load when activated)   │
│  Spaces → session partition per profile                      │
│  Shields (Phase 2) · Menu/shortcuts · Permissions prompts     │
│  Store: JSON state file (Phase 0) → SQLite history (Phase 3)  │
│  Extensions: electron-chrome-extensions + Chrome Web Store    │
└──────────────┬──────────────────────────────────────────────┘
               │ IPC: state snapshots ↓   actions ↑ (sender-validated)
┌─ UI (React, sandboxed, contextIsolation) ───────────────────┐
│  Sidebar view (inside the BrowserWindow)                     │
│  Overlay view (transparent WebContentsView): command bar     │
└──────────────────────────────────────────────────────────────┘
   Web content: sandboxed, no Node, no preload of ours
```

The main process is the single source of truth. The UI never owns state; it renders the
latest snapshot and sends actions.

## Feature map (Arc → this browser)

| Arc | Implementation | Phase |
|---|---|---|
| Vertical tabs, pinned/Today sections | Sidebar tree | 0 |
| Command bar (⌘T / ⌘L) | Overlay view; searches tabs, then history | 0 (tabs) / 3 (history) |
| Clear (archive Today tabs) | Moves unpinned tabs to the archive | 0 |
| Pinned tabs that "remember" their URL | `pinnedUrl`; ⌘W on a pinned tab unloads it | 0 |
| Session restore, lazy tab loading | JSON store, views created on activation | 0 |
| Favorites row | Icon grid at top, shared across spaces | 1 |
| Folders, drag-and-drop | Sidebar tree with folders | 1 |
| Spaces (color, icon, profile) | Space model + partition per profile; ⌃1–9 to switch | 1 |
| Auto-archive Today tabs (12h/24h/7d/30d) | Timer on `lastActiveAt` | 1 |
| **Tidy** (no AI) | Group by site into folders, merge duplicates, archive stale | 1 |
| Sidebar auto-hide with hover reveal | Edge hot-zone + overlay view | 0.5 ✅ |
| Tab sleeping | Destroy views idle > N min, keep history (big win on Intel) | 0.5 ✅ |
| Shields | See below | 2 |
| History, downloads panel, find in page | SQLite + UI | 3 |
| Bitwarden | Extension support + Web Store | 0 spike → 3 polish |
| Import from Arc | Parse `~/Library/Application Support/Arc/StorableSidebar.json` | 3 |
| Set as default browser | `open-url` + Info.plist URL types | 0 (handler) / 3 (UI) |
| Split view, Peek, Little Arc, Boosts, themes, mini player | | 4 |

## Shields (Brave-style) — Phase 2

1. Network blocking: EasyList, EasyPrivacy, uBlock Origin filters, Peter Lowe's list; refreshed daily, cached on disk.
2. Cosmetic filtering (hide empty ad slots).
3. Scriptlet injection (YouTube and other hard cases).
4. Strip tracking params (`utm_*`, `fbclid`, `gclid`, `mc_eid`, …) before navigation.
5. Cookie-banner blocking (EasyList Cookie).
6. HTTPS upgrade, third-party cookie blocking.
7. Per-site Shields panel: blocked count, on/off toggle.

Start with `@ghostery/adblocker-electron`. Option later: Brave's own `adblock-rust`.

## Keyboard shortcuts (Arc-flavored, rebindable later)

| Shortcut | Action |
|---|---|
| ⌘T | New tab (command bar) |
| ⌘L | Edit current URL (command bar) |
| ⌘W / ⇧⌘T | Close / reopen closed tab |
| ⌘S | Toggle sidebar |
| ⇧⌘C | Copy URL |
| ⌘D | Pin / unpin tab |
| ⇧⌘K | Clear Today tabs |
| ⌘1–⌘9 | Go to tab N (⌘9 = last) |
| ⌃Tab / ⌃⇧Tab | Next / previous tab |
| ⌘[ / ⌘] / ⌘R | Back / forward / reload |
| ⌘= / ⌘- / ⌘0 | Zoom |
| ⌥⌘I | Developer tools |

## Bitwarden risk

`electron-chrome-extensions` implements most `chrome.*` APIs Bitwarden uses (runtime,
storage, tabs, contextMenus, cookies, notifications, action popups). Phase 0 wires up the
Chrome Web Store so it can be installed and tested **first**. If autofill or popup fails,
fallbacks in order: patch the missing API in our main process → use Bitwarden's desktop app
alongside → revisit the engine choice before investing more.

## Roadmap & definition of done

- **Phase 0 — Skeleton** ✅ done: sidebar, tabs, command bar, pinned tabs, Clear + archive, session restore with lazy loading, shortcuts, context menus, permission prompts, downloads, load-error page, Chrome Web Store + extension support. Bitwarden verified: installs, background runs, button and popup work. **Still to verify on a Mac:** log in and autofill.
- **Phase 0.5 — Performance** ✅ done (requirement: must feel fast on the Intel Mac): idle tab sleeping with history kept, H.264 preference for Intel, batched UI updates, minified UI bundle, window shown before extensions finish loading, sidebar hover-reveal when hidden.
- **Phase 2 — Shields** ✅ done (moved ahead of Phase 1 for Intel performance): Ghostery engine with uBlock Origin-compatible lists compiled on a worker thread and cached; network + cosmetic + scriptlet blocking; cookie banners; tracking-parameter stripping; HTTPS upgrade with fallback; per-site toggle; blocked count. Not yet: third-party cookie blocking, fingerprinting protection.
- **Phase 1 — The Arc core** ✅ done: spaces (colors, optional separate profile, ⌃1–9, swipe), favorites per profile, folders in pinned and Today, drag and drop everywhere, auto-archive (12h default), rule-based Tidy (duplicates + group by site), Clear, cross-space ⌘T search. Data model is a tree (src/main/model.ts) with unit tests and automatic migration from v1.
- **Phase 3 — Daily driver** ✅ done: history (node:sqlite + FTS5, 90-day retention, ⌘T suggestions), downloads manager, find in page, persisted per-profile site permissions, Library overlay (History / Downloads / Settings), Arc import (spaces, colors, pinned, folders, Today, favorites, profiles, history; format per Firefox's/Zen's Arc migrators).
- **Phase 4 — Polish**: split view, Peek, Little Arc, Boosts, themes.

## Development

```bash
npm install
npm run dev          # run with hot reload
npm test             # unit tests
npm run dist:mac     # universal .dmg (Intel + Apple Silicon) in dist/
```
