# Mida

AIO companion site/app compiler. Built on tauri. Primarily intended for use with Destiny 2.


## Getting the app (no tools needed)

Download the installer (`Mida-Setup-<version>.exe`) from the latest release:
https://github.com/cee86/mida/releases/latest. Windows will warn that the app is from an unknown
publisher. Choose "More info" then "Run anyway".


## Releasing an update

Raise `version` in `package.json` and push to `main`. GitHub builds the installer and publishes
it as a release, and installed copies pick it up. Pushes that don't change the version only build
a test installer (Actions > "Build" > the run > Artifacts > `mida-windows`).

## Running from the code

Mida is built with Tauri and uses Windows' own browser engine (WebView2)..

```bash
npm install
npm start          # opens the app (needs Rust)
npm run dist       # builds the Windows installer (on Windows)
```

## Files

- `src-tauri/src/lib.rs` - window, module pages, security rules, menus, shortcuts, updates
- `src-tauri/src/modules.rs` - built-in site list and the checks for added sites
- `src-tauri/src/store.rs` - settings saved on this computer (`settings.json` in the app's data folder).
- `src/shell/` sidebar, toolbar, welcome and "add a module" windows (`bridge.js` connects it to the app).

## Shortcuts

Ctrl+B sidebar, Ctrl+1-9 module 1-9, Ctrl+Tab / Ctrl+Shift+Tab next / previous module,
Alt+Left / Alt+Right (or mouse side buttons) back / forward, Ctrl+R or F5 reload,
Ctrl+= / Ctrl+- / Ctrl+0 zoom the current site.

## Credits

Destiny 2 is a trademark of Bungie; Mida is not affiliated with Bungie.
