// Settings saved on this computer only (settings.json in the app's data folder).
// Everything read back is cleaned, so a damaged or hand-edited file can't break the app.
const fs = require("node:fs");
const path = require("node:path");
const { cleanModules } = require("./modules");

const DEFAULTS = {
  firstRunDone: false,
  modules: [],
  activeId: null,
  sidebarExpanded: true,
  zoom: {},
  window: null,
};

function cleanWindow(w) {
  if (!w || typeof w !== "object") return null;
  const num = (v) => (Number.isFinite(v) ? Math.round(v) : null);
  const out = { x: num(w.x), y: num(w.y), width: num(w.width), height: num(w.height), maximized: w.maximized === true };
  if (!out.width || !out.height || out.width < 400 || out.height < 300) return null;
  return out;
}

function cleanZoom(zoom, modules) {
  const out = {};
  if (!zoom || typeof zoom !== "object") return out;
  for (const mod of modules) {
    const level = zoom[mod.id];
    if (Number.isFinite(level) && level >= -5 && level <= 5) out[mod.id] = level;
  }
  return out;
}

function clean(raw) {
  const data = raw && typeof raw === "object" ? raw : {};
  const modules = cleanModules(data.modules);
  const activeId = modules.some((m) => m.id === data.activeId) ? data.activeId : modules[0]?.id ?? null;
  return {
    firstRunDone: data.firstRunDone === true,
    modules,
    activeId,
    sidebarExpanded: data.sidebarExpanded !== false,
    zoom: cleanZoom(data.zoom, modules),
    window: cleanWindow(data.window),
  };
}

function createStore(dir) {
  const file = path.join(dir, "settings.json");
  let data;
  try {
    data = clean(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch {
    data = clean(DEFAULTS);
  }

  let timer = null;
  function writeNow() {
    clearTimeout(timer);
    timer = null;
    try {
      fs.mkdirSync(dir, { recursive: true });
      // Write to a temporary file first, then swap it in, so a crash mid-save
      // never leaves a half-written settings file.
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
      fs.renameSync(tmp, file);
    } catch (err) {
      console.error("Couldn't save settings:", err.message);
    }
  }

  return {
    get: () => data,
    update(patch) {
      data = clean({ ...data, ...patch });
      clearTimeout(timer);
      timer = setTimeout(writeNow, 300);
      return data;
    },
    flush: () => {
      if (timer) writeNow();
    },
  };
}

module.exports = { createStore };
