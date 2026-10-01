# CLAUDE.md — Mida

Handoff for any Claude working on this repository. Read all of it before changing anything. When you finish a
meaningful change, update the relevant section (especially "Decisions log", "Known limitations" and "Roadmap").

---

## 1. What this is

**Mida** is a locally run Windows desktop app that shows game companion websites in one window, so players don't
need a browser full of tabs: a toggleable sidebar of **modules** on the left, the chosen site (or the profile's Home
page) on the right. Since v0.2 everything is organised in **profiles**, one per game: Destiny 2 profiles get Mida's
recommended sites; profiles for any other game start empty and add their own. It was started on 30 Sep 2026 by the owner of **seals.report** (https://d2-seals-report.vercel.app,
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
  system browser), single-instance, updater; serde/serde_json/url/tokio; reqwest (already in the app through the
  updater; fetches site icons) and base64; on Windows only webview2-com + windows (same versions Tauri uses; features
  KeyboardAndMouse, Shell, Com) for src-tauri/src/win.rs. npm: only `@tauri-apps/cli` (dev). Keep dependencies minimal.
* **Builds:** `.github/workflows/build.yml` on `windows-latest`: build, then **`scripts/smoke-test.ps1`** runs the real
  app (v2 settings: one profile with seals.report, light.gg, DIM and a broken `.invalid` site) and screenshots: start
  at 80% zoom, click light.gg, Ctrl+3 inside a page, a module menu over the site (page picture), settings over the
  blurred site, the error panel, Home with fetched icons, then a second launch with the address bar hidden (floating
  controls). Screenshots are the artifact `smoke-test`. The screenshots are also force-pushed to the `ci-screenshots` branch; read them with
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
* **Releasing an update (do this for every change the owner should get):** raise `version` in `package.json` and `package-lock.json` (Tauri
  reads it: `"version": "../package.json"`; semver: fixes 0.1.1, features 0.2.0) and push to `main`. Leave
  `src-tauri/Cargo.toml`'s version at 0.0.0: changing it invalidates the Rust build cache (v0.4.2). CI speed (v0.4.2):
  separate release/test caches, test builds without LTO (CARGO_PROFILE_RELEASE_LTO=false, 16 codegen units), the screenshot run
  only when started by hand (Actions > Build > Run workflow, "screenshots" ticked; the owner chose speed, v0.5), no build for .md/art-only pushes. A build-time
  check reports whether MIDA_BUNGIE_API_KEY is 32 hex characters and Bungie accepts it (never printing it); the
  secret belongs in the mida repo (it was once added to seals.report by mistake, giving builds an empty key). The workflow sees
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
if you need any real https page). **Windows type-check from Linux: `scripts/check-windows.sh`** (clang-cl + llvm-lib
18 and the msvc Rust target; stub C headers for `ring`), seconds instead of a CI round trip. Linux quirks seen: a page
created at start-up can leave the shell blank, and zooming the shell before it is on screen blanks it (the app only
zooms the shell when Interface size isn't 100%). Test Linux flows starting on Home.

## 4. How it works (file map)

```
src-tauri/src/lib.rs      The app. Window "main" holds: the shell page ("shell", sized to the window on every resize),
                          one child page per module of the current profile ("m-<id>", created on first open, kept alive
                          and hidden; all closed when switching profile) and, with the address bar hidden, the floating
                          site controls ("controls", transparent, recreated after each new page so it stays on top).
                          The active page sits at the rectangle the shell reports (set_stage_rect, times Interface size)
                          and is hidden while a shell menu/dialog is open (set_overlay) or it has an error.
                          freeze_page returns a JPEG of the page (Windows) that the shell shows in its place meanwhile.
                          Status per module (loading, title, url, error) is pushed as "status"; everything else "state"
                          (emit_filter to shell + controls only). Site icons: after a page loads, eval_with_callback
                          asks it for its icon (apple-touch-icon, biggest icon, /favicon.ico), reqwest fetches it
                          (https, image, <110 KB) and it's kept as a data URL on the module. Pages start at the Site
                          zoom pref (80%). Updater, profiles, prefs, shortcuts, window place.
                          Threads: pages are created only off the main thread (WebView2 freezes otherwise) and our
                          locks are never held while calling a page or the window.
src-tauri/src/win.rs      Windows only (WebView2 via webview2-com): shortcuts inside pages (AcceleratorKeyPressed:
                          Ctrl+B, 1-9, Tab, comma), load results (NavigationCompleted: network/certificate failures and
                          HTTP 500/502/504 -> PageError; 503 left alone for maintenance / "checking your browser"
                          pages; cancelled/unknown ignored, e.g. downloads), crashes (ProcessFailed), page pictures
                          (CapturePreview JPEG into an IStream).
src-tauri/src/modules.rs  GAMES, per-game CATALOGUE and pure checks with tests: clean_url (https only), clean_name,
                          clean_text, clean_image (data:image only, size-limited; SVG only for site icons), same_site,
                          is_sign_in, is_web.
src-tauri/src/store.rs    settings.json in %APPDATA%\report.seals.mida, version 2: { firstRunDone, profiles[{ id, name,
                          image, game, gameName, modules, activeId ("home" or a module) }], defaultProfile,
                          currentProfile, sidebarExpanded, window, prefs }. Version 1 files (Mida 0.1) become a
                          "My profile" Destiny 2 profile. Prefs (clean_prefs): theme dark|black|light, colorway preset or
                          custom (2-3 colours, accent, angle), showAddressBar, controlsCorner, controlsAutohide,
                          reduceMotion system|on|off, uiScale 90-150, highContrast, siteZoom 50-150 (default 80).
src-tauri/tauri.conf.json Product, version (from package.json), CSP, NSIS installer (per-user, installs WebView2 if
                          missing), updater endpoint + public key. capabilities/shell.json: the shell and controls may
                          only listen to events; module pages get nothing.
src/shell/index.html etc. The app's own screen. shell.js: sidebar (profile chip + menu, Home, draggable modules, update
                          banner, Add a module, Settings), toolbar, stage (Home page, error panel, page picture),
                          themed menus (openMenu; freezes the page when a menu overlaps it), dialogs (wizard for first
                          run / new profile, edit profile, confirm, rename, add, settings with Personalization /
                          Accessibility / About tabs, update). bridge.js: window.hub over Tauri invoke/listen and the
                          shortcut keys. theme.js: COLORWAYS and applyTheme (data-theme/contrast/motion + CSS vars),
                          shared with controls.html/.css/.js (the floating site controls). icon.png for About.
                          CSP note: inline style="" attributes are blocked; set styles through element.style (el()'s
                          `style: {...}` does this).
scripts/smoke-test.ps1    CI only: runs the built app on Windows and takes screenshots.
scripts/check-windows.sh  Type-checks the Windows build from Linux.
art/icon.svg              Mida's icon source. Regenerate src-tauri/icons with `npx tauri icon art/icon.svg` (keep only the
                          ones tauri.conf lists); src/shell/icon.png is the 128px one.
```

**Side by side (panes):** a profile shows one page, or two side by side (`profile.panes` = [left, right], `split` =
left share 20-80%). The shell draws the panes (`renderStage` in shell.js: pane elements kept between renders, a head
with swap/close only when split, a divider) and reports the pane bodies' rectangles left to right (`set_panes`); the
app places pane i's site at rectangle i (`pane_rect`), so pages never lag behind a re-render in single mode. Opening a
page while split replaces the open pane. Ways in: drag a module or tab from the sidebar onto the page area (drop zones:
left / open here / right; the pages are frozen to pictures during the drag so the drop reaches our screen), "Open
side by side" in a module or tab menu. Dragging the divider freezes the pages too. On Windows, clicking into a site
makes it the open pane (WebView2 GotFocus -> `page_focused`). `clean_profile` drops panes that no longer make sense
(a module removed, a tab switched off). Freeze pictures are per pane (`freeze_page(id)`).

**Built-in tabs** (Destiny 2 profiles; `TABS` in modules.rs, `profile.tabs` = the ones switched on, None = all;
Settings -> Tabs, or "Hide this tab"): drawn by the shell itself from `src/shell/tabs.js` (an ES module; shell.js calls
`window.midaTabs.mount/update`). Featured (this week's raids/dungeons, Dreaming City, Distortion with live countdowns,
rotators) and the RAD assistant (every raid/dungeon: encounters with their loot, armor, exotic; empty "Tips"/"Map"
places and an asset-pack note for content to come) work offline. `src/shell/d2/` holds **unchanged copies** of
seals.report's lib/rotations.js, rotators.js and loot-tables.js: copy them again when seals.report changes them (the
admin's rotator corrections live in seals.report's Redis and don't reach Mida yet; a small public endpoint could fix
that; Featured now asks seals.report's `/api/mida/rotators` once a run through `d2_rotators`).

**Bungie sign-in** (src/auth.rs, v0.4): Mida's own Bungie app (Confidential; redirect
`https://d2-seals-report.vercel.app/api/mida/callback`; scopes: read Destiny 2 inventory/vault, move or equip gear). Its
client secret lives only in seals.report's Vercel env (`MIDA_CLIENT_ID`/`MIDA_CLIENT_SECRET`). Flow: Mida listens once
on 127.0.0.1:<random port> (`auth::listen`/`wait_for_code`, 5 min, only `/callback` with the matching random state),
opens `seals.report/api/mida/login?port&state` in the system browser -> Bungie -> `/api/mida/callback` -> redirect to the
listener with the code -> Mida POSTs it to `/api/mida/token` (the server swaps it with the secret, stores nothing) ->
the public `/User/GetMembershipsById/{membership_id}/254/` (the Bungie.net id the token response carries; v0.4.0 used `GetMembershipsForCurrentUser`, which needs a permission Mida's app doesn't have, and every sign-in failed) -> `auth::pick_membership` (primary / cross save). Bungie errors show their code (12 = a permission missing from the app on bungie.net). Tokens: `account.bin` next to
settings.json, encrypted with Windows DPAPI for the current user (memory only on non-Windows test builds); refreshed
through `/api/mida/token` when within 60 s of expiry; signed out when the refresh ends. The shell never sees a token.
API key: `option_env!("MIDA_BUNGIE_API_KEY")`, from the repo secret of that name in the build workflow (builds without
it can't sign in and say so). The Bungie account is shared by all profiles. Settings -> Tabs shows it (sign in/out).

**Destiny 2 data** (src/bungie.rs): `load_manifest` slims DestinyInventoryItemLiteDefinition + DestinyObjectiveDefinition
to what the tabs use and keeps it in `manifest/<version>.json` (downloaded again only after a game update; memory-cached
per run). `shape_inventory` (components 100,102,200,201,205,300: weapons, armor, ghost, sparrow, ship buckets on each
character and the vault bucket 138197802), `shape_activity` + `season` + `alerts` (100,104,200,201,202,300,301: the
Quests bucket split into quests and bounties, season rank from the season pass's reward/prestige progressions, the
artifact, Bungie's global alerts as plain text). `transfer` goes character -> vault -> character; `equip` brings the item
over first. All unverified against live data (no Bungie access from the build workspace): field names follow Bungie's
docs. **Inventory** (v0.5, `src/shell/inventory.js` + `inventory.css`, from the owner's mock-up and in-game references):
a title band on the current character's wide emblem (`secondarySpecial`) with search; a toolbar (Weapons / Armor /
General / Inventory tabs, Filters menu (tier, element, masterworked, locked, usable by this character), S/M/L item
size, Postmaster menu (pull an item: `PullFromPostmaster`), Refresh, All characters / Current only, side panel toggle);
DIM-style character emblems (emblemBackgroundPath art, class, equipped title via the title record or race, power, a
menu) and a Vault "emblem" with count / max (the vault bucket definition's itemCount); currencies (component 103)
under the characters; one row per bucket: each character's equipped item + a 3x3 of slots (empty ones drawn as corner
brackets like the game; engrams 10, no equipped), the account's consumables/mods in one wide cell (owner "account";
moved via the first character, which Bungie accepts for account buckets), then the vault. Tiles: tier colour, icon
(the ornament's when applied, `overrideStyleItemHash`), season watermark, a bottom bar with element, lock and power
(or stack count), gold edge when masterworked. Side panel (current character = click an emblem; `d2_character`):
loadout (weapons + ghost | armor), stats (component 200 `stats`, named via DestinyStatDefinition, bars out of 200),
armor set bonuses (equipped armor's `equippingBlock.equipableItemSetHash` -> DestinyEquipableItemSetDefinition
`setPerks` -> DestinySandboxPerkDefinition; field names from Bungie's docs, unverified). Single definitions come from
`bungie::entity` (memory-cached per run). View choices are kept in localStorage (`mida-inv-*`). Moves show at once
and undo on error, then a quiet re-read 6 s later. The slimmed manifest file is now `<version>-2.json` (gained
`watermark`). Quests and Seasonal hub (tabs.js: character picker, last played first; objective bars; bounty
expiry countdowns). CSP allows images from https://www.bungie.net (item icons, emblems).

**Profiles:** first run is a two-step wizard: name, optional picture (cropped to 128px WebP in the page), game (Destiny 2
or "Another game" + its name), then module picks (D2) or a note (custom). New profiles open on Home. The profile menu
(top of the sidebar) switches profiles, edits, sets the default (opened at start), creates (max 12) and deletes (with a
confirm; never the last one). Switching closes the other profile's pages. All profiles share one browser profile
(sign-ins), by design for now.

**Modules:** Destiny 2 recommendations: seals.report, light.gg, DIM ticked; raid.report, dungeon.report, D2 Foundry,
Braytech, Today in Destiny offered. Any https site can be added (max 40 per profile). Drag to reorder. Menu (right-click
or ⋯): open, reload, open in browser, rename, refresh icon, move up/down, remove.

**Shortcuts:** Ctrl+B sidebar, Ctrl+1–9 module n, Ctrl+Tab / Ctrl+Shift+Tab next/previous (Home counts as the first
stop), Ctrl+, settings, Alt+Left/Right and mouse side buttons back/forward, Ctrl+R / F5 reload, Ctrl+= / - / 0 zoom
(the page's own; Site zoom in settings sets where every page starts).

## 5. Security (don't weaken any of this)

* Module pages can't call the app: every command checks the caller is our own page ("shell"; the floating "controls"
  only for get_state, nav and key), Tauri refuses IPC from remote origins anyway, and the only capability
  (`shell.json`) is for those two pages. open_link only opens fixed Mida URLs.
* Site icons are fetched only over https, only images, size-limited, and shown with <img> (SVG can't run anything
  there). Profile pictures never leave the computer (resized in the page, stored in settings.json).
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

Matches seals.report's feel: charcoal/navy palette, cream text, an **accent colour** (sun orange `#f19a3f` in the
default Sunrise colorway) for focus, the current item and loading; translucent gold only for ornament linework
(heading rules). In-game-style letterspaced uppercase heading bands with a thin line below. System fonts (Segoe UI) so
nothing loads from the web. Inline stroke SVG icons, no emoji in the UI. Sentence case. Every colour is a CSS variable:
themes Dark / Black / Light swap the base colours, colorways (Sunrise, Arc, Void, Solar, Strand, Stasis, Crimson,
Custom) set `--accent` and the background gradient `--bg-1..3` (Light uses a soft tint of it), high contrast makes
panels solid and borders/text stronger, reduce motion stops animations. Menus and pop-ups are themed (no native menus).
Pop-ups sit over a blurred picture of the site. The collapsed sidebar is an icon strip.

**Foundry theme** (`src/shell/foundry.css`, everything scoped to `html[data-theme="foundry"]`, also loaded by
controls.html): Mida as the weapons foundry of the lore, from the owner's Deep Stone Crypt / Clovis Bray references.
Light (pearl) or Dark (graphite) via prefs.foundryMode -> `data-foundry`; the lights (`--glow`, prefs.foundryGlow) and
markings (`--mark`, prefs.foundryMark) are the player's colours (presets in theme.js FOUNDRY_COLOURS, or Custom).
Markings are CSS masks coloured by `--mark`, so every chevron/glyph follows the chosen colour. On the light version the
accent is the glow darkened 42% so focus rings read on white. The owner asked to drop the settings rail's line-art
pattern (v0.3); the sidebar has a segmented seam, a hatched marking block and a light down its inner edge.
Pearl-white architecture; thick white rounded "tube" frames (outline + rim shadow) around the site, dialogs and menus;
dark recessed "screens" for icons, avatars, the toolbar readout, the main button and the settings rail (with faint teal
line-art); teal indicator lights (`--glow`) for what's active; red markings (`--clovis`): double chevrons before
headings, stepped seams with a red diamond, glyph-code strips, big chevrons on the Home hero, the update banner.
Shapes use opposite-corner radii (e.g. 14px 4px 14px 4px). All art is our own inline SVG/gradients, no game art or
logos. Colorways don't apply (Settings shows Foundry mode and Foundry colours instead).
The site sits 8-12px inside the stage edge so the frame shows (the page is placed at #stage's rect, margins excluded).

**Retro theme** (`src/shell/retro.css`, `data-theme="retro"`): Destiny 1's menus. Deep blue-black with a faint grid,
square corners everywhere, thin white lines, letterspaced capitals over a white rule, the white selection box, white
main buttons, a gold tag. Colorways don't apply.

**Sidebar modes:** `sidebarFlyout` (default on): with the sidebar collapsed, pointing at it for 160 ms opens the full
sidebar over the page (`data-flyout="open"`: the sidebar is absolutely positioned, the grid column stays narrow, so the
page never resizes). The page is replaced by its picture while it's open (same freeze as menus); choosing a page, Esc
or leaving closes it; a menu opened from it keeps it open. `sidebarFit`: the sidebar is a card only as tall as its
contents (`data-fit`).

## 7. Known limitations and things to verify

* **Confirmed by the owner on their PC (v0.1.0, 30 Sep 2026):** "everything seems to be functioning", install size
  "extremely small", resource use very low. Not specifically reported on yet: Google sign-in (Google often blocks
  embedded browsers) and the in-app update itself (first real test: v0.1.0 -> v0.2.0).
* v0.2 features verified on Linux (wizard, profiles, custom game, menus, settings, themes, drag, rename, migration)
  and in the Windows smoke test; the page picture, icons, error panel and floating controls only exist on Windows.
* The floating controls are a small see-through page over the site: with "only when hovered" it's invisible but still
  takes clicks in its corner. Site favicons: sites that block non-browser downloads just keep their letter.
* **Tauri's several-pages-in-one-window feature is marked experimental** (`unstable`); watch for fixes/changes when
  updating Tauri.
* Back/forward buttons are always enabled (Tauri doesn't report history).
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

* v0.2.0 (30 Sep 2026, owner's batch): profiles per game (+ default), Home page, settings pop-up (Personalization,
  Accessibility, About), themes/colorways incl. custom gradient, hide the address bar with floating corner controls
  (optionally hover-only), themed menus, site icons, rename, drag to reorder, 80% default site zoom, Mida's own error
  panel. Claude's calls: pages show a picture of themselves under menus/pop-ups (pages always sit above the app's
  screen); 503 isn't treated as an error; profiles share sign-ins. The `tauri` branch was to be removed (the owner
  deletes it on GitHub; the session's git access can't delete branches).

* v0.3.0 (released 1 Oct 2026): **Foundry theme**, at the owner's request ("mida is an advanced weapons foundry in world
  lore"), with four reference pictures (Deep Stone Crypt interior, a Clovis Bray marking card, white weapon concepts,
  Europa concept art). Owner feedback on the first version: "a great start"; drop the wiry pattern on the settings
  rail, add a dark mode and colour choices incl. the accents ("don't want to force someone to look at white"), add
  geometric detail to the sidebar. Same batch: sidebar flyout on hover (default on), fit-to-contents sidebar, and a
  Destiny 1 retro theme.
* Owner's larger plan (Sep 30 2026): Bungie sign-in in Mida; Destiny 2 profiles get toggleable built-in tabs (Inventory
  / vault manager, Seasonal hub, Quests, RAD assistant for raids and dungeons, Featured/timers like seals.report's
  Featured); modules and tabs placeable side by side on a grid. Built so far (v0.3): side by side (two panes; Claude's
  call to start with two), the tabs with Featured and RAD working, sign-in tabs waiting.
* v0.4.0 (part 3, released 1 Oct 2026): Bungie sign-in, Inventory, Quests, Seasonal hub; seals.report gained
  `/api/mida/login|callback|token|rotators` (live on main).
* Sign-in plan the owner agreed to: a separate Bungie app for Mida (Confidential), its client secret kept on the
  seals.report server, which exchanges and refreshes tokens for Mida and stores nothing; Mida keeps the tokens on the
  PC encrypted by Windows. Needs the owner to register the app and add two Vercel env vars (steps to come).

## 9. Roadmap

1. **Destiny 2 Home page design** (the owner will direct it; custom games keep the basic Home).
2. Test on the owner's PC: Bungie sign-in, downloads (DIM exports), the v0.1.0 -> v0.2.0 in-app update.
3. Optional preloading of all modules at start; unloading modules unused for a while; separate sign-ins per profile.
4. Code signing (removes the first-install warning).
