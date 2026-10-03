# CLAUDE.md — MIDA

Handoff for any Claude working on this repository. Read all of it before changing anything. When you finish a
meaningful change, update the relevant section (especially "Decisions log", "Known limitations" and "Roadmap").

---

## 1. What this is

**MIDA** is a locally run Windows desktop app that shows game companion websites in one window, so players don't
need a browser full of tabs: a toggleable sidebar of **modules** on the left, the chosen site (or the profile's Home
page) on the right. Since v0.2 everything is organised in **profiles**, one per game: Destiny 2 profiles get MIDA's
recommended sites; profiles for any other game start empty and add their own. It was started on 30 Sep 2026 by the owner of **seals.report** (https://d2-seals-report.vercel.app,
repo `cee86/d2-seals-report`), one of the starter modules. It began life in that repo's `desktop/` folder as
"Companion Hub" and moved here, renamed **MIDA** by the owner, the same day.

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
  public key in `tauri.conf.json` (`plugins.updater.pubkey`), then the installer runs in passive mode and MIDA reopens.
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
                          currentProfile, sidebarExpanded, window, prefs }. Version 1 files (MIDA 0.1) become a
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
art/icon.svg              MIDA's icon source. Regenerate src-tauri/icons with `npx tauri icon art/icon.svg` (keep only the
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
admin's rotator corrections live in seals.report's Redis and don't reach MIDA yet; a small public endpoint could fix
that; Featured now asks seals.report's `/api/mida/rotators` once a run through `d2_rotators`).

**Rotators** (was Featured; tab id still `tab-featured`, src/shell/rotators.js + rotators.css, 3 Oct 2026): seals.report's
Featured layout in the Seasonal Hub style (title band with the week's dates, weekly reset countdown, Grid | List;
backdrop like the hub). Left: view icons (All, Raids, Dungeons, This week, Today, Weekly checklist; `mida-rot-view`).
Grid = cards in sections, a card opens its row in the list; List = `<details>` rows with "Coming up" and caveats
(`mida-rot-mode`). The Ascendant Challenge rotator is folded into the Dreaming City card (which follows its saved index).

**Seasonal Hub layout (3 Oct 2026, owner's sketch):** top row = Active orders | Weekly rewards, the reset
countdowns, then Guardian Rank and Clan this week side by side (`.sh-pair`); the Weekly checklist across the whole
width (cards 280px+ each); the pass's rank ring and name in a column beside its reward track (`.sh-passrow`, stacked
under 1250px); then rewards to claim.

**Speed round (3 Oct 2026, owner):**
* **Loading bars** everywhere data is read (`progressBar`/`loadingView` in tabs.js; the Seasonal Hub's per-character
  hub read shows one too): lib.rs `progress(app, task, fraction, label)` emits a "progress" event (shell only) at each
  step of d2_inventory / d2_activity / d2_seasonal / d2_vendors (sign-in, game data, Bungie read, shaping), and
  bungie.rs reports the game data download by bytes (task "manifest", `set_reporter`). Between messages the bar creeps
  forward (never past 95%); bars stop themselves once off screen.
* **Tabs stay built**: signed-in tabs (Inventory, Quests, Seasonal Hub, Vendors) draw into their own host element
  (`.tab-host`, display: contents) kept in `hosts` while another tab is open; coming back re-attaches it with its
  scroll positions (instant, no Bungie read). Rebuilt after 30 minutes or when the account changes; Refresh reads
  again. A move made from the loadout dock while the Inventory is hidden is read when it's shown again
  (`container.midaShown`). The shared "inventory"/"activity" reads are kept 5 minutes and shared while in flight.
* **Item cards**: right after the inventory loads, `read_cards_ahead` (background) reads every item's card parts in
  one profile call (102, 201, 205, 300, 304, 305, 309, 310 → `Hub.item_parts`, used for 15 minutes; a lock or perk/mod
  change forgets that item so its next card asks Bungie), the plug sets (105), and the definitions every weapon and
  armor card needs (`prefetch_cards`, 10 at a time). Single-entity definitions are now also kept on disk per game
  version (`manifest/<version>-entities/`, removed with the old manifest after an update), so cards stay quick after
  a restart. `item_details` reads its stat and socket-category definitions in parallel. Hovering a tile starts its
  card read at once (`fetchDetails`), before the card opens. **Unverified live:** the size of the full item-parts read
  (component 310 can be large) and how long the first definition prefetch takes on a big vault.

**Rotators, round 3 (3 Oct 2026, owner: "bring everything up to date with seals.report"):** the tab now mirrors
seals.report's Featured v0.58. `src/shell/d2/` holds unchanged copies of seals.report's rotations.js, rotators.js,
featured-sections.js, live-rotations.js, **featured-week.js** (new on the site: the Featured page's "which cards this
week" logic, moved out of app/featured/page.js so both use the same code) and loot-tables.js, copied by
**`scripts/sync-d2.sh [path to d2-seals-report]`** (adds ".js" to relative imports, nothing else). Run it whenever the
site's Featured changes. `d2_rotators` returns `{ saved, art, week }`: `week` is `featuredWeek()`'s output as the site
works it out with Bungie's live list (rotators with Bungie's corrections, events, Xûr/Trials weekend cards, Lost
Sectors, weekly PvP modes, Nightmare Hunts, the Dreaming City week), plus `at`. The live list itself never leaves the
site (it comes from the owner's characters). MIDA uses `week` when it's from after the latest daily reset; otherwise
(offline, old answer) it runs its own copy of `featuredWeek` on `saved` (with `v: 2`, which `withSaved` needs) and no
live list. It asks again when the tab opens and the last answer is over 10 minutes old. Views: This week (default,
`LANDING_ROWS`, some sections side by side), Everything, one per section with cards, expansions under their own
heading (`mida-rot-view2`). Cards follow FeaturedCards.js (type or expansion in the picture's corner, entry as title
or under it, weapon/place/text lines, Dares loot pool label with hover list, time left + API/Manual tag); list rows
follow the page's RotatorRow (now, Lost Sector table, loot, weapons, coming up, caveat). No seal triumphs in MIDA.

**Rotators, round 2 (3 Oct 2026, owner):** views now match seals.report's Featured sidebar exactly (Everything,
Raids, Dungeons, Other activities, same icons; old saved views fall back to Other), sections inside stay Raids,
Dungeons, This week, Today, Weekly checklist. Cards show the activity's loading-screen art like seals.report:
`d2_rotators` now returns `{ saved, art }`, `art` coming from seals.report's Redis `activity-art` via
`/api/mida/rotators` (raids, dungeons, The Dreaming City, Distortions with their destination fallback, rotator
activities by each rotator's `art` rule); only `https://www.bungie.net/` addresses pass (`rotator_art` in lib.rs).
Every strip is 96px so rows line up; no art = the old patterned strip with a letter. Needs seals.report's endpoint
change live (main) to show pictures.

**Vendors** (src/shell/vendors.js + vendors.css, `tab-vendors`, 3 Oct 2026): `d2_vendors(character)` ->
`vendor_screen` in bungie.rs from the character Vendors call (components 400, 401, 402, 301): vendors that are
enabled, have a visible definition and something for sale (at most 80), with location (definition `locations`
[`vendorLocationIndex`] -> destination name, `backgroundImagePath` as the banner), group (`groups[0]` ->
DestinyVendorGroupDefinition `categoryName`), rank (component 400 `progression`), next reset (dates over 2 years
dropped) and sale items by display category (costs from the slimmed manifest, `saleStatus` flags -> Owned / Can't
afford / Locked / Sold out). Definitions are fetched 10 at a time (`entities`). Left: vendors grouped like the game;
right: banner, then a box per category of item tiles with costs underneath and hover cards; search filters vendors
and items; answers kept per character until Refresh. **Unverified live**: group names, which vendors Bungie marks
enabled/visible, the status flags. **New tabs and saved tab lists:** profiles now keep `tabsKnown` (every tab that
existed when the list was saved); a tab missing from it is added once at the end, so Vendors appears for people who
reordered or hid tabs before (files without `tabsKnown` count as knowing the five tabs up to Rotators).

**Quests round 2:** hover names sit above the tiles (nav z-index); DLC buttons under the types (letters in a small
frame: RG, EF, FS, LF, WQ, BL, SK, FK, WM, CO, RW), shown only for expansions found in a quest's traits, quest line,
name or text (Bungie has no expansion field on quests; a guess, tune on live data).

**App icon (3 Oct 2026):** the owner's abstract "MIDA multi-tool" drawing redrawn as a one-colour sun-orange
(#f19a3f) silhouette on a transparent background (art/icon.svg; the grip holes, barrel seam and magazine ribs are
cut out with a mask). Icons regenerated with `npx tauri icon` from a 1024px render made in Chromium (ImageMagick
drops the mask); only the five files tauri.conf.json lists, plus src/shell/icon.png (About), are kept.

**Flyout sidebar:** opened over the page it now keeps the docked sidebar's own background (each theme's), not a
solid panel colour.

**Quests** (src/shell/quests.js + quests.css, 3 Oct 2026, after the game's Quests screen): title band (count, character
picker, sort: game order / most progress / ready first / ending soonest / name, `mida-quest-sort`, Refresh), then an
icon column of quest types (All, Exotic, Seasonal, Campaigns, Playlists, New Light, Past, Other; only types present;
hover shows the name; `mida-quest-category`), quest tiles (icon in its rarity colour, quest line, name, step n of m,
meter, ready check), the chosen quest (screenshot banner when Bungie has one, step diamonds, description, objectives,
reward tiles with hover cards, quest line text, time left) and bounties in the right column (ready first). The types,
quest line, step and rewards come from `enrich_quests` in bungie.rs: each quest's full item definition (single-entity
lookup, memory-cached; first 80 per character): `traitIds` mapped by words (exotic / seasonal|current_release|episode /
expansion|campaign / playlist / new_light / past|legacy, else other), `setData.questLineName/Description/itemList`
(step = this quest's place in the list), `value.itemValue` rewards. **Unverified live**: the trait id wording and
whether the step lists hold every step; when traits are missing the type is guessed from the type name.

**Sidebar fixes (3 Oct 2026):** collapsed icons line up with the expanded ones (labels and the profile text keep their
height, hidden with `color: transparent` / `visibility: hidden`); built-in tabs can be dragged up and down to reorder
(`hub.setTabs`); a cancelled drag (Esc, dropped outside) always clears the split drop zones (`dragend` caught on the
document in the capture phase, a pointer move also ends a stale drag, and the sidebar doesn't re-render mid-drag, which
used to detach the dragged row so `dragend` never fired).

**Bungie sign-in** (src/auth.rs, v0.4): MIDA's own Bungie app (Confidential; redirect
`https://d2-seals-report.vercel.app/api/mida/callback`; scopes: read Destiny 2 inventory/vault, move or equip gear). Its
client secret lives only in seals.report's Vercel env (`MIDA_CLIENT_ID`/`MIDA_CLIENT_SECRET`). Flow: MIDA listens once
on 127.0.0.1:<random port> (`auth::listen`/`wait_for_code`, 5 min, only `/callback` with the matching random state),
opens `seals.report/api/mida/login?port&state` in the system browser -> Bungie -> `/api/mida/callback` -> redirect to the
listener with the code -> MIDA POSTs it to `/api/mida/token` (the server swaps it with the secret, stores nothing) ->
the public `/User/GetMembershipsById/{membership_id}/254/` (the Bungie.net id the token response carries; v0.4.0 used `GetMembershipsForCurrentUser`, which needs a permission MIDA's app doesn't have, and every sign-in failed) -> `auth::pick_membership` (primary / cross save). Bungie errors show their code (12 = a permission missing from the app on bungie.net). Tokens: `account.bin` next to
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
and undo on error, then a quiet re-read 6 s later.
**Inventory v0.6** (owner's second round): General and Inventory always show all three characters ("All characters /
Current only" only appears on Weapons and Armor). The emblems + vault + currencies are a fixed bar across the whole
width (`.inv-headbar`, over the side panel it shows the current character); only the rows under it scroll
(`scrollbar-gutter: stable` on both so columns line up; the bar follows sideways scrolls). Toolbar buttons are 42 px
like the segmented controls. v0.6.1 (owner): no frame or marker on the current character (the owner
found the side panel's name enough); the vault gets a DIM-style emblem (our own vault-door mark, "Vault", count / max where power would be,
red near full) with a **currencies box** at the far right of the vault column showing Glimmer, Chronologs and Bright
Dust (matched by name, else the first three); clicking it lists every profile currency plus materials summed from the
consumables (`MATERIALS` name pattern in inventory.js; names unverified). The box wraps under the vault emblem when the
column is narrow.
**Item icon overlays** (owner): by default no strip; power (or stack count) sits bottom-right on the art with a shadow,
the element diamond beside it, the lock as a small badge in the top-right corner. Settings -> Personalization ->
"Inventory item icons" toggles Power level, Lock icon, Element, Gear tier (pips bottom-left, off by default), Season
mark, Gold masterwork edge and the old dark strip (off by default). Saved in localStorage `mida-inv-overlays`
(defaults in both shell.js and inventory.js); event `mida-overlays` repaints; each shows as `data-ov-*` on the tab and
CSS does the rest.
**v0.7 (owner's round 4):** perk and mod swaps run in the background (`swapPlug`: the card shows the new pick at once,
pulsing while Bungie answers, stays usable, other items can be browsed; a refusal undoes it; the item is re-read quietly
afterwards). Mod choices also come from the socket's own list (component 310), which is where weapon mod slots list
unlocked mods. The card header copies the game's: tier colour brightening right with a sheen, name, a thin rule, type
and rarity, the season mark and gear tier pips stacked at the right edge. **Class figures** between weapons and armor
(`classFigure`): our own simple silhouettes (Titan rifle raised, Hunter cloak and gun on shoulder, Warlock coat and
Light in hand) on a glow in the class's colour from the owner's reference posters, or a picture per class chosen in
Settings -> Personalization -> Loadout figures (localStorage `mida-inv-figure-<classType>`, 900 px JPEG, event
`mida-figures`). The owner's posters are fan art by another artist with Bungie's class logos, so they're **not
bundled** (same reason as the hangar art). **Loadout dock** (`loadoutDock`, shell `#dock` beside the stage in `.main`'s
second grid column, 330 px; sidebar button "Loadout dock" on signed-in Destiny 2 profiles; on/off in localStorage
`mida-dock`): character switch, emblem, weapons | figure | armor, stats; pointing at a slot shows that character's other
items for it (up to 9) inside the dock (sites cover anything outside our own layout), click equips. Pane sizes are
measured from our layout, so sites shrink to make room. Dock and Inventory tab share the cached inventory and tell each
other about moves (`mida-inventory-changed`). Esc closes the item card from anywhere; a quick click no longer un-pins it
(the hover timer is cleared).
**Notifications** (v0.7, owner): a bell at the bottom of the sidebar (above Settings) with an unread count opens a list
(`#notes-dialog`, frozen like other dialogs): a new version (with "Update now"), a failed download, "Updated to MIDA X"
after an update (with "What's new"; compares `mida-last-version`), Bungie sign-in errors, and anything Bungie refused in
the Inventory or dock (`ctx.notify`, `fail()` in inventory.js). Kept in localStorage `mida-notifications` (newest
first, at most 60); `key` stops the same news being added twice; marked read when the list opens (the "new" marks stay
until it closes); dismiss one or Clear all. Asked about push notifications for releases: not possible without an
always-on server (Vercel ends requests within a minute), so the owner chose to keep the launch + every-4-hours check.
**Next version (stored, not released yet):** the loadout dock drops the class figure: Equipped is two tight rows
(weapons + ghost, then armor; the slot picker opens below the tile), stats as a 3-across grid, **Set bonuses** shows only
the active bonuses as icons (DestinySandboxPerkDefinition icon, the pieces needed as a badge, name + text on hover), and
**Loadouts** lists the character's in-game loadouts (component 206, now read by `d2_character`; name/icon/colour from
DestinyLoadoutName/Icon/ColorDefinition via `entity`; empty slots skipped) and equips one on click (`d2_loadout` ->
`/Destiny2/Actions/Loadouts/EquipLoadout/`, index 0-20). Field names from Bungie's docs, unverified live. The class
figure stays in the Inventory tab's side panel.
**Ghost mark instead of class figures** (owner, v0.8): the silhouettes (and the Loadout figures setting) were removed
("don't think they look good"); between weapons and armor in the side panel there's now a small grey Ghost mark
(`loadoutMark`, `src/shell/figures/ghost.png`: the owner's picture with its background trimmed, white, shown at 22%
opacity; inverted on light themes).
**Seasonal Hub** (renamed from "Seasonal hub"; `src/shell/seasonal.js` + `seasonal.css`, from the owner's mock-up of the
game's hub): header with the season name, character picker and Refresh; **Active orders** (quests/bounties whose type
or name says "order") and **Order upgrade chance** (a reward-track progression named "order", if any); **Daily** and
**Weekly objectives** (records under every `*PresentationNodeHash` the season definition and the active event card
name, grouped by node names containing "daily" / "week"), each with a reset countdown (daily 17:00 UTC, weekly
Tuesday 17:00 UTC); **Weekly rewards** (a reward-track progression named "week"); the **pass**: rank ring, pass name,
a dropdown of past passes (the account's `seasonHashes`, last 12; `d2_pass` reads one), **Season pass bonuses** (pass
owned, from earned premium rewards' claim state; ranks past the track; artifact; season end); the **rewards track**
(`pass_track`: the reward progression's `rewardItems` grouped by rank, free over premium by `uiDisplayStyle`,
earned/claimed from `rewardItemStates`; scrolls to the current rank). Bounties, Bungie's alerts and a **Data check**
(objective node groups, reward tracks found, quest kinds) fold away at the bottom. `d2_seasonal` reads components
100,202,900. Orders, objectives, weekly rewards, order chance and the pass bonuses are **educated guesses** about
Bungie's 2025-26 hub data; the data check is there so the owner can screenshot it for tuning.
**Seasonal Hub round 2** (owner's first live data check, 2 Oct 2026: the season's `seasonalChallengesPresentationNodeHash`
gave no records, no event card, six unnamed reward tracks of 15-23 steps, quests only "Quest Step", the pass track worked;
season `endDate` was far future, artifact 0): styled like the Inventory (title band, `.inv-backdrop` with its own picture
`mida-sh-backdrop`, else the Inventory's; boxes with corner brackets; `.sh-label` = diamond + rule bright at its start);
**reward hover cards** (`.sh-tip`: name, type, tier, quantity, description, rank, free/pass, earned/claimed); **Rewards to
claim** under the track (This pass / Every pass; `claimable` = earned, not claimed, ClaimAllowed flag 8; every pass in the
dropdown is read for it) with Claim / Claim all (`d2_claim` -> `/Destiny2/Actions/Seasons/ClaimReward/` with rewardIndex,
seasonHash, characterId, membershipType; body unverified live); **bounties** in a sticky column on the right; "Pass ends
in" (next pass start, else a real season end) replaces the season end; artifact only when non-zero. `d2_seasonal` now
also reads the character's **vendors** (400,401,402,301; a failure is ignored): vendors selling things with objectives or
bounties give categories that fill orders ("order"), daily ("daily"), weekly ("week") and weekly rewards ("week" +
"reward"). The data check adds the presentation nodes looked at, those vendors and categories, milestone names, each
track's first reward, and the keys Bungie gives a pass and a season (to find the pass's XP bonus etc., not found yet).
**Second live data check (2 Oct 2026):** the season's challenges node is empty (no name, no children); 235 vendors were
read and the first 12 with objectives were classic ones (Nimbus, Eris, Quinn, Evidence Board, Shaw Han, Petra, Ikora,
Xûr, Fynch, Drifter, Variks, Exotic); the unnamed reward tracks are vendor reputations (first reward Enhancement Core,
Strange Coin, "Infernal"), not the weekly rewards; milestones are raids, Purification, Weekly Clan Engrams, Kepler; the
pass and season definitions have **no bonus fields** (pass: displayProperties, color, images, reward/prestige
progression; season: artifact, seasonPassList, seasonPassProgression/Unlock, seasonalChallenges node, dates), so the
pass's XP bonus etc. aren't available and the bonuses box now says so. Next round reads vendors ranked by how many sale
items carry objectives (30 max, so the hub vendor isn't cut off), and the data check adds the character's
`uninstancedItemObjectives` items and the kinds of things in the inventories (components 102, 201) to find the orders.
**Third live data check (2 Oct 2026):** the hub has no vendor of its own (the 30 vendors were all classic ones). Found:
**orders are inventory items** of kind "Foundry Order" (4) and "Duality Order" (1) = the 5 active orders; and a hidden
item **"Personal Weekly Objectives"** in the character's uninstanced objectives. So: orders = items in the character's
or account's inventory whose kind contains "order" (objectives from component 301 or the uninstanced ones); daily /
weekly objectives = each objective of an uninstanced item named "...Daily/Weekly Objectives..." (character or profile,
component 104), one card each, named from DestinyObjectiveDefinition; **weekly rewards = the unnamed 20-step track whose
first reward is a Strange Coin** (owner identified it; found by that first reward, else a track with 18+ levels and a
reward per level), else the weekly item's own `value` list (marked as a guess). `d2_seasonal` reads 100,102,104,201,202,
300,301,900. The order upgrade chance box was dropped (owner: not in Bungie's data). **Fourth check (v0.8.3 live):** orders were right but showed raw counts
(0 / 250,000): now a percentage like the game, and Bungie's icon tokens ("[Void]", "[Stasis]", "[Headshot]") become
element diamonds (`rich()`, others dropped). "Personal Weekly Objectives" is the **clan** XP objective: holders whose
objectives mention "clan" are skipped. The real daily/weekly hub objectives are still unfound: `seasonal()` now reads
`/Settings/` and lists every core-settings record tree in the data check, walking those named like season / hub /
objective / daily / weekly / pathfinder / portal. "Pass ends in" only shows for dates within two years (Bungie's
far-future placeholders are ignored). **Fifth check (v0.8.4 live, 3 Oct 2026):** no core-settings record tree is the hub's (Titles,
Triumphs, Badges, Items, Weapons, Patterns & Catalysts, Guardian Ranks, Legacy, Lore, Medals, Metrics; the season's
challenges node is empty), no vendor or hidden item holds them: **the hub's daily and weekly objectives aren't in Bungie's
public data**, so those two boxes were removed. Top row now: Active orders | Weekly rewards with the daily / weekly reset
countdowns under it. (The Rust still looks for them, cheaply; if Bungie adds them, they show in the data check.)
**Replacements (owner's pick, 3 Oct 2026):** a row of **Weekly checklist** (the character's milestones from component
202: each raid / dungeon / Kepler / Purification / Weekly Clan Engrams, done when its reward entries are earned, else
its challenges or quests are complete; same-named milestones merged; reward entries as chips; not-done first),
**Guardian Rank** (profile `currentGuardianRank` / `lifetimeHighestGuardianRank` from component 100; rank names and the
next rank's records from the `guardianRanksRootNodeHash` tree in `/Settings/`; done = record objective flag clear; the
first 6 left to do are listed) and **Clan this week** (the clan's "Personal Weekly Objectives" XP objective, and Weekly
Clan Engrams' reward entries: ready to collect = earned and not redeemed). The Season pass bonuses box is gone; pass
owned / ranks past the track / pass end are a line under the pass name. All of these field readings are from Bungie's
docs, unverified live. The data check adds "Orders found", the objective holders (done counts, reward lists) and track hashes. **Filters** = a screen like the game's vault filters (categories left, a grid of
toggles, "Currently selected n/m", Select all / Deselect all / Clear every filter / Done); options are built from the
items present; OR within a category, AND across; kept per tab in `mida-inv-filters2`. Weapons: Slot, Archetype (item
type), Damage Type, Ammo Type, Anti-Champion (`breakerType` 1/2/3), Gear Tier, Rarity, Masterwork, Duplicates,
Locked; Armor: Armor Slot, Archetype (the socket plug whose type names "archetype"), Class, Gear Tier, Masterwork,
Rarity, Duplicates, Locked, Set Bonus (`setNames` from DestinyEquipableItemSetDefinition). **Postmaster** = a drop-down
under the toolbar with each character's waiting items as tiles (hover card; click pins it with "Pull to X").
**Item card** (like seals.report's ItemPeek, in the game's hover-card style): hover a tile 260 ms shows it beside the
tile inside the tab; a click pins it (click elsewhere or Esc closes). `d2_item` (item endpoint, components
300,302,304,305,309,310; cached per instance until a refresh) gives power, ammo, gear tier, stat bars (stat group order),
the intrinsic frame, perk columns (310 reusable plugs), mods (options from the socket's reusable/randomized plug set
hash looked up in component 105 plug sets, cached 10 min in `Hub.plug_sets`, capped at 150), kill trackers and flavour
text. Pinned: lock/unlock (`d2_lock` -> SetLockState), equip / move buttons, click a perk or pick a mod to swap it
(`d2_plug` -> InsertSocketPlugFree; Bungie only allows free swaps, e.g. perks already unlocked, so others fail with
Bungie's message). **Backdrop**: Settings -> Personalization -> "Inventory backdrop" lets the player pick a picture from
their own PC (shrunk to 1920 px JPEG in localStorage `mida-inv-backdrop`, read with FileReader as a data address since the
CSP allows data: images; event `mida-backdrop` repaints); shown darkened and blurred; without one, our own dark hangar-like
gradient. The owner's hangar concept art was **not** bundled: it's Bungie's copyrighted art with the artist's watermark
and the repo is public. Items now also carry gearTier, ammo, breaker, set, archetype and (non-instanced) description; the
slimmed manifest file is `<version>-3.json`. All of the new Bungie field reading is unverified against live data. Quests and Seasonal hub (tabs.js: character picker, last played first; objective bars; bounty
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
  (`shell.json`) is for those two pages. open_link only opens fixed MIDA URLs.
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
* Updates are signature-checked (see §3); single-instance: opening MIDA again focuses the existing window.

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
controls.html): MIDA as the weapons foundry of the lore, from the owner's Deep Stone Crypt / Clovis Bray references.
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
  and its releases were deleted), so anyone on it uninstalls "MIDA" and installs the Tauri v0.1.0 by hand once. Different
  install folders:
  Electron `%LOCALAPPDATA%\Programs\mida`, Tauri `%LOCALAPPDATA%\MIDA`.
* Unsigned installer (SmartScreen warning on first install).
* Memory grows with each opened module (they stay alive by design).

## 8. Decisions log

**Electron era (all 30 Sep 2026; releases and version numbers retired):**

* Electron 0.1: Electron over Tauri (its several-pages-per-window support was mature; Tauri's was experimental); modules load on first open and stay alive; one shared
  browser profile; first-run picker with seals.report, light.gg and DIM ticked; custom https sites allowed; moved from
  `cee86/d2-seals-report/desktop` to its own repo at the owner's request; the owner named the app **MIDA** (the repo name).
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
  (optionally hover-only), themed menus, site icons, rename, drag to reorder, 80% default site zoom, MIDA's own error
  panel. Claude's calls: pages show a picture of themselves under menus/pop-ups (pages always sit above the app's
  screen); 503 isn't treated as an error; profiles share sign-ins. The `tauri` branch was to be removed (the owner
  deletes it on GitHub; the session's git access can't delete branches).

* v0.3.0 (released 1 Oct 2026): **Foundry theme**, at the owner's request ("mida is an advanced weapons foundry in world
  lore"), with four reference pictures (Deep Stone Crypt interior, a Clovis Bray marking card, white weapon concepts,
  Europa concept art). Owner feedback on the first version: "a great start"; drop the wiry pattern on the settings
  rail, add a dark mode and colour choices incl. the accents ("don't want to force someone to look at white"), add
  geometric detail to the sidebar. Same batch: sidebar flyout on hover (default on), fit-to-contents sidebar, and a
  Destiny 1 retro theme.
* Owner's larger plan (Sep 30 2026): Bungie sign-in in MIDA; Destiny 2 profiles get toggleable built-in tabs (Inventory
  / vault manager, Seasonal hub, Quests, RAD assistant for raids and dungeons, Featured/timers like seals.report's
  Featured); modules and tabs placeable side by side on a grid. Built so far (v0.3): side by side (two panes; Claude's
  call to start with two), the tabs with Featured and RAD working, sign-in tabs waiting.
* v0.8.6 (3 Oct 2026, owner): MIDA branding, multi-tool silhouette icon, Vendors tab, Rotators pictures and
  seals.report's categories, Quests DLC buttons and hover fix, flyout keeps the sidebar background.
* Branding (3 Oct 2026, owner): the app is **MIDA** (all capitals) everywhere people see it: window title, sidebar,
  dialogs, sign-in page, installer and Start menu (`productName` "MIDA" in tauri.conf.json and package.json). Windows
  treats "Mida" and "MIDA" as the same name for folders, registry keys and shortcuts, so the update installs over the old
  copy rather than beside it. Code names stay lower case (`mida` crate, `cee86/mida`, `mida-*` storage keys,
  `/api/mida/*`). The release step finds the installer by pattern, so the name's case doesn't matter there.
* v0.8.5 (3 Oct 2026, owner's round): Seasonal Hub without the hub objectives / bonuses boxes, with a weekly
  checklist, Guardian Rank and clan weekly; Featured rebuilt as **Rotators**; Quests like the game's Quests screen with
  bounties on the right; sidebar alignment, tab reordering and cancelled-drag fixes.
* v0.8.3 (owner): updates install silently (`plugins.updater.windows.installMode` "quiet" = NSIS `/S /R`, per-user so no
  admin prompt; the installer relaunches MIDA) after an in-app "Updating MIDA" window (`#updating-dialog`, can't be
  dismissed) shows the download percentage and then "Installing"; the Rust side now downloads, shows "ready" for 1.5 s,
  then installs (`download` + `install` instead of `download_and_install`). The first update *to* this version still
  shows the old installer window (the installed app's config decides). Memory: WebView2 runs pages in its own
  msedgewebview2 processes, which Resource Monitor lists apart from mida.exe (Task Manager's Processes tab groups them);
  that can't be changed, but pages not in a pane now ask WebView2 to use as little memory as it can
  (`win::set_background` -> ICoreWebView2_19 MemoryUsageTargetLevel Low; Normal again when shown; menus don't count).
* v0.7 (2 Oct 2026, owner's round 4): background perk/mod swaps, weapon mod slots changeable, game-style card header,
  class figures (own silhouettes or the player's pictures; the owner's fan-art posters kept out of the repo), loadout
  dock beside any page, darker blurred glass for the sidebar, settings tabs, toggles and buttons (`--glass`,
  `--glass-blur`; Foundry keeps its own look), and the sidebar no longer stays in flyout mode after expanding it from
  the flyout.
* v0.6 (2 Oct 2026, owner's inventory round 2): all characters on General/Inventory, fixed full-width emblem bar,
  game-style filter screen, postmaster drop-down, item card with lock/perk/mod changes, backdrop picker (the owner's
  Bungie concept art kept out of the repo, see §4), equal-height toolbar buttons.
* v0.4.0 (part 3, released 1 Oct 2026): Bungie sign-in, Inventory, Quests, Seasonal hub; seals.report gained
  `/api/mida/login|callback|token|rotators` (live on main).
* Sign-in plan the owner agreed to: a separate Bungie app for MIDA (Confidential), its client secret kept on the
  seals.report server, which exchanges and refreshes tokens for MIDA and stores nothing; MIDA keeps the tokens on the
  PC encrypted by Windows. Needs the owner to register the app and add two Vercel env vars (steps to come).

## 9. Roadmap

1. **Destiny 2 Home page design** (the owner will direct it; custom games keep the basic Home).
2. Test on the owner's PC: Bungie sign-in, downloads (DIM exports), the v0.1.0 -> v0.2.0 in-app update.
3. Optional preloading of all modules at start; unloading modules unused for a while; separate sign-ins per profile.
4. Code signing (removes the first-install warning).
