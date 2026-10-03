// The only bridge between our own pages (the shell, the floating site controls) and the app
// (src-tauri). It exposes a short, fixed list of actions as window.hub; the app checks every call
// comes from one of our pages. Module pages (the companion sites) get no bridge at all.
"use strict";

(() => {
  const { invoke } = window.__TAURI__.core;
  const { listen } = window.__TAURI__.event;

  window.hub = {
    getState: () => invoke("get_state"),
    setPanes: (rects) => invoke("set_panes", { rects }),
    setOverlay: (open) => invoke("set_overlay", { open: open === true }),
    freezePage: (id) => invoke("freeze_page", { id }),
    split: (id, side) => invoke("split", { id, side }),
    closePane: (keep) => invoke("close_pane", { keep }),
    swapPanes: () => invoke("swap_panes"),
    setSplit: (percent) => invoke("set_split", { percent }),
    setTabs: (ids) => invoke("set_tabs", { ids }),
    signIn: () => invoke("sign_in"),
    signOut: () => invoke("sign_out"),
    d2Inventory: () => invoke("d2_inventory"),
    d2Activity: () => invoke("d2_activity"),
    d2Transfer: (item, to) => invoke("d2_transfer", { item, to }),
    d2Equip: (item, character) => invoke("d2_equip", { item, character }),
    d2Character: (character) => invoke("d2_character", { character }),
    d2Pull: (item) => invoke("d2_pull", { item }),
    d2Item: (instance, hash) => invoke("d2_item", { instance, hash }),
    d2Lock: (instance, character, locked) => invoke("d2_lock", { instance, character, locked }),
    d2Plug: (instance, character, socket, plug) => invoke("d2_plug", { instance, character, socket, plug }),
    d2Loadout: (character, index) => invoke("d2_loadout", { character, index }),
    d2Seasonal: (character) => invoke("d2_seasonal", { character }),
    d2Vendors: (character) => invoke("d2_vendors", { character }),
    d2Planner: () => invoke("d2_planner"),
    d2Records: (node, fresh) => invoke("d2_records", { node: node ? String(node) : null, fresh: fresh === true }),
    d2Armor: (fresh) => invoke("d2_armor", { fresh: fresh === true }),
    d2Clan: () => invoke("d2_clan"),
    d2Pass: (character, pass, season) => invoke("d2_pass", { character, pass, season }),
    d2Claim: (character, season, index) => invoke("d2_claim", { character, season, index }),
    d2Rotators: () => invoke("d2_rotators"),
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
    onProgress: (callback) => listen("progress", (event) => callback(event.payload)),
  };

  // MIDA's shortcuts while one of our pages has the keyboard. (Inside a module page, Windows
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
