# CLAUDE.md — Mida

Handoff for any Claude working on this repository. Read all of it before changing anything. When you finish a
meaningful change, update the relevant section (especially "Decisions log", "Known limitations" and "Roadmap").

---

## 1. What this is

**Mida** is a locally run Windows desktop app that shows Destiny 2 companion websites in one
window, so players don't need a browser full of tabs: a toggleable sidebar of **modules** on the left, the chosen
site on the right. It was started on 30 Sep 2026 by the owner of **seals.report** (https://d2-seals-report.vercel.app,
repo `cee86/d2-seals-report`), one of the starter modules. It began life in that repo's `desktop/` folder as
"Companion Hub" and moved here, renamed **Mida** by the owner, the same day.

The app is **not affiliated with Bungie** or with any of the sites it shows. Keep it that way; don't imply official
status or use other sites' artwork as our own.

## 2. Working with the owner (read this carefully)

* **Essentially zero coding experience.** Explain in plain language; say what they'll see, not how it works inside,
  unless asked.
* **Security matters to them a lot.** Nothing may compromise their computer or anyone else's. Keep secrets out of
  code and chat, validate every input, don't weaken the rules in §5.
* **They like a recommendation with its reason**, then decide. When a request is ambiguous, pick the most sensible
  reading, say the assumption in one line, and build it.
* **Be honest about uncertainty**, especially about how third-party sites behave inside the app (see §7).
* They like to batch changes and give design direction with screenshots. Confirm before pushing to `main`.
* They care about usage/cost: prefer focused changes over sprawling exploration.

## 3. Tech stack

* **Electron** (`^44`) + **electron-builder** (`^26`), both dev dependencies only; plain JavaScript (CommonJS in the
  main process), plain HTML/CSS for the app's own screen, no frameworks. `package-lock.json` is committed and CI uses
  `npm ci`, so builds use exactly the tested versions. Keep dependencies minimal on purpose.
* **Why Electron** (owner asked for a recommendation): each site needs a real browser page (companion sites,
  seals.report included, refuse to load inside an iframe: X-Frame-Options / frame-ancestors). Electron's
  `WebContentsView` gives one per module, kept alive in the background, with the same Chromium the sites are tested
  on. Tauri would be a far smaller download, but its multi-webview support was still marked unstable. Trade-off: a
  ~100 MB installer and more memory per open module.
* **Builds:** `.github/workflows/build.yml` builds a Windows NSIS installer on every push (and on demand), uploaded as
  the run's `mida-windows` artifact. The owner installs nothing locally. Not code-signed yet, so Windows
  SmartScreen warns on first install ("More info" > "Run anyway").
* **Updates** (v0.2 auto, v0.3 ask-first at the owner's request: "the app shouldn't automatically update"):
  `electron-updater` (the one runtime dependency) only *checks* GitHub releases of `cee86/mida` by itself, at start and
  every 4 hours (installed app only, never `npm start`). When a new version is found: a pop-up ("Update available",
  Update now / Later; once per version per session, never over the first-run picker or another dialog, shown when it
  closes) and a banner at the bottom of the sidebar that stays until the app is updated (collapsed sidebar: icon only).
  Choosing Update downloads inside the app (banner shows %, checked against the release's sha512), then Mida restarts
  itself on the new version (silent reinstall into the same folder). A failed download shows "Download failed · Click to
  try again". Nothing downloads or installs without the user's click, and no one re-downloads installers from GitHub.
* **Releasing an update (do this for every change the owner should get):** raise `version` in `package.json`
  (semver: fixes 0.3.1, features 0.4.0) and push to `main`. The workflow sees there's no `v<version>` release yet,
  pushes the tag (GitHub won't publish a release for a missing tag), then runs `electron-builder --publish always` with
  the run's own `GITHUB_TOKEN` (`contents: write`), creating a published release with the installer, its blockmap and
  `latest.yml`. A newer push cancels a build still running. Pushes that don't change the version only build a test
  installer; nobody's app changes. Never re-use a version number. Updates need the repo to be **public** (the owner chose
  this over a separate public releases repo, so no token ever ships in the app or needs renewing).

```bash
npm install
npm start      # run the app
npm run dist   # Windows installer into dist/ (on Windows; CI does this)
```

Testing in the Claude Code cloud workspace: `npm install` downloads Electron; run under `xvfb-run` and drive it with
the globally installed Playwright (`_electron.launch({ executablePath: 'node_modules/electron/dist/electron',
args: ['--no-sandbox', '--user-data-dir=<scratch>', '.'] })`). Pick the shell page with
`app.windows().find(w => w.url().startsWith('file:'))` (module views also count as windows), and screenshot a module
view with `webContents.capturePage()` (page screenshots only show the shell). Keyboard shortcuts can't be simulated
that way (they're read from real input events). The workspace can't reach the companion sites.

## 4. How it works (file map)

```
src/main.js       The app (also the updater: setUpUpdates / downloadUpdate). Window + "shell" page; one WebContentsView per module laid over the shell's stage area,
                  created on first open and kept alive (hidden) afterwards; the active one is shown at the rectangle
                  the shell reports ("stage:rect"), hidden while a shell dialog is open ("overlay") or an error shows.
                  Status per module (loading, title, url, back/forward, error) is pushed to the shell. Shortcuts via
                  before-input-event on every page; mouse back/forward via app-command. Favicons are fetched once and
                  saved as small data URLs. Window size/position remembered.
src/modules.js    Built-in site list (CATALOGUE) and pure checks: cleanUrl (https only, no credentials), cleanName,
                  cleanIcon, sameSite (handles shared hosts like *.vercel.app), isSignInUrl, isWebUrl.
src/store.js      settings.json in the app's data folder: { firstRunDone, modules, activeId, sidebarExpanded, zoom,
                  window }. Everything read back is cleaned; saves are debounced and written via a temp file.
src/preload.js    window.hub: the fixed list of actions the shell may ask for. Module pages have no preload.
src/shell/        The app's own screen (index.html, shell.css, shell.js): sidebar, toolbar, stage messages
                  (no modules / couldn't load), first-run "Welcome" picker, "Add a module" dialog.
```

**Modules:** starters ticked on first run: seals.report, light.gg, DIM. Also offered: raid.report, dungeon.report,
D2 Foundry, Braytech, Today in Destiny. Any https site can be added (max 40). Right-click or the ⋯ button: open,
reload, open in browser, move up/down, remove.

**Shortcuts:** Ctrl+B sidebar, Ctrl+1–9 module n, Ctrl+Tab / Ctrl+Shift+Tab next/previous, Alt+Left/Right and mouse
side buttons back/forward, Ctrl+R / F5 reload (Ctrl+Shift+R ignoring cache), Ctrl+= / - / 0 zoom (per module, saved).

## 5. Security (don't weaken any of this)

* Module pages: `sandbox`, `contextIsolation`, no `nodeIntegration`, no preload, `<webview>` blocked.
* Every permission request (camera, mic, location, notifications, USB...) is refused except clipboard write,
  fullscreen and persistent storage. The shell's session refuses everything.
* Only http(s) navigation; other schemes (file:, steam:, javascript:...) are blocked, never handed to other programs.
* New windows: sign-in pop-ups to Bungie/platform sign-in hosts (`SIGN_IN_SITES`) open in-app so they can hand back;
  same-site links load in the module; a link to another module's site opens that module; anything else opens in the
  system browser (`shell.openExternal`, http(s) only).
* The shell has a strict CSP (own files only, images from data: URLs) and never inserts site text as HTML. Every IPC
  message is checked to come from the shell and validated.
* All modules share one persistent browser profile (`persist:modules`), like tabs in one browser: sign in to Bungie
  once, and sites still can't read each other's data (normal same-site rules).
* The user agent drops "Electron" and the app name so sites and sign-in pages treat it as Chrome.
* Single-instance lock: opening the app again focuses the existing window.

## 6. Design

Matches seals.report's feel: charcoal/navy palette (`--ink #0e1013`, `--char #15171b`, `--cream #f1e6d2` text,
`--mist #a39e95`), **sun orange `#f19a3f`** for focus, the current module and loading; translucent gold only for
ornament linework (heading rules). In-game-style letterspaced uppercase heading bands with a thin line below.
System fonts (Segoe UI) so nothing loads from the web. Inline stroke SVG icons, no emoji in the UI. Sentence case.
Reduced motion respected. The collapsed sidebar is an icon strip (the owner's "toggleable sidebar"; assumption).

## 7. Known limitations and things to verify

* **Unverified on real sites** (the cloud workspace can't reach them): Bungie sign-in inside DIM and seals.report,
  each site's behaviour, favicons. Google sign-in may be refused (Google often blocks embedded browsers).
* Unsigned installer (SmartScreen warning on first install); default Electron app icon.
* The auto-update flow (download, restart, silent reinstall) couldn't be run end to end from the cloud workspace
  (no Windows); verify it on the owner's PC with the first release after v0.3.0. Earlier builds have no working
  updater, so everyone installs v0.3.0 by hand once.
* Memory grows with each opened module (they stay alive by design).

## 8. Decisions log

* v0.1 (30 Sep 2026): Electron over Tauri (reasons in §3); modules load on first open and stay alive; one shared
  browser profile; first-run picker with seals.report, light.gg and DIM ticked; custom https sites allowed; moved from
  `cee86/d2-seals-report/desktop` to its own repo at the owner's request; the owner named the app **Mida** (the repo name).
* v0.2.0 (30 Sep 2026): auto-update from GitHub releases; the owner chose to make the repo public for it. Never
  published (its release build failed: GitHub needs the tag to exist first, now fixed in the workflow).
* v0.3.0 (30 Sep 2026): updates ask first (pop-up + sidebar banner until updated) instead of downloading and installing
  by themselves (owner's request). The first published release: https://github.com/cee86/mida/releases/tag/v0.3.0

## 9. Roadmap

1. Test on the owner's PC: each starter site, Bungie sign-in, downloads (DIM exports).
2. App icon (the seals.report Crest or something of Mida's own; ask the owner).
3. Drag to reorder modules; optional preloading of all modules at start; unloading modules unused for a while.
4. Code signing (removes the first-install warning).
