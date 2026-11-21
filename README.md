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
| ⌃⌘F | Full screen |
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
| ⇧⌘N | Private browsing |
| ⌥⌘T | Translate page |
| ⌥⌘P | Picture-in-picture |
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

## From Chrome

- **Private browsing** (⇧⌘N) — a private space: nothing is added to history, cookies and logins are
  separate and wiped when you close it, nothing about it is saved to disk, extensions are off.
  Shields still apply. Close it with the Close button in its banner.
- **Site info** — click the lock at the left of the address: is the connection secure, what the
  site may do (Ask / Allow / Block for camera, location, notifications…), how many cookies it has,
  and Clear Cookies and Site Data.
- **Translate** (⌥⌘T, or right-click the page) — translates the page in place; View → Show Original
  puts it back. Choose the language in Settings. The page's text is sent to Google Translate only
  when you ask. Sentences broken up by links or bold text are translated in pieces, so wording can
  be rougher than Chrome's.
- **Picture-in-picture** (⌥⌘P, or right-click a video) — and, like Arc, a video playing with sound
  pops out by itself when you switch tabs and returns when you come back (Settings to turn off).

## Netflix, Spotify and other protected video

This browser uses a build of Electron that includes Widevine, the copy-protection module those
services require. Services such as Netflix and Disney+ also insist that the app itself is signed
for Widevine. That is free, but needs a one-time setup on each Mac you build on, so do this
before expecting protected video to play:

```bash
brew install pipx && pipx install castlabs-evs
```

```bash
evs-account signup
```

`signup` asks for an email and a password and sends a confirmation code. After that, every
`npm run dist:mac…` signs the app automatically (you'll see it in the build output). Without it the
build still works and prints a warning, but expect protected video not to play. Protected video does
not play in `npm run dev`.

Settings shows at the bottom whether protected video is ready. The first launch downloads the
module, so give it a minute online.

Websites see this browser as a Chromium browser with a Chrome-style user agent, which is what it
is. Google's sign-in pages alone are sent the app's full user agent, with its own name in it:
Google refuses sign-in to a browser that looks exactly like Chrome but isn't, and accepts one
that says what it is. If a streaming site shows an error, reload once, then try with Shields off
for that site (the shield button).

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

## Signing in with Google on other sites

"Continue with Google" buttons open Google's sign-in window. (Chrome can instead show an account
chooser of its own; this browser can't, so that mechanism is switched off and sites fall back to
the window.) Google's one-tap prompt in the corner of a page may not appear.

## Passkeys

Signing in with a passkey that lives in iCloud Keychain, on your phone, or in Chrome does not work
in this browser. macOS only hands those to apps Apple has approved as browsers, or to apps a
website has listed as its own; a personal build is neither. When a site waits for a passkey
("Verifying it's you…"), choose **Try another way** and use your password or a code. You stay
signed in afterwards, so it is a one-time step per site and space.

A USB security key should work, since it needs nothing from macOS. Passkeys stored in the
Bitwarden extension may work too (the extension answers the site itself); neither has been tested
here.

## Keep it secure

Chromium security fixes reach this browser through Electron releases. Check at least monthly at
https://github.com/castlabs/electron-releases/releases for a newer `+wvcus` version (the
Widevine-enabled build; it usually follows official Electron by a few days) and install it:

```bash
npm install "https://github.com/castlabs/electron-releases#v45.2.1+wvcus" --save-dev
```

(with the new version number in place of `45.2.1`), then build again.

## Project layout

```
src/main/       Electron main process: window, tabs, menu/shortcuts, permissions, extensions
src/preload/    Bridge between the UI and the main process
src/renderer/   React UI: sidebar and command bar
src/shared/     Types and URL handling shared by both sides
```

`npm test` runs the unit tests and `npm run typecheck` checks types.
