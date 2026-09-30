# Mida

Destiny 2 companion sites in one window: a sidebar of modules on the left, the chosen site on
the right. Not affiliated with Bungie or any of the sites it shows.

Each module is the real website, shown in its own page view. A module loads the first time you
open it and then stays loaded in the background, so switching between modules is instant and each
site keeps its place and sign-in.

## Getting the app (no tools needed)

Download the installer (`Mida-Setup-<version>.exe`) from the latest release:
https://github.com/cee86/mida/releases/latest. Windows will warn that the app is from an unknown
publisher (the app isn't code-signed yet): choose "More info" then "Run anyway".

After that Mida updates itself: it checks for new versions at start and every few hours,
downloads them quietly, and shows "Restart to update" in the toolbar (or installs the next time
you close it).

## Releasing an update

Raise `version` in `package.json` and push to `main`. GitHub builds the installer and publishes
it as a release, and installed copies pick it up. Pushes that don't change the version only build
a test installer (Actions > "Build" > the run > Artifacts > `mida-windows`).

## Running from the code

```bash
npm install
npm start          # opens the app
npm run dist       # builds the Windows installer into dist/ (on Windows)
```

## Files

- `src/main.js` - the app: window, module page views, security rules, shortcuts.
- `src/modules.js` - the built-in site list and the checks for added sites.
- `src/store.js` - settings saved on this computer (`settings.json` in the app's data folder).
- `src/preload.js` - the short list of actions the app's own screen may ask for.
- `src/shell/` - the app's own screen: sidebar, toolbar, welcome and "Add a module" windows.

## Shortcuts

Ctrl+B sidebar, Ctrl+1-9 module 1-9, Ctrl+Tab / Ctrl+Shift+Tab next / previous module,
Alt+Left / Alt+Right (or mouse side buttons) back / forward, Ctrl+R or F5 reload,
Ctrl+= / Ctrl+- / Ctrl+0 zoom the current site (remembered per module).
