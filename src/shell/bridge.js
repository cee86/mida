// The only bridge between the shell page and the app (src-tauri). It exposes the same short,
// fixed list of actions the shell always used (window.hub); the app checks every call comes
// from this page. Module pages (the companion sites) get no bridge at all.
"use strict";

(() => {
  const { invoke } = window.__TAURI__.core;
  const { listen } = window.__TAURI__.event;

  window.hub = {
    getState: () => invoke("get_state"),
    setStageRect: (rect) => invoke("set_stage_rect", { rect }),
    setOverlay: (open) => invoke("set_overlay", { open: open === true }),
    select: (id) => invoke("select", { id }),
    nav: (action) => invoke("nav", { action }),
    moduleMenu: (id) => invoke("open_module_menu", { id }),
    toggleSidebar: () => invoke("toggle_sidebar"),
    downloadUpdate: () => invoke("download_update"),
    finishFirstRun: (ids) => invoke("finish_first_run", { ids }),
    addFromCatalogue: (id) => invoke("add_from_catalogue", { id }),
    addCustom: (name, url) => invoke("add_custom", { name, url }),
    onState: (callback) => listen("state", (event) => callback(event.payload)),
    onStatus: (callback) => listen("status", (event) => callback(event.payload.id, event.payload.status)),
  };

  // Mida's shortcuts while the sidebar or toolbar has the keyboard. (Inside a module page,
  // Windows passes them to the app directly.) Only these keys are taken; typing is untouched.
  const isShortcut = (e, ctrl) =>
    (ctrl && !e.altKey && /^(b|r|tab|[1-9])$/i.test(e.key)) ||
    e.key === "F5" ||
    (e.altKey && !ctrl && (e.key === "ArrowLeft" || e.key === "ArrowRight"));

  window.addEventListener("keydown", (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    if (!isShortcut(e, ctrl)) return;
    e.preventDefault();
    invoke("key", { key: e.key, ctrl, shift: e.shiftKey, alt: e.altKey });
  });

  // Our own page has no browser menu (no "Reload" or "View source" on right-click).
  window.addEventListener("contextmenu", (e) => {
    if (!e.target.closest("input, textarea")) e.preventDefault();
  });
})();
