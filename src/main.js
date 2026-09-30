// Mida: Destiny 2 companion sites in one window.
//
// The window has two layers. The "shell" (src/shell) is our own page: sidebar, toolbar and
// dialogs. Each module (companion site) gets its own page view laid over the shell's stage
// area. A module is loaded the first time it's opened and then kept alive in the background,
// so switching back is instant and the site keeps its place, scroll and sign-in.
//
// Security: module pages are ordinary websites with no access to this computer (sandboxed,
// no Node.js, no preload script), they can't open other programs, permission requests
// (camera, microphone, location, notifications...) are refused, and links to other sites
// open in your normal browser. Only the shell talks to this file, through src/preload.js.
const { app, BrowserWindow, WebContentsView, ipcMain, Menu, session, shell, screen } = require("electron");
const crypto = require("node:crypto");
const path = require("node:path");
const {
  CATALOGUE, MAX_MODULES, cleanUrl, cleanName, cleanIcon, fromCatalogue, sameSite, isSignInUrl, isWebUrl,
} = require("./modules");
const { createStore } = require("./store");
const { autoUpdater } = require("electron-updater");

// Every module shares one saved browser profile, like tabs in one browser: sign in to
// Bungie once and each site's own "Sign in with Bungie" goes straight through. Sites still
// can't read each other's data (the browser's normal same-site rules apply).
const PARTITION = "persist:modules";
const ALLOWED_PERMISSIONS = new Set(["clipboard-sanitized-write", "fullscreen", "persistent-storage"]);
const BACKGROUND = "#0e1013";

let win = null;
let store = null;
const views = new Map(); // module id -> { view, status }
let stageRect = null; // where module pages go, in shell pixels (reported by the shell)
let overlayOpen = false; // a shell dialog is open, so pages are hidden beneath it
let updateReady = null; // { version } once a new version has downloaded

const moduleById = (id) => store.get().modules.find((m) => m.id === id) ?? null;

function openExternal(url) {
  if (isWebUrl(url)) shell.openExternal(url);
}

// ---------- State sent to the shell ----------

function publicState() {
  const data = store.get();
  const statuses = {};
  for (const [id, entry] of views) statuses[id] = entry.status;
  return {
    firstRunDone: data.firstRunDone,
    modules: data.modules,
    activeId: data.activeId,
    sidebarExpanded: data.sidebarExpanded,
    catalogue: CATALOGUE,
    maxModules: MAX_MODULES,
    statuses,
    platform: process.platform,
    version: app.getVersion(),
    updateReady,
  };
}

function sendState() {
  if (win && !win.isDestroyed()) win.webContents.send("state", publicState());
}

function sendStatus(id) {
  const entry = views.get(id);
  if (entry && win && !win.isDestroyed()) win.webContents.send("status", id, entry.status);
}

// ---------- Module views ----------

// Show only the active module's page, sized to the stage, and only when no dialog or
// error message needs the space.
function layoutViews() {
  if (!win || win.isDestroyed()) return;
  const { activeId } = store.get();
  const factor = win.webContents.getZoomFactor();
  for (const [id, entry] of views) {
    const show = id === activeId && !overlayOpen && !entry.status.error && stageRect !== null;
    if (show) {
      entry.view.setBounds({
        x: Math.round(stageRect.x * factor),
        y: Math.round(stageRect.y * factor),
        width: Math.max(0, Math.round(stageRect.width * factor)),
        height: Math.max(0, Math.round(stageRect.height * factor)),
      });
    }
    entry.view.setVisible(show);
  }
}

function ensureView(mod) {
  const existing = views.get(mod.id);
  if (existing) return existing;
  const view = new WebContentsView({
    webPreferences: {
      partition: PARTITION,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
    },
  });
  view.setBackgroundColor(BACKGROUND);
  view.setVisible(false);
  win.contentView.addChildView(view);
  const entry = {
    view,
    status: { loading: true, title: mod.name, url: mod.url, canGoBack: false, canGoForward: false, error: null },
  };
  views.set(mod.id, entry);
  wireView(mod.id, entry);
  view.webContents.loadURL(mod.url);
  return entry;
}

function wireView(id, entry) {
  const wc = entry.view.webContents;
  const update = (patch) => {
    entry.status = {
      ...entry.status,
      ...patch,
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
    };
    sendStatus(id);
  };

  wc.on("did-start-loading", () => {
    const hadError = entry.status.error !== null;
    update({ loading: true, error: null });
    if (hadError) layoutViews();
  });
  wc.on("did-stop-loading", () => update({ loading: false }));
  wc.on("did-navigate", (_e, url) => update({ url }));
  wc.on("did-navigate-in-page", (_e, url, isMainFrame) => {
    if (isMainFrame) update({ url });
  });
  wc.on("page-title-updated", (_e, title) => update({ title }));
  wc.on("did-fail-load", (_e, code, description, url, isMainFrame) => {
    // -3 = the load was cancelled (usually by another navigation), not a real failure.
    if (!isMainFrame || code === -3) return;
    update({ loading: false, error: { code, description, url } });
    layoutViews();
  });
  wc.on("render-process-gone", (_e, details) => {
    if (details.reason === "clean-exit") return;
    update({ loading: false, error: { code: "crashed", description: details.reason, url: entry.status.url } });
    layoutViews();
  });
  wc.on("did-finish-load", () => {
    const level = store.get().zoom[id];
    if (level) wc.setZoomLevel(level);
  });
  wc.on("page-favicon-updated", (_e, favicons) => saveFavicon(id, favicons));
  wc.on("before-input-event", handleShortcut);

  wc.setWindowOpenHandler(({ url, disposition }) => {
    if (!isWebUrl(url)) return { action: "deny" };
    // Sign-in pop-ups (Bungie, Steam, Xbox...) stay in the app so they can hand back.
    if (disposition === "new-window" && isSignInUrl(url)) {
      return { action: "allow", overrideBrowserWindowOptions: popupOptions() };
    }
    const mod = moduleById(id);
    if (mod && sameSite(url, mod.url)) {
      wc.loadURL(url);
      return { action: "deny" };
    }
    // A link to another module's site (light.gg -> DIM) opens in that module.
    const other = store.get().modules.find((m) => sameSite(url, m.url));
    if (other) {
      selectModule(other.id);
      views.get(other.id)?.view.webContents.loadURL(url);
      return { action: "deny" };
    }
    openExternal(url);
    return { action: "deny" };
  });
}

function popupOptions() {
  return {
    parent: win,
    width: 520,
    height: 720,
    autoHideMenuBar: true,
    backgroundColor: BACKGROUND,
    webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false },
  };
}

// Keep the site's icon as a small image in settings, so the sidebar shows it straight away
// next time and never has to load anything from the web itself.
const faviconTried = new Set();
async function saveFavicon(id, favicons) {
  const mod = moduleById(id);
  const url = favicons.find((f) => f.startsWith("https://"));
  if (!mod || !url || faviconTried.has(id)) return;
  faviconTried.add(id);
  try {
    const res = await session.fromPartition(PARTITION).fetch(url);
    const type = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!res.ok || !type.startsWith("image/")) return;
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > 200_000) return;
    const icon = cleanIcon(`data:${type};base64,${buffer.toString("base64")}`);
    if (!icon || icon === mod.icon) return;
    store.update({ modules: store.get().modules.map((m) => (m.id === id ? { ...m, icon } : m)) });
    sendState();
  } catch {
    // No icon is fine: the sidebar shows the module's first letter instead.
  }
}

function destroyView(id) {
  const entry = views.get(id);
  if (!entry) return;
  views.delete(id);
  win.contentView.removeChildView(entry.view);
  entry.view.webContents.close();
}

// ---------- Actions ----------

function selectModule(id) {
  const mod = moduleById(id);
  if (!mod) return;
  store.update({ activeId: id });
  const entry = ensureView(mod);
  layoutViews();
  sendState();
  if (!overlayOpen) entry.view.webContents.focus();
}

function selectOffset(step) {
  const { modules, activeId } = store.get();
  if (!modules.length) return;
  const index = modules.findIndex((m) => m.id === activeId);
  selectModule(modules[(index + step + modules.length) % modules.length].id);
}

function navigate(action) {
  const { activeId } = store.get();
  const mod = moduleById(activeId);
  const entry = views.get(activeId);
  if (!mod || !entry) return;
  const wc = entry.view.webContents;
  const history = wc.navigationHistory;
  switch (action) {
    case "back":
      if (history.canGoBack()) history.goBack();
      break;
    case "forward":
      if (history.canGoForward()) history.goForward();
      break;
    case "reload":
      if (entry.status.error) navigate("retry");
      else wc.reload();
      break;
    case "hard-reload":
      wc.reloadIgnoringCache();
      break;
    case "home":
      wc.loadURL(mod.url);
      break;
    case "retry": {
      const failed = entry.status.error?.url;
      wc.loadURL(failed && isWebUrl(failed) ? failed : mod.url);
      break;
    }
    case "external":
      openExternal(entry.status.url || mod.url);
      break;
    default:
  }
}

function zoom(step) {
  const { activeId, zoom: levels } = store.get();
  const entry = views.get(activeId);
  if (!entry) return;
  const level = step === 0 ? 0 : Math.max(-5, Math.min(5, (levels[activeId] ?? 0) + step * 0.5));
  entry.view.webContents.setZoomLevel(level);
  store.update({ zoom: { ...levels, [activeId]: level } });
}

function toggleSidebar() {
  store.update({ sidebarExpanded: !store.get().sidebarExpanded });
  sendState();
}

function addModule(mod) {
  const { modules } = store.get();
  if (modules.length >= MAX_MODULES) return { ok: false, error: `You can have up to ${MAX_MODULES} modules.` };
  const dupe = modules.find((m) => m.id === mod.id || m.url === mod.url);
  if (dupe) return { ok: false, error: `${dupe.name} is already in your sidebar.` };
  store.update({ modules: [...modules, mod] });
  selectModule(mod.id);
  return { ok: true };
}

function moveModule(id, step) {
  const modules = [...store.get().modules];
  const from = modules.findIndex((m) => m.id === id);
  const to = from + step;
  if (from < 0 || to < 0 || to >= modules.length) return;
  [modules[from], modules[to]] = [modules[to], modules[from]];
  store.update({ modules });
  sendState();
}

function removeModule(id) {
  const { modules, activeId } = store.get();
  const index = modules.findIndex((m) => m.id === id);
  if (index < 0) return;
  destroyView(id);
  const rest = modules.filter((m) => m.id !== id);
  const nextActive = activeId === id ? (rest[index] ?? rest[index - 1])?.id ?? null : activeId;
  store.update({ modules: rest, activeId: nextActive });
  if (nextActive) selectModule(nextActive);
  else {
    layoutViews();
    sendState();
  }
}

function moduleMenu(id) {
  const { modules } = store.get();
  const index = modules.findIndex((m) => m.id === id);
  if (index < 0) return;
  const mod = modules[index];
  Menu.buildFromTemplate([
    { label: `Open ${mod.name}`, click: () => selectModule(id) },
    {
      label: "Reload",
      enabled: views.has(id),
      click: () => views.get(id)?.view.webContents.reload(),
    },
    { label: "Open in your browser", click: () => openExternal(views.get(id)?.status.url || mod.url) },
    { type: "separator" },
    { label: "Move up", enabled: index > 0, click: () => moveModule(id, -1) },
    { label: "Move down", enabled: index < modules.length - 1, click: () => moveModule(id, 1) },
    { type: "separator" },
    { label: `Remove ${mod.name}`, click: () => removeModule(id) },
  ]).popup({ window: win });
}

// ---------- Updates ----------

// New versions are published as GitHub releases of cee86/mida. The app checks at start and
// every few hours, downloads quietly, and installs when you restart (or next time you quit).
// Downloads come from GitHub over https and are checked against the release's checksum.
// Only the installed app checks; running from the code (npm start) never does.
const UPDATE_CHECK_EVERY = 4 * 60 * 60 * 1000;

function setUpUpdates() {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("update-downloaded", (info) => {
    updateReady = { version: String(info.version).slice(0, 32) };
    sendState();
  });
  // No internet, GitHub down...: try again at the next check; nothing to tell the user.
  autoUpdater.on("error", (err) => console.error("Update check failed:", err?.message));
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  check();
  setInterval(check, UPDATE_CHECK_EVERY);
}

function installUpdate() {
  if (!updateReady) return;
  store.flush();
  // Silent: reinstall into the same folder without the installer's pages, then reopen Mida.
  autoUpdater.quitAndInstall(true, true);
}

// ---------- Keyboard and mouse shortcuts ----------

// Handled for the shell and every module page, so they work wherever the focus is.
function handleShortcut(event, input) {
  if (input.type !== "keyDown") return;
  const mod = process.platform === "darwin" ? input.meta : input.control;
  const key = input.key.length === 1 ? input.key.toLowerCase() : input.key;
  let action = null;
  if (mod && !input.shift && key === "b") action = toggleSidebar;
  else if (mod && input.shift && key === "r") action = () => navigate("hard-reload");
  else if ((mod && key === "r") || key === "F5") action = () => navigate("reload");
  else if (input.alt && key === "ArrowLeft") action = () => navigate("back");
  else if (input.alt && key === "ArrowRight") action = () => navigate("forward");
  else if (input.control && key === "Tab") action = () => selectOffset(input.shift ? -1 : 1);
  else if (mod && /^[1-9]$/.test(key)) {
    const target = store.get().modules[Number(key) - 1];
    if (target) action = () => selectModule(target.id);
  } else if (mod && (key === "=" || key === "+")) action = () => zoom(1);
  else if (mod && key === "-") action = () => zoom(-1);
  else if (mod && key === "0") action = () => zoom(0);
  if (action) {
    event.preventDefault();
    action();
  }
}

// ---------- Messages from the shell ----------

// Only our own shell page may call these; anything else is ignored.
const fromShell = (event) => win && event.sender === win.webContents;

function registerIpc() {
  ipcMain.handle("state:get", (event) => (fromShell(event) ? publicState() : null));

  ipcMain.on("stage:rect", (event, rect) => {
    if (!fromShell(event) || !rect || typeof rect !== "object") return;
    const nums = [rect.x, rect.y, rect.width, rect.height];
    if (!nums.every((n) => Number.isFinite(n) && n >= 0 && n < 100_000)) return;
    stageRect = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    layoutViews();
  });

  ipcMain.on("overlay", (event, open) => {
    if (!fromShell(event)) return;
    overlayOpen = open === true;
    layoutViews();
    if (!overlayOpen) views.get(store.get().activeId)?.view.webContents.focus();
  });

  ipcMain.on("module:select", (event, id) => {
    if (fromShell(event) && typeof id === "string") selectModule(id);
  });

  ipcMain.on("nav", (event, action) => {
    if (fromShell(event) && typeof action === "string") navigate(action);
  });

  ipcMain.on("module:menu", (event, id) => {
    if (fromShell(event) && typeof id === "string") moduleMenu(id);
  });

  ipcMain.on("sidebar:toggle", (event) => {
    if (fromShell(event)) toggleSidebar();
  });

  ipcMain.on("update:install", (event) => {
    if (fromShell(event)) installUpdate();
  });

  ipcMain.handle("firstrun:finish", (event, ids) => {
    if (!fromShell(event) || !Array.isArray(ids)) return { ok: false, error: "Something went wrong." };
    const modules = [...new Set(ids)].map((id) => (typeof id === "string" ? fromCatalogue(id) : null)).filter(Boolean);
    if (!modules.length) return { ok: false, error: "Pick at least one module to start with." };
    store.update({ firstRunDone: true, modules, activeId: modules[0].id });
    selectModule(modules[0].id);
    return { ok: true };
  });

  ipcMain.handle("module:add-catalogue", (event, id) => {
    if (!fromShell(event) || typeof id !== "string") return { ok: false, error: "Something went wrong." };
    const mod = fromCatalogue(id);
    return mod ? addModule(mod) : { ok: false, error: "That module isn't in the list." };
  });

  ipcMain.handle("module:add-custom", (event, input) => {
    if (!fromShell(event) || !input || typeof input !== "object") return { ok: false, error: "Something went wrong." };
    const url = cleanUrl(input.url);
    if (!url) return { ok: false, error: "Enter a web address starting with https://, like https://example.com" };
    const mod = { id: `custom-${crypto.randomBytes(5).toString("hex")}`, name: cleanName(input.name, url), url, icon: null };
    return addModule(mod);
  });
}

// ---------- Window ----------

function onScreen(bounds) {
  return screen.getAllDisplays().some(({ workArea: a }) =>
    bounds.x < a.x + a.width && bounds.x + bounds.width > a.x && bounds.y < a.y + a.height && bounds.y + bounds.height > a.y);
}

function createWindow() {
  const saved = store.get().window;
  const placed = saved && saved.x !== null && saved.y !== null && onScreen(saved);
  win = new BrowserWindow({
    width: saved?.width ?? 1440,
    height: saved?.height ?? 900,
    ...(placed ? { x: saved.x, y: saved.y } : {}),
    minWidth: 760,
    minHeight: 520,
    backgroundColor: BACKGROUND,
    title: "Mida",
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  if (saved?.maximized) win.maximize();
  win.once("ready-to-show", () => win.show());

  // The shell never navigates anywhere; it's only our own local page.
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.setVisualZoomLevelLimits(1, 1);
  win.webContents.on("before-input-event", handleShortcut);

  // Mouse back/forward buttons (Windows).
  win.on("app-command", (_e, command) => {
    if (command === "browser-backward") navigate("back");
    if (command === "browser-forward") navigate("forward");
  });

  win.on("close", () => {
    store.update({ window: { ...win.getNormalBounds(), maximized: win.isMaximized() } });
    store.flush();
  });
  win.on("closed", () => {
    win = null;
    views.clear();
  });

  win.loadFile(path.join(__dirname, "shell", "index.html"));

  // Start loading the last module straight away, alongside the shell, to save time.
  const { firstRunDone, activeId } = store.get();
  if (firstRunDone && activeId) selectModule(activeId);
}

function setUpSessions() {
  const modules = session.fromPartition(PARTITION);
  modules.setPermissionRequestHandler((_wc, permission, callback) => callback(ALLOWED_PERMISSIONS.has(permission)));
  modules.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission));
  // Present as plain Chrome: some sites (and sign-in pages) turn away browsers they don't know.
  // Electron's default adds "Mida/0.1.0" before "Chrome/..." and "Electron/..." after it.
  const ua = modules.getUserAgent()
    .replace(/\) \S+\/\S+ Chrome\//, ") Chrome/")
    .replace(/ Electron\/\S+/, "");
  modules.setUserAgent(ua);

  // The shell needs no permissions at all.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
}

function setUpMenu() {
  // macOS needs an Edit menu for copy and paste to work; elsewhere no menu bar is needed.
  if (process.platform === "darwin") {
    Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: "appMenu" }, { role: "editMenu" }, { role: "windowMenu" }]));
  } else {
    Menu.setApplicationMenu(null);
  }
}

// Safety net for every page the app ever creates (including sign-in pop-ups): no embedded
// <webview>s, no navigating to anything but web pages, and new windows go to your browser.
app.on("web-contents-created", (_e, contents) => {
  contents.on("will-attach-webview", (event) => event.preventDefault());
  contents.on("will-navigate", (event, url) => {
    if (!isWebUrl(url)) event.preventDefault();
  });
  contents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: "deny" };
  });
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(() => {
    store = createStore(app.getPath("userData"));
    setUpSessions();
    setUpMenu();
    registerIpc();
    createWindow();
    setUpUpdates();
    app.on("activate", () => {
      if (!win) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    store?.flush();
    if (process.platform !== "darwin") app.quit();
  });
}
