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

Once the built app has run, `npm run dev` uses a profile of its own ("Browser Dev", empty at
first). That is on purpose: the built app locks its cookies and a development copy cannot read
them (see *Keep it secure*).

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
- **Idle means idle.** With nothing happening the browser's own process uses no measurable CPU.
  Background tabs draw no frames and their timers are slowed, as in Chrome.
- **Filter lists update in a process of their own**, once a day, which exits when done. Building
  the engine needs a couple of hundred megabytes for a few seconds; none of it stays with the browser.
- **Embedded frames start cheaply.** Each frame in a page runs one small start-up script and does
  not wait on the browser for it (under a millisecond per frame, measured; it was 4.6 ms).
- **No build-up on busy pages.** A hiding rule goes into a page once, however often the page changes.
- **Animations move, they don't resize.** The sidebar slide changes the page's size once, not on
  every frame, and all motion is skipped if macOS is set to reduce motion.

## Signing in with Google on other sites

"Continue with Google" buttons open Google's sign-in window. (Chrome can instead show an account
chooser of its own; this browser can't, so that mechanism is switched off and sites fall back to
the window.) Google's one-tap prompt in the corner of a page may not appear.

## Passwords

The browser can keep passwords itself, separately from Bitwarden (for example personal ones, with
work ones in Bitwarden). They are stored on this Mac only, encrypted with a key macOS keeps in your
keychain, and never synced anywhere.

- **Saving:** sign in to a site and the browser asks whether to save the password (Save / Not Now /
  Never for This Site). Private windows never ask. Turn the question off in Settings → Privacy.
- **Filling in:** click into a sign-in field on a site with a saved password and a menu offers the
  accounts. Nothing is put into the page until you choose one, and a password is only ever offered
  on the exact site it was saved for.
- **Managing:** Library → Passwords: search, show, copy, delete. Show and Copy ask for Touch ID on
  Macs that have it; a copied password is cleared from the clipboard after a minute.
- **Back them up:** Library → Passwords → *Export…* writes them to a file this browser, Chrome and
  Bitwarden can read back. These passwords can only be unlocked with a key in this Mac's
  keychain; if that key is ever gone (new Mac, keychain reset), the export is the only way back.
  The file is plain text, so treat it as you would a list of passwords on paper.
- **Import from Arc (or Chrome):** in Arc open `arc://password-manager/settings` → *Export
  passwords*, then Library → Passwords → *Import…* and pick that file. Let the browser move the file
  to the Trash afterwards: it holds every password as plain text.

Because the app is built on your own Mac without an Apple developer certificate, macOS may ask
again for permission to use the keychain item after you install a new build. Choose Always Allow.

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

No browser is leak-proof, and a browser you build yourself has weak points the big ones don't.
This is what is in place, what is not, and what to do about it.

### The one thing that matters most: engine updates

Websites are kept away from your files, and from each other, by the engine (Chromium). Chromium
fixes security holes every week or two; Chrome and Arc install those fixes by themselves. **This
browser only gets them when you rebuild it on a newer engine.** A copy that is months old can be
taken over by a malicious page or ad using a hole that is already public.

The browser looks once a day for a newer engine. When there is one, an orange shield appears at
the bottom of the sidebar and Settings → Security shows what to run:

```bash
git pull
```

```bash
npm run engine:update
```

```bash
npm run dist:mac:arm64
```

(`npm run dist:mac:x64` on the Intel Mac), then replace the app with the new one from `dist/`.
`npm run engine:update` moves to the newest release of the engine line you are on, which is the
low-risk step. When that line stops receiving fixes, Settings says so and the command becomes
`npm run engine:update -- --latest`; a new line can need small code changes, so run `npm test`
after it.

The engine comes from https://github.com/castlabs/electron-releases (the build with Widevine).
It follows official Electron, sometimes by days and sometimes by weeks, so even an up-to-date copy
of this browser can be behind Chrome. For that reason, **use Chrome or Safari for links you don't
trust** (unexpected email links, shady streaming or download sites).

### What protects you

- **Every page is sandboxed and isolated** from the browser and from other sites, the same way
  as in Chrome. Pages get no access to your files or to the browser's controls.
- **The browser's own interface cannot be replaced by a web page.** The sidebar, command bar,
  Library and find bar refuse to navigate, open windows or embed pages, and the controls behind
  them answer only to the interface's own file.
- **Broken or forged certificates are refused**; there is no "proceed anyway".
- **Permissions are asked per site** (camera, microphone, location, notifications, clipboard,
  screen recording, display layout) and remembered; everything not on that list is refused.
- **Links that open other apps** (`zoommtg:`, `slack:`, `mailto:`, `msteams:` …) never open
  silently. The browser asks first, naming the site, the app and the link, and Return or Escape
  cancel. *Always Open* is remembered for that site and that kind of link only (reset it in
  Settings → Site Permissions). Links that would connect the Mac to a file server or another
  computer (`smb:`, `afp:`, `vnc:`, `ssh:` …) or open local help pages and scripts are refused
  outright, as is anything asked for by content embedded in a page.
- **Links handed over by other apps** are only opened if they are web addresses.
- **Extensions**: only from the Chrome Web Store, and adding one first shows what it will be able
  to read. Private windows run without extensions.
- **Saved passwords** are stored encrypted with a key in the macOS keychain, filled in only after
  you choose one, and only on the exact site they were saved for. Showing or copying one asks for
  Touch ID. **A Mac without Touch ID has no such check**: anyone at the unlocked keyboard can
  open Library → Passwords and read them, so lock the screen when you step away.
- **Sign-ins (cookies) are locked on disk** with the same keychain key, like in Chrome. A program
  that copies the browser's files gets nothing it can use. See *The keychain key* below.
- **Private windows** keep nothing on disk: no history, cookies, cache or site icons.
- **The built app cannot be started in a debugging mode.** Other programs on the Mac cannot run
  it as a script engine, attach a debugger to it or open a remote-control port, which is how
  malware borrows a browser's keychain and camera access.

### What it does not have

- **No Safe Browsing.** Chrome and Arc warn before known phishing and malware pages. This browser
  does not. Shields blocks many bad domains, but that is not the same thing. Check the address
  before typing a password; Bitwarden refusing to offer a login is a good sign you are on a fake.
- **No download scanning.** Every download is marked as coming from the internet, so macOS
  Gatekeeper checks apps, installers and scripts the first time you open them, but nothing warns
  about a dangerous file before that. To see the mark on a file:
  `xattr -p com.apple.quarantine ~/Downloads/NAME`.
- **Locked cookies stop file thieves, not everything.** Malware that gets you to type your Mac
  password into its own window can ask the keychain for the key. Some sites also keep sign-in
  tokens outside cookies, and those, like history and cache, are stored readable (in Chrome
  too). Keep FileVault on, and don't run software you don't trust.
- **Not signed by Apple.** The app has a local signature only, so macOS does not vouch for it and
  cannot notice if another program replaces it.
- **Third-party cookies and fingerprinting** are not blocked beyond what Shields' lists catch.
- **Extension support is unofficial** (it re-creates Chrome's extension system), so an extension
  may behave slightly differently than in Chrome. Keep the list short.

### The keychain key

The browser keeps exactly one thing in your macOS keychain: an entry called **Browser Safe
Storage**. It holds the key that locks your cookies and the passwords saved in the browser. The
browser creates and reads that one entry and nothing else; it cannot see or remove any other
entry (Wi-Fi, other apps, iCloud Keychain), and it never deletes its own.

- **macOS may ask for your Mac password** the first time a newly built copy opens ("Browser
  wants to use your confidential information stored in Browser Safe Storage"). Enter it and
  choose **Always Allow**. Each rebuild counts as a new app to macOS, so expect it again after
  updating.
- **If you choose Deny by mistake, nothing is lost.** Before opening any profile the browser
  checks that it has the right key. Without it, it stops and offers *Quit*; open it again and
  choose Always Allow. (Without this check the engine would throw away every sign-in it could
  not unlock.)
- **Don't delete "Browser Safe Storage"** in Keychain Access, and export your saved passwords
  (Library → Passwords → *Export…*) before moving to a new Mac or resetting the keychain. A lost
  key means signing in to sites again, and saved passwords that can't be read.
- **Never go back to a build from before cookie locking** (anything older than this change), and
  don't point one at this profile. A copy that cannot unlock the cookies deletes them all.
  `npm run dev` is safe: it switches to its own profile by itself.
- The first launch with locking writes the cookies you already had again, locked, before any
  page loads. It takes a moment once per profile.

### What the browser contacts by itself

Nothing about your browsing is reported anywhere. Without you asking, it only fetches:

- filter lists for Shields (GitHub),
- the daily engine check (GitHub; can be switched off in Settings → Security),
- Widevine, the protected-video component (Google's update servers),
- updates for the extensions you installed (Chrome Web Store),
- the icons of sites you have open.

Translation sends a page's text to Google Translate only when you ask for it. What you type in
the address bar is matched against your own history on this Mac; nothing is sent until you
press Enter.

### For work

- Give work its own profile (a space with its own cookies) so work and personal sign-ins never
  mix, and keep work passwords in Bitwarden.
- If your employer manages your Mac or requires an approved browser, this one will not qualify:
  it has no management, no enforced updates and no audit trail. Ask before using it for
  anything covered by a security policy.
- Lock the screen when you walk away; anyone at the keyboard has your open sessions.

## Project layout

```
src/main/       Electron main process: window, tabs, menu/shortcuts, permissions, extensions
src/preload/    Bridge between the UI and the main process
src/renderer/   React UI: sidebar and command bar
src/shared/     Types and URL handling shared by both sides
```

`npm test` runs the unit tests and `npm run typecheck` checks types.
