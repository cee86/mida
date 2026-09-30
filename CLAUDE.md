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

* **Tauri 2** (Rust core in `src-tauri/`) using **Windows' built-in WebView2** (the engine behind Edge), plus plain
  HTML/CSS/JS for the app's own screen (`src/shell/`), no frameworks. The first builds (Electron, versions 0.1–0.3)
  were ~400 MB installed; the owner found that far too big, so the app was rebuilt on Tauri and **restarted at v0.1.0**
  (see Decisions). Installer 1.83 MB; installed a few MB.
* **Rust dependencies** (`src-tauri/Cargo.toml`, `Cargo.lock` committed): tauri (feature **`unstable`**, needed for
  several pages in one window: `Window::add_child`; still marked experimental by Tauri), plugins opener (links to the
  system browser), single-instance, updater; serde/serde_json/url/tokio; on Windows only webview2-com + windows (same
  versions Tauri uses) for shortcuts inside pages. npm: only `@tauri-apps/cli` (dev). Keep dependencies minimal.
* **Builds:** `.github/workflows/build.yml` on `windows-latest`: build, then **`scripts/smoke-test.ps1`** runs the real
  app with seals.report, light.gg and DIM, clicks a module, presses Ctrl+3 inside a page and Ctrl+B, and saves
  screenshots (artifact `smoke-test`; the log prints how many colours each shot's site area has, a quick sign that a
  page drew). The screenshots are also force-pushed to the `ci-screenshots` branch; read them with
  `git fetch origin +ci-screenshots:refs/remotes/origin/ci-screenshots` (note the `+`: the branch is replaced each run)
  and `git archive origin/ci-screenshots | tar -x -C <dir>`. Installer artifact `mida-windows`. Not code-signed, so SmartScreen warns on first install.
* **Updates** (Electron 0.3 behaviour kept, owner's request "the app shouldn't automatically update"): the app only *checks*
  `https://github.com/cee86/mida/releases/latest/download/latest.json` at start and every 4 hours (installed app only).
  New version → pop-up ("Update available", Update now / Later; once per version per session, never over another
  dialog) + a sidebar banner until updated. Update = download in the app with %, **signature checked** against the
  public key in `tauri.conf.json` (`plugins.updater.pubkey`), then the installer runs in passive mode and Mida reopens.
* **Update signing key:** the private half lives only in the repo secret **`TAURI_SIGNING_PRIVATE_KEY`** (no
  password). Never commit it or paste it in chat. Losing it means installed copies can't update (they'd need one manual
  reinstall of a build with a new key). Anyone who has it could sign an update, but could only deliver it through a
  release on `cee86/mida`, so both the key and the repo must be protected.
* **Releasing an update (do this for every change the owner should get):** raise `version` in `package.json` (Tauri
  reads it: `"version": "../package.json"`; semver: fixes 0.1.1, features 0.2.0) and push to `main`. The workflow sees
  no `v<version>` release, builds signed (`createUpdaterArtifacts`), writes `latest.json` (version, signature, installer
  URL) and runs `gh release create --latest` (creates the tag too; `--latest` because installed copies read
  `releases/latest`, which GitHub would otherwise give to the highest version number). Test builds pass
  `--config '{"bundle":{"createUpdaterArtifacts":false}}'` so they need no key. A newer push cancels a running build.
  Never re-use a version number. The repo must stay **public** so installed apps can download releases.

```bash
npm install
npm start      # tauri dev (needs Rust; on Linux also the WebKitGTK dev packages)
npm run dist   # tauri build (Windows installer on Windows; CI does this)
cd src-tauri && cargo test --lib   # the address and site checks
```

Testing in the Claude Code cloud workspace: Rust is installed; `apt-get update && apt-get install
libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libsoup-3.0-dev xdotool imagemagick` lets you build a Linux copy
(`npx tauri build --debug --no-bundle`) and drive it on Xvfb with xdotool, screenshots with `import -window root`
(settings live in `~/.config/report.seals.mida/`). Good for the shell, dialogs, menus and IPC. **Page placement can't
be judged on Linux:** WebKitGTK stacks child pages and splits the window's height with the shell; Windows places them
exactly. Trust the Windows smoke test for layout. The workspace can't reach the companion sites (pypi.org is reachable
if you need any real https page). `cargo check --target x86_64-pc-windows-msvc` fails in `ring` (needs MSVC), so
Windows-only code (`win_keys.rs`) is only compiled by CI.

## 4. How it works (file map)

```
src-tauri/src/lib.rs      The app. Window "main" with the shell page ("shell", sized to the window on every resize)
                          and one child page per module ("m-<id>", created on first open, kept alive and hidden).
                          The active page is placed at the rectangle the shell reports (set_stage_rect) and hidden
                          while a shell dialog is open (set_overlay). Status per module (loading, title, url) comes from
                          page-load and title-change events and is pushed to the shell ("status"); everything else is
                          "state". Native right-click menu per module. Updater. Window place saved on close.
                          Threads: pages are created only off the main thread (WebView2 freezes otherwise) and our
                          locks are never held while calling a page or the window.
src-tauri/src/modules.rs  Built-in site list (CATALOGUE) and pure checks with tests: clean_url (https only, no
                          credentials), clean_name, same_site (handles shared hosts like *.vercel.app), is_sign_in, is_web.
src-tauri/src/store.rs    settings.json in the app's config folder (%APPDATA%\report.seals.mida): { firstRunDone,
                          modules, activeId, sidebarExpanded, window }. Cleaned on read; saved via a temp file.
src-tauri/src/win_keys.rs Windows only: Ctrl+B, Ctrl+1-9, Ctrl+Tab while a module page has the keyboard
                          (WebView2 AcceleratorKeyPressed). Reload/back/zoom keys are the page's own.
src-tauri/tauri.conf.json Product, version (from package.json), CSP, NSIS installer (per-user, installs WebView2 if
                          missing), updater endpoint + public key. capabilities/shell.json: the shell may only listen to
                          events; module pages get nothing.
src/shell/                The app's own screen: index.html, shell.css, shell.js (unchanged from Electron days) and
                          bridge.js (window.hub over Tauri's invoke/listen, plus the shell's shortcut keys).
scripts/smoke-test.ps1    CI only: runs the built app on Windows and takes screenshots.
art/icon.svg              Mida's icon source (gold ring, three module dots, sun-orange star). Regenerate the files in
                          src-tauri/icons with `npx tauri icon art/icon.svg` (keep only the ones tauri.conf lists).
```

**Modules:** starters ticked on first run: seals.report, light.gg, DIM. Also offered: raid.report, dungeon.report,
D2 Foundry, Braytech, Today in Destiny. Any https site can be added (max 40). Right-click or the ⋯ button: open,
reload, open in browser, move up/down, remove. The sidebar shows each module's first letter (favicons were dropped
with Electron; WebView2's favicon event could bring them back).

**Shortcuts:** Ctrl+B sidebar, Ctrl+1–9 module n, Ctrl+Tab / Ctrl+Shift+Tab next/previous, Alt+Left/Right and mouse
side buttons back/forward, Ctrl+R / F5 reload, Ctrl+= / - / 0 zoom (the page's own; not remembered since the move to Tauri).

## 5. Security (don't weaken any of this)

* Module pages can't call the app: every command checks the caller is the page labelled "shell", Tauri refuses IPC
  from remote origins anyway, and the only capability (`shell.json`) is for the shell.
* Every permission request (camera, mic, location, notifications, clipboard read, USB...) is refused
  (`on_permission_request` → Deny), in module pages and the shell.
* Only http(s) navigation in module pages; the shell can't navigate anywhere but its own files.
* New windows: sign-in pop-ups to Bungie/platform sign-in hosts (`SIGN_IN_SITES`) open in-app so they can hand back;
  same-site links load in the module; a link to another module's site opens that module; anything else opens in the
  system browser (opener plugin, http(s) only).
* The shell has a strict CSP (tauri.conf.json: own files, data: images, IPC only) and never inserts site text as HTML.
* All pages share WebView2's one profile, like tabs in one browser: sign in to Bungie once; sites still can't read each
  other's data. WebView2 presents itself as Edge, so sites and sign-in pages treat it as a normal browser.
* Updates are signature-checked (see §3); single-instance: opening Mida again focuses the existing window.

## 6. Design

Matches seals.report's feel: charcoal/navy palette (`--ink #0e1013`, `--char #15171b`, `--cream #f1e6d2` text,
`--mist #a39e95`), **sun orange `#f19a3f`** for focus, the current module and loading; translucent gold only for
ornament linework (heading rules). In-game-style letterspaced uppercase heading bands with a thin line below.
System fonts (Segoe UI) so nothing loads from the web. Inline stroke SVG icons, no emoji in the UI. Sentence case.
Reduced motion respected. The collapsed sidebar is an icon strip (the owner's "toggleable sidebar"; assumption).

## 7. Known limitations and things to verify

* **Confirmed by the owner on their PC (v0.1.0, 30 Sep 2026):** "everything seems to be functioning", install size
  "extremely small", resource use very low. Not specifically reported on yet: Google sign-in (Google often blocks
  embedded browsers) and the in-app update itself (first real test comes with v0.1.1).
* **Tauri's several-pages-in-one-window feature is marked experimental** (`unstable`); watch for fixes/changes when
  updating Tauri.
* No custom "couldn't load" screen any more: WebView2 shows its own error page inside the module. The shell's error
  panel code remains but isn't triggered. Back/forward buttons are always enabled (Tauri doesn't report history).
* Moving from the Electron build (0.3.0) to the Tauri one can't happen through the old updater (it looks for latest.yml,
  and its releases were deleted), so anyone on it uninstalls "Mida" and installs the Tauri v0.1.0 by hand once. Different
  install folders:
  Electron `%LOCALAPPDATA%\Programs\mida`, Tauri `%LOCALAPPDATA%\Mida`.
* Unsigned installer (SmartScreen warning on first install).
* Memory grows with each opened module (they stay alive by design).

## 8. Decisions log

**Electron era (all 30 Sep 2026; releases and version numbers retired):**

* Electron 0.1: Electron over Tauri (its several-pages-per-window support was mature; Tauri's was experimental); modules load on first open and stay alive; one shared
  browser profile; first-run picker with seals.report, light.gg and DIM ticked; custom https sites allowed; moved from
  `cee86/d2-seals-report/desktop` to its own repo at the owner's request; the owner named the app **Mida** (the repo name).
* Electron 0.2.0: auto-update from GitHub releases; the owner chose to make the repo public for it. Never
  published (its release build failed: GitHub needs the tag to exist first, now fixed in the workflow).
* Electron 0.3.0: updates ask first (pop-up + sidebar banner until updated) instead of downloading and installing
  by themselves (owner's request). Published, then deleted by the owner when the Tauri build replaced it.

**Tauri era:**

* v0.1.0 (30 Sep 2026): **Electron -> Tauri** at the owner's request ("the install size is massive"): Electron always
  ships its own Chrome (~280 MB of the ~285 MB app); Tauri uses Windows' WebView2 instead. Same screen, same features and
  security rules; ask-first updates now signature-checked; new app icon (art/icon.svg). Built on branch `tauri` and
  tried on GitHub's Windows machine (smoke test: pages placed right, module switching, Ctrl+3 inside a page, Ctrl+B)
  before replacing main. The owner deleted the Electron releases and chose to start the numbering again at v0.1.0.

## 9. Roadmap

1. Test on the owner's PC: each starter site, Bungie sign-in, downloads (DIM exports).
2. Favicons in the sidebar (WebView2's favicon event) and a couldn't-load panel from WebView2's navigation result.
3. Drag to reorder modules; optional preloading of all modules at start; unloading modules unused for a while.
4. Code signing (removes the first-install warning).
