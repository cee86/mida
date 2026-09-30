// The only bridge between our own pages (the shell, the floating site controls) and the app
// (src-tauri). It exposes a short, fixed list of actions as window.hub; the app checks every call
// comes from one of our pages. Module pages (the companion sites) get no bridge at all.
"use strict";

(() => {
  const { invoke } = window.__TAURI__.core;
  const { listen } = window.__TAURI__.event;

  window.hub = {
    getState: () => invoke("get_state"),
    setStageRect: (rect) => invoke("set_stage_rect", { rect }),
    setOverlay: (open) => invoke("set_overlay", { open: open === true }),
    freezePage: () => invoke("freeze_page"),
    select: (id) => invoke("select", { id }),
    nav: (action) => invoke("nav", { action }),
    toggleSidebar: () => invoke("toggle_sidebar"),
    moduleAction: (id, action) => invoke("module_action", { id, action }),
    renameModule: (id, name) => invoke("rename_module", { id, name }),
    reorder: (ids) => invoke("reorder", { ids }),
    downloadUpdate: () => invoke("download_update"),
    checkUpdate: () => invoke("check_update"),
    setPrefs: (prefs) => invoke("set_prefs", { prefs }),
    openLink: (which) => invoke("open_link", { which }),
    finishFirstRun: (profile, modules) => invoke("finish_first_run", { profile, modules }),
    createProfile: (profile, modules) => invoke("create_profile", { profile, modules }),
    updateProfile: (id, profile) => invoke("update_profile", { id, profile }),
    deleteProfile: (id) => invoke("delete_profile", { id }),
    switchProfile: (id) => invoke("switch_profile", { id }),
    setDefaultProfile: (id) => invoke("set_default_profile", { id }),
    addFromCatalogue: (id) => invoke("add_from_catalogue", { id }),
    addCustom: (name, url) => invoke("add_custom", { name, url }),
    onState: (callback) => listen("state", (event) => callback(event.payload)),
    onStatus: (callback) => listen("status", (event) => callback(event.payload.id, event.payload.status)),
    onCommand: (callback) => listen("command", (event) => callback(event.payload)),
  };

  // Mida's shortcuts while one of our pages has the keyboard. (Inside a module page, Windows
  // passes them to the app directly.) Only these keys are taken; typing is untouched.
  const isShortcut = (e, ctrl) =>
    (ctrl && !e.altKey && /^(b|r|tab|[1-9]|,)$/i.test(e.key)) ||
    e.key === "F5" ||
    (e.altKey && !ctrl && (e.key === "ArrowLeft" || e.key === "ArrowRight"));

  window.addEventListener("keydown", (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    if (!isShortcut(e, ctrl)) return;
    e.preventDefault();
    invoke("key", { key: e.key, ctrl, shift: e.shiftKey, alt: e.altKey });
  });

  // Our own pages have no browser menu (no "Reload" or "View source" on right-click).
  window.addEventListener("contextmenu", (e) => {
    if (!e.target.closest("input, textarea")) e.preventDefault();
  });
})();
