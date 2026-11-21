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
| ⇧⌘Y | Tidy Today tabs |
| ⌃1–⌃9 | Go to space N |
| ⌘⌥← / ⌘⌥→ | Previous / next space |
| ⌘1–⌘9 | Go to tab N (⌘9 = last tab) |
| ⌃Tab / ⌃⇧Tab, ⌥⌘↓ / ⌥⌘↑ | Next / previous tab |
| ⌘[ / ⌘] / ⌘R | Back / forward / reload |
| ⌘= / ⌘- / ⌘0 | Zoom in / out / reset |
| ⌘F / ⌘G / ⇧⌘G | Find in page / next / previous |
| ⌃⇧= / ⌃⇧- | Split view with a new tab / exit split view |
| ⌥⌘N | New Little Arc window |
| ⇧-click a link | Open it in Peek |
| ⌘Y | History |
| ⇧⌘J | Downloads |
| ⌘, | Settings |
| ⌥⌘I | Developer tools |

Pinned tabs work like Arc: ⌘W unloads them, and they return to their pinned URL.
Right-click a tab in the sidebar for more options.

When the sidebar is hidden (⌘S), move the pointer to the left edge of the window to show it
over the page, like Arc.

## Arc features

- **Spaces** — the dots at the bottom of the sidebar. ⌃1–⌃9 jumps to a space, ⌘⌥← / ⌘⌥→ (or a
  two-finger swipe on the sidebar) moves between them. **+** makes a new space; choose
  "Separate Profile" to give it its own logins, cookies and extensions (install Bitwarden again there).
  Right-click a dot to rename it, change its color or delete it.
- **Favorites** — the icon tiles at the top. Drag a tab up there, or right-click → Add to Favorites.
  Spaces that share a profile share favorites.
- **Pinned and Today** — like Arc. Drag tabs between them; pinned tabs and favorites remember their
  URL and ⌘W only unloads them.
- **Folders** — the folder button by the space name (or right-click a tab → Add to New Folder).
  Drag tabs onto a folder to put them in it; click to collapse; double-click to rename.
- **Tidy** (⇧⌘Y) — closes duplicate tabs and groups Today tabs from the same site into folders.
  No AI. It never closes the tab you're on, and leaves folders you made alone.
- **Clear** (⇧⌘K) — archives everything in Today.
- **Auto-archive** — Today tabs you haven't opened in 12 hours are archived (Tabs → Archive Today
  Tabs to change). Archived tabs are under the archive button and in ⌘T search.
- **⌘T searches every space** and switches to the tab's space.

## Everyday features

- **Print** (⌘P), **View Page Source** (⌥⌘U), and a "Leave site?" prompt before losing unsaved work.
- **Link preview** — hover a link and the address pill shows where it goes.
- **Site sign-in** — password-protected sites and proxies show a sign-in prompt.
- **Find in page** (⌘F) — Enter / ⇧Enter or ⌘G / ⇧⌘G step through matches, Esc closes.
- **History** (⌘Y) — searchable, grouped by day; delete single pages or clear a time range.
  Kept for 90 days. ⌘T suggests pages from history as you type.
- **Downloads** (⇧⌘J) — saved to ~/Downloads. A progress ring appears in the sidebar while
  downloading; pause, resume, cancel, open or show in Finder.
- **Settings** (⌘,) — search engine, default browser, tab sleeping and archiving, H.264,
  Shields, site permissions (camera, location, notifications… — answers are remembered and
  can be reset), clearing cache or cookies.
- **Import from Arc** (File → Import from Arc…, or Settings) — brings over your spaces (with
  their colors), pinned tabs, folders, Today tabs and Favorites, plus 90 days of browsing history.
  Arc profiles become separate profiles here. Passwords and cookies aren't imported (Bitwarden
  has your passwords).

## Polish

- **Split view** — right-click a tab → Open in Split View, or ⌃⇧= to pick a new page for the right
  side. Drag the divider to resize (double-click resets), click a side to make it active.
  ⌃⇧- exits; View → Swap Split Sides.
- **Peek** — links from pinned tabs and favorites that would open a new tab show in a floating
  preview instead, like Arc (Settings to turn off). ⇧-click any link, or right-click → Open Link in
  Peek. "Open in New Tab" keeps it; Esc or a click outside closes it.
- **Little Arc** (⌥⌘N) — a small window for a quick search. Links from other apps open there too
  (Settings to turn off). "Open in Browser" moves the page into the main window.
- **Boosts** — your own CSS (and optional JavaScript) for a site, in the Library → Boosts.
  Right-click anything on a page → **Hide This Element** to zap it for good.
- **Themes** — Settings → Appearance: light, dark or match the system (sites with a dark mode
  follow it), and a color — or a two-color gradient — for each space.

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
- **Memory guard.** At most ~2 pages per GB of RAM stay loaded (16 on an 8 GB Mac); beyond that the
  least recently used tabs sleep early. Tabs playing audio or with typed text are never touched.
- **Task Manager** (Window → Task Manager) shows memory and CPU per tab, with a Sleep button.
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
