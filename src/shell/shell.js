// The shell page: draws the sidebar, toolbar, home page, menus and dialogs from the state the
// app sends, and passes clicks back through window.hub (bridge.js). Text from sites (titles,
// addresses) is only ever set as plain text, never as HTML.
"use strict";

// `hub` is provided by bridge.js (window.hub); applyTheme and COLORWAYS by theme.js.
const $ = (id) => document.getElementById(id);

let state = null;
const mac = () => state?.platform === "macos" || state?.platform === "darwin";
const modKey = () => (mac() ? "Cmd" : "Ctrl");
const HOME = "home";

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    // Styles are set through the page's style object: the app's security policy blocks style="…".
    else if (key === "style") for (const [name, v] of Object.entries(value)) node.style.setProperty(name, v);
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children) if (child) node.append(child);
  return node;
}

const svg = (paths) => {
  const node = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  node.setAttribute("viewBox", "0 0 24 24");
  node.setAttribute("aria-hidden", "true");
  for (const d of paths) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    node.append(path);
  }
  return node;
};
// The built-in tabs' icons.
const TAB_ICONS = {
  "tab-inventory": ["M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"],
  "tab-seasonal": ["M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4l-5.3 3 1.2-6-4.5-4.1 6-.7z"],
  "tab-quests": ["M10 6h10M10 12h10M10 18h10M4 6l1.2 1.2L7.5 5M4 12l1.2 1.2L7.5 11M4 18l1.2 1.2L7.5 17"],
  "tab-rad": ["M12 3l8 9-8 9-8-9z", "M12 8v8M8.5 12h7"],
  "tab-featured": ["M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z", "M12 7v5l3 2"],
};

const ICONS = {
  home: ["M4 11l8-6 8 6M6.5 9.5V19h11V9.5"],
  swap: ["M7 7h11l-3-3M17 17H6l3 3"],
  close: ["M6 6l12 12M18 6L6 18"],
  split: ["M4 5h16v14H4zM12 5v14"],
  open: ["M5 12h14M13 6l6 6-6 6"],
  reload: ["M19 12a7 7 0 1 1-2.05-4.95M19 4v4h-4"],
  browser: ["M14 5h5v5M19 5l-8 8M17 14v5H5V7h5"],
  rename: ["M4 20h4L19 9l-4-4L4 16v4z", "M13.5 6.5l4 4"],
  icon: ["M4 5h16v14H4z", "M4 15l4-4 4 4 3-3 5 5"],
  up: ["M12 19V5M6 11l6-6 6 6"],
  down: ["M12 5v14M6 13l6 6 6-6"],
  remove: ["M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"],
  plus: ["M12 5v14M5 12h14"],
  edit: ["M4 20h4L19 9l-4-4L4 16v4z"],
  star: ["M12 4l2.4 5 5.6.6-4.2 3.8 1.2 5.6L12 16.3 7 19l1.2-5.6L4 9.6 9.6 9z"],
  offline: ["M3 3l18 18", "M8.5 16.5a5 5 0 0 1 7 0M5 12.5a10 10 0 0 1 4-2.4M19 12.5a10 10 0 0 0-3.2-2.1M2 8.8a15 15 0 0 1 4.3-2.6M22 8.8A15 15 0 0 0 11 5", "M12 20h.01"],
  alert: ["M12 4l9 16H3z", "M12 10v4M12 17v.5"],
};

const hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};
const initial = (name) => (name?.match(/[\p{L}\p{N}]/u)?.[0] ?? "?").toUpperCase();

function avatar(profile, size = "") {
  const node = el("span", { class: `avatar ${size}`, "aria-hidden": "true" });
  if (profile?.image) node.append(el("img", { src: profile.image, alt: "" }));
  else node.textContent = initial(profile?.name);
  return node;
}

function moduleIcon(mod, loading) {
  const icon = el("span", { class: "mod__icon", "data-loading": loading ? "true" : null, "aria-hidden": "true" });
  if (mod.icon) {
    const img = el("img", { src: mod.icon, alt: "" });
    // A broken icon falls back to the first letter.
    img.addEventListener("error", () => {
      img.remove();
      icon.textContent = initial(mod.name);
    });
    icon.append(img);
  } else {
    icon.textContent = initial(mod.name);
  }
  return icon;
}

const gameName = (profile) =>
  profile?.game === "custom" ? profile.gameName || "Custom game" : state?.games.find((g) => g.id === profile?.game)?.name ?? "";

const activeModule = () => state?.modules.find((m) => m.id === state.activeId) ?? null;
const isTab = (id) => typeof id === "string" && id.startsWith("tab-");
const tabInfo = (id) => state?.tabCatalogue.find((t) => t.id === id) ?? null;
// The pages showing: both panes side by side, or just the open one.
const shownIds = () => (state.panes.length === 2 ? state.panes : [state.activeId]);
const pageName = (id) => (id === HOME ? "Home" : tabInfo(id)?.name ?? state.modules.find((m) => m.id === id)?.name ?? "");
// Whether a site's page is showing for this id (the app places it over our screen).
const siteShown = (id) => {
  const status = state.modules.some((m) => m.id === id) && state.statuses[id];
  return Boolean(status && !status.error);
};
const anySiteShown = () => shownIds().some(siteShown);

// ---------- Sidebar ----------

function renderSidebar() {
  const app = $("app");
  // While the flyout is open the sidebar shows expanded, over the page.
  const expanded = state.sidebarExpanded || flyoutOpen;
  app.dataset.expanded = String(expanded);
  app.dataset.fit = String(state.prefs.sidebarFit);
  app.dataset.address = state.prefs.showAddressBar ? "shown" : "hidden";
  const toggle = $("toggle");
  const label = state.sidebarExpanded ? "Collapse sidebar" : "Expand sidebar";
  toggle.setAttribute("aria-label", label);
  toggle.setAttribute("aria-expanded", String(state.sidebarExpanded));
  toggle.title = `${label} (${modKey()}+B)`;

  const profile = state.profile;
  $("profile-btn").hidden = !profile;
  $("profile-avatar").replaceWith(Object.assign(avatar(profile), { id: "profile-avatar" }));
  $("profile-name").textContent = profile?.name ?? "";
  $("profile-game").textContent = gameName(profile);
  // A tooltip only when collapsed (the name is hidden then).
  $("profile-btn").title = profile && !expanded ? `${profile.name} · ${gameName(profile)}` : "";

  $("home-item").setAttribute("aria-current", state.activeId === HOME ? "page" : "false");
  if (state.activeId !== HOME) $("home-item").removeAttribute("aria-current");
  // Like the modules: a tooltip only when the sidebar is collapsed and the name is hidden.
  if (expanded) $("home-item").removeAttribute("title");
  else $("home-item").setAttribute("title", "Home");

  // Built-in tabs (Destiny 2 profiles).
  const tabs = state.tabs.map(tabInfo).filter(Boolean);
  $("tabs-nav").hidden = tabs.length === 0;
  $("tabs-label").textContent = gameName(profile);
  const otherPane = state.panes.length === 2 ? state.panes.find((id) => id !== state.activeId) : null;
  if (otherPane === HOME) $("home-item").dataset.beside = "true";
  else delete $("home-item").dataset.beside;
  $("tabs-list").replaceChildren(
    ...tabs.map((tab) =>
      el(
        "div",
        { class: "mod-row mod-row--tab", "data-id": tab.id, draggable: "true" },
        el(
          "button",
          {
            class: "mod",
            type: "button",
            title: expanded ? null : tab.name,
            "aria-current": tab.id === state.activeId ? "page" : null,
            "data-beside": tab.id === otherPane ? "true" : null,
            onclick: () => hub.select(tab.id),
            oncontextmenu: (event) => {
              event.preventDefault();
              tabMenu(tab, { x: event.clientX, y: event.clientY });
            },
          },
          el("span", { class: "mod__icon mod__icon--tab", "aria-hidden": "true" }, svg(TAB_ICONS[tab.id] ?? ICONS.open)),
          el("span", { class: "mod__name", text: tab.name }),
        ),
        el("button", {
          class: "mod__more",
          type: "button",
          text: "⋯",
          title: `Options for ${tab.name}`,
          "aria-label": `Options for ${tab.name}`,
          "aria-haspopup": "menu",
          onclick: (event) => tabMenu(tab, event.currentTarget),
        }),
      ),
    ),
  );

  $("modules").replaceChildren(
    ...state.modules.map((mod, index) => {
      const status = state.statuses[mod.id];
      const shortcut = index < 9 ? ` (${modKey()}+${index + 1})` : "";
      const row = el(
        "div",
        { class: "mod-row", "data-id": mod.id, draggable: "true" },
        el(
          "button",
          {
            class: "mod",
            type: "button",
            // A tooltip only when collapsed (the name is hidden then).
            title: expanded ? null : `${mod.name}${shortcut}`,
            "aria-current": mod.id === state.activeId ? "page" : null,
            "data-beside": mod.id === otherPane ? "true" : null,
            onclick: () => hub.select(mod.id),
            oncontextmenu: (event) => {
              event.preventDefault();
              moduleMenu(mod, { x: event.clientX, y: event.clientY });
            },
          },
          moduleIcon(mod, status?.loading),
          el("span", { class: "mod__name", text: mod.name }),
        ),
        el("button", {
          class: "mod__more",
          type: "button",
          text: "⋯",
          title: `Options for ${mod.name}`,
          "aria-label": `Options for ${mod.name}`,
          "aria-haspopup": "menu",
          onclick: (event) => moduleMenu(mod, event.currentTarget),
        }),
      );
      return row;
    }),
  );
}

// ---------- Drag to reorder ----------

let dragId = null;
let dropIndex = -1;
const dropLine = el("div", { class: "drop-line", hidden: true });

function rowsExcept(id) {
  return [...$("modules").querySelectorAll(".mod-row")].filter((r) => r.dataset.id !== id);
}

function startDrag(event, row) {
  dragId = row.dataset.id;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", dragId);
  requestAnimationFrame(() => row.classList.add("is-dragging"));
  startStageDrag();
}

$("modules").addEventListener("dragstart", (event) => {
  const row = event.target.closest(".mod-row");
  if (row) startDrag(event, row);
});
// Tabs can't be reordered, but they can be dragged onto the page area.
$("tabs-list").addEventListener("dragstart", (event) => {
  const row = event.target.closest(".mod-row");
  if (row) startDrag(event, row);
});
$("tabs-list").addEventListener("dragend", () => endDrag());

$("modules").addEventListener("dragover", (event) => {
  if (!dragId || isTab(dragId)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  const rows = rowsExcept(dragId);
  dropIndex = rows.findIndex((row) => {
    const r = row.getBoundingClientRect();
    return event.clientY < r.top + r.height / 2;
  });
  if (dropIndex < 0) dropIndex = rows.length;
  const list = $("modules");
  const listTop = list.getBoundingClientRect().top - list.scrollTop;
  const ref = rows[dropIndex] ?? rows[rows.length - 1];
  const r = ref?.getBoundingClientRect();
  const y = !r ? 0 : dropIndex < rows.length ? r.top - listTop - 2 : r.bottom - listTop;
  dropLine.style.top = `${y}px`;
  dropLine.hidden = false;
  if (!dropLine.isConnected) list.append(dropLine);
});

function endDrag() {
  dragId = null;
  dropIndex = -1;
  dropLine.hidden = true;
  document.querySelectorAll(".sidebar .is-dragging").forEach((r) => r.classList.remove("is-dragging"));
  endStageDrag();
}

$("modules").addEventListener("drop", (event) => {
  if (!dragId || isTab(dragId)) return;
  event.preventDefault();
  const ids = state.modules.map((m) => m.id).filter((id) => id !== dragId);
  ids.splice(dropIndex < 0 ? ids.length : dropIndex, 0, dragId);
  // Show the new order straight away; the app saves it.
  state.modules.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  endDrag();
  renderSidebar();
  hub.reorder(ids);
});
$("modules").addEventListener("dragend", endDrag);
$("modules").addEventListener("dragleave", (event) => {
  if (!$("modules").contains(event.relatedTarget)) dropLine.hidden = true;
});

// ---------- Toolbar, stage, home ----------

const ERRORS = {
  offline: { icon: "offline", title: (n) => `Can't reach ${n}`, text: "You seem to be offline. Check your internet connection, then try again." },
  "not-found": { icon: "alert", title: (n) => `Couldn't find ${n}`, text: "The site's address couldn't be found. It may be down, or the address may have changed." },
  timeout: { icon: "alert", title: (n) => `${n} took too long`, text: "The site didn't answer in time. It may be busy; try again in a moment." },
  unreachable: { icon: "alert", title: (n) => `Couldn't connect to ${n}`, text: "The site isn't answering right now. It may be down for a moment." },
  certificate: { icon: "alert", title: (n) => `${n} isn't safe to open`, text: "The site's security certificate isn't valid, so Mida didn't open it." },
  server: { icon: "alert", title: (n) => `${n} is having problems`, text: "The site answered with an error. This is on the site's side; try again in a moment.", anyway: true },
  crashed: { icon: "alert", title: (n) => `${n} stopped working`, text: "The page crashed. Reload it to carry on." },
  other: { icon: "alert", title: (n) => `Couldn't load ${n}`, text: "Something went wrong loading the site. Try again, or open it in your browser." },
};

function renderActive() {
  const mod = activeModule();
  const status = mod ? state.statuses[mod.id] : null;

  for (const id of ["back", "forward", "reload", "home", "external"]) $(id).disabled = !mod;
  $("title").textContent = mod ? status?.title || mod.name : pageName(state.activeId);
  $("url").textContent = mod ? status?.url || mod.url : "";
  $("progress").dataset.on = String(Boolean(status?.loading));
  document.title = state.activeId !== HOME ? `${pageName(state.activeId)} · Mida` : "Mida";
  renderStage();
}

// The "couldn't load" panel for a module whose page failed.
function errorPanel(mod, e) {
  const info = ERRORS[e.kind] ?? ERRORS.other;
  return el(
    "div",
    { class: "stage__msg" },
    el("div", { class: "stage__icon" }, svg(ICONS[info.icon])),
    el("h2", { text: info.title(mod.name) }),
    el("p", { text: info.text }),
    e.status ? el("p", { class: "stage__detail", text: `Error ${e.status}` }) : "",
    el(
      "div",
      { class: "stage__actions" },
      el("button", { class: "btn btn--primary", type: "button", text: "Try again", onclick: () => hub.moduleAction(mod.id, "reload") }),
      info.anyway ? el("button", { class: "btn", type: "button", text: "Show the page anyway", onclick: () => hub.moduleAction(mod.id, "show-anyway") }) : null,
      el("button", { class: "btn", type: "button", text: "Open in your browser", onclick: () => hub.moduleAction(mod.id, "browser") }),
    ),
  );
}

// ---------- Panes: one page, or two side by side ----------
//
// Each pane is a box in the page area. For a site, the app places the real page over the pane's
// body (we report where the bodies are); Home, built-in tabs and the error panel are drawn in the
// body itself. Pane elements are kept between renders so a tab keeps its scroll position and a
// page's picture (see freeze) survives updates.

const panes = []; // { root, head, body, content, snapshot, key }
const paneObserver = new ResizeObserver(() => reportPanes());

const divider = el("div", {
  class: "pane-divider",
  role: "separator",
  tabindex: "0",
  "aria-orientation": "vertical",
  "aria-label": "Resize the two pages (left and right arrow keys)",
});

function makePane() {
  const content = el("div", { class: "pane__content" });
  const snapshot = el("img", { class: "pane__snapshot", alt: "", hidden: true });
  const body = el("div", { class: "pane__body" }, content, snapshot);
  const head = el("div", { class: "pane__head" });
  const root = el("div", { class: "pane" }, head, body);
  paneObserver.observe(body);
  return { root, head, body, content, snapshot, key: null };
}

// Tell the app where the pane bodies are (left to right), in our page's pixels.
function reportPanes() {
  if (!state) return;
  const rects = panes.map((p) => {
    const r = p.body.getBoundingClientRect();
    return { x: Math.max(0, r.left), y: Math.max(0, r.top), width: Math.max(1, r.width), height: Math.max(1, r.height) };
  });
  hub.setPanes(rects);
}
window.addEventListener("resize", reportPanes);

function setSplitColumns(percent) {
  $("stage").style.gridTemplateColumns = `minmax(0, ${percent}fr) var(--divider) minmax(0, ${100 - percent}fr)`;
}

function renderStage() {
  const stage = $("stage");
  const ids = state.firstRunDone ? shownIds() : [];
  const split = ids.length === 2;
  stage.dataset.split = String(split);
  while (panes.length < ids.length) panes.push(makePane());
  while (panes.length > ids.length) {
    const p = panes.pop();
    paneObserver.unobserve(p.body);
    p.root.remove();
  }
  const want = split ? [panes[0].root, divider, panes[1].root] : panes.map((p) => p.root);
  const have = [...stage.children].filter((n) => n.id !== "drop-zones");
  if (want.length !== have.length || want.some((n, i) => n !== have[i])) stage.replaceChildren(...want, $("drop-zones"));
  if (split) setSplitColumns(state.split);
  else stage.style.gridTemplateColumns = "";
  ids.forEach((id, i) => renderPane(panes[i], id, split, i));
  requestAnimationFrame(reportPanes);
}

function renderPane(pane, id, split, index) {
  pane.root.dataset.id = id;
  pane.root.dataset.active = String(split && id === state.activeId);

  pane.head.hidden = !split;
  if (split) {
    const mod = state.modules.find((m) => m.id === id);
    const other = state.panes[1 - index];
    pane.head.replaceChildren(
      el(
        "button",
        { class: "pane__title", type: "button", title: "Make this the open page", onclick: () => hub.select(id) },
        mod ? moduleIcon(mod, state.statuses[id]?.loading) : el("span", { class: "mod__icon mod__icon--tab", "aria-hidden": "true" }, svg(id === HOME ? ICONS.home : TAB_ICONS[id] ?? ICONS.open)),
        el("span", { class: "pane__name", text: mod ? state.statuses[id]?.title || mod.name : pageName(id) }),
      ),
      el("button", { class: "icon-btn icon-btn--small", type: "button", title: "Swap sides", "aria-label": "Swap sides", onclick: () => hub.swapPanes() }, svg(ICONS.swap)),
      el("button", { class: "icon-btn icon-btn--small", type: "button", title: "Close this side", "aria-label": `Close ${pageName(id)}`, onclick: () => hub.closePane(other) }, svg(ICONS.close)),
    );
  }

  // What the body shows. Built again only when that changes (tabs keep their own state).
  const mod = state.modules.find((m) => m.id === id);
  const error = mod && state.statuses[id]?.error;
  const key = id === HOME ? "home" : isTab(id) ? `tab:${id}` : error ? `error:${id}:${error.kind}:${error.status}` : `site:${id}`;
  if (key !== pane.key) delete pane.content.dataset.tab;
  if (id === HOME) {
    pane.content.replaceChildren(buildHome());
  } else if (key !== pane.key) {
    pane.content.replaceChildren();
    pane.content.scrollTop = 0;
    if (isTab(id)) mountTab(id, pane.content);
    else if (error) pane.content.append(errorPanel(mod, error));
  } else if (isTab(id)) {
    window.midaTabs?.update(id, pane.content, tabContext());
  }
  pane.key = key;
}

// Built-in tabs live in tabs.js (loaded as a module, so it may arrive a moment after this file).
function tabContext() {
  return {
    el,
    svg,
    hub,
    openMenu,
    openSettings,
    isFrozen: () => frozen,
    // Always the latest state (it's replaced on every update).
    get state() {
      return state;
    },
  };
}
function mountTab(id, container) {
  if (window.midaTabs) window.midaTabs.mount(id, container, tabContext());
  else container.append(el("p", { class: "tab__loading", text: "Loading…" }));
}
window.addEventListener("mida-tabs-ready", () => {
  for (const pane of panes) pane.key = null;
  if (state) renderStage();
});

// Dragging the divider between the two pages.
{
  let dragging = false;
  divider.addEventListener("pointerdown", async (event) => {
    event.preventDefault();
    divider.setPointerCapture(event.pointerId);
    dragging = true;
    divider.classList.add("is-dragging");
    // The pages are pictures while resizing, so the pointer stays on our screen.
    await freeze();
  });
  divider.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const r = $("stage").getBoundingClientRect();
    state.split = Math.min(80, Math.max(20, Math.round(((event.clientX - r.left) / r.width) * 100)));
    setSplitColumns(state.split);
  });
  const stop = () => {
    if (!dragging) return;
    dragging = false;
    divider.classList.remove("is-dragging");
    hub.setSplit(state.split);
    maybeUnfreeze();
  };
  divider.addEventListener("pointerup", stop);
  divider.addEventListener("pointercancel", stop);
  divider.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    state.split = Math.min(80, Math.max(20, state.split + (event.key === "ArrowLeft" ? -5 : 5)));
    setSplitColumns(state.split);
    hub.setSplit(state.split);
  });
}

// Dragging a module or tab from the sidebar onto the page area: left, right, or open it here.
function startStageDrag() {
  if (!state.firstRunDone) return;
  freeze();
  $("drop-zones").hidden = false;
}
function endStageDrag() {
  const zones = $("drop-zones");
  if (zones.hidden) return;
  zones.hidden = true;
  zones.querySelectorAll("[data-over]").forEach((z) => delete z.dataset.over);
  maybeUnfreeze();
}
for (const zone of document.querySelectorAll(".drop-zone")) {
  zone.addEventListener("dragover", (event) => {
    if (!dragId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    zone.dataset.over = "true";
  });
  zone.addEventListener("dragleave", () => delete zone.dataset.over);
  zone.addEventListener("drop", (event) => {
    if (!dragId) return;
    event.preventDefault();
    const id = dragId;
    const side = zone.dataset.side;
    endDrag();
    if (side === "open" || (state.panes.length !== 2 && id === state.activeId)) hub.select(id);
    else hub.split(id, side);
  });
}

function buildHome() {
  const profile = state.profile;
  const isDefault = profile && state.defaultProfile === profile.id;
  return el(
    "div",
    { class: "home" },
    el(
      "header",
      { class: "home__hero" },
      // Glyph markings for the Foundry theme (hidden in the others).
      el("i", { class: "home__glyph home__glyph--start", "aria-hidden": "true" }),
      el("i", { class: "home__glyph home__glyph--end", "aria-hidden": "true" }),
      avatar(profile, "avatar--large"),
      el(
        "div",
        {},
        el("h1", { class: "home__name", text: profile?.name ?? "" }),
        el(
          "p",
          { class: "home__game" },
          document.createTextNode(gameName(profile)),
          isDefault ? el("span", { class: "home__tag", text: "Default profile" }) : null,
        ),
      ),
    ),
    ...(state.tabs.length
      ? [
          el("h2", { class: "band", text: "Your tabs" }),
          el(
            "div",
            { class: "tiles" },
            ...state.tabs.map(tabInfo).filter(Boolean).map((tab) =>
              el(
                "button",
                { class: "tile", type: "button", onclick: () => hub.select(tab.id) },
                el("span", { class: "mod__icon mod__icon--tab", "aria-hidden": "true" }, svg(TAB_ICONS[tab.id] ?? ICONS.open)),
                el("span", { class: "tile__text" }, el("span", { class: "tile__name", text: tab.name }), el("span", { class: "tile__host", text: tab.blurb })),
              ),
            ),
          ),
        ]
      : []),
    el("h2", { class: "band", text: "Your modules" }),
    el(
      "div",
      { class: "tiles" },
      ...state.modules.map((mod) =>
        el(
          "button",
          { class: "tile", type: "button", onclick: () => hub.select(mod.id) },
          moduleIcon(mod, false),
          el("span", { class: "tile__text" }, el("span", { class: "tile__name", text: mod.name }), el("span", { class: "tile__host", text: hostOf(mod.url) })),
        ),
      ),
      el(
        "button",
        { class: "tile tile--add", type: "button", onclick: openAdd },
        el("span", { class: "mod__icon mod__icon--add" }, svg(ICONS.plus)),
        el("span", { class: "tile__text" }, el("span", { class: "tile__name", text: "Add a module" }), el("span", { class: "tile__host", text: "A site you use for this game" })),
      ),
    ),
  );
}

function render() {
  applyTheme(state.prefs);
  renderSidebar();
  renderActive();
  renderUpdate();
  if (!state.firstRunDone && !$("wizard").open) openWizard("first");
  if ($("add").open) renderAddList();
  // The Tabs page shows the Bungie account, which changes while it's open (signing in).
  if ($("settings").open && settingsTab === "tabs") renderSettings();
}

// ---------- Pages above our screen: freeze while a menu or dialog is open ----------
//
// Module pages always sit above this screen. To show a menu or pop-up over one, we take a
// picture of each page showing, show it in the page's place, then hide the real pages until
// we're done.

let frozen = false;

async function freeze() {
  if (frozen) return;
  frozen = true;
  await Promise.all(
    panes.map(async (pane) => {
      const id = pane.root.dataset.id;
      const shot = siteShown(id) ? await hub.freezePage(id) : null;
      if (!shot || !frozen) return;
      pane.snapshot.src = shot;
      try {
        await pane.snapshot.decode();
      } catch {
        // Shown without waiting.
      }
      pane.snapshot.hidden = false;
    }),
  );
  await hub.setOverlay(true);
}

function anythingOpen() {
  return flyoutOpen || !$("menu").hidden || Boolean(document.querySelector("dialog[open]"));
}

// Called after a menu or dialog closes; waits a moment in case another one opens straight away.
function maybeUnfreeze() {
  setTimeout(async () => {
    if (!frozen || anythingOpen()) return;
    frozen = false;
    await hub.setOverlay(false);
    setTimeout(() => {
      if (frozen) return;
      for (const pane of panes) {
        pane.snapshot.hidden = true;
        pane.snapshot.removeAttribute("src");
      }
    }, 90);
  }, 40);
}

async function openDialog(dialog) {
  closeMenu();
  closeFlyout();
  await freeze();
  if (!dialog.open) dialog.showModal();
}

for (const dialog of document.querySelectorAll("dialog")) {
  dialog.addEventListener("close", () => {
    maybeUnfreeze();
    if (state?.update?.status === "available" && announcedUpdate !== state.update.version) setTimeout(maybeAnnounce, 100);
  });
}

// ---------- Menus ----------

let menuAnchor = null;

function closeMenu() {
  const menu = $("menu");
  if (menu.hidden) return;
  menu.hidden = true;
  menu.replaceChildren();
  if (menuAnchor instanceof HTMLElement) {
    menuAnchor.setAttribute("aria-expanded", "false");
    if (menu.contains(document.activeElement) || document.activeElement === document.body) menuAnchor.focus();
  }
  menuAnchor = null;
  // A menu opened from the flyout: the flyout stays while the pointer is still over it.
  if (flyoutOpen && !document.querySelector(".sidebar").matches(":hover")) closeFlyout();
  maybeUnfreeze();
}

// ---------- Sidebar flyout ----------
//
// With the sidebar collapsed, pointing at it opens the full sidebar over the page for a moment.
// The page can't sit under our own screen, so like a menu it's replaced by a picture of itself
// while the flyout is open; the page is never resized.

let flyoutOpen = false;
let flyoutTimer = null;

async function openFlyout() {
  if (flyoutOpen || state.sidebarExpanded || !state.prefs.sidebarFlyout) return;
  flyoutOpen = true;
  await freeze();
  if (!flyoutOpen) return;
  $("app").dataset.flyout = "open";
  renderSidebar();
}

function closeFlyout() {
  clearTimeout(flyoutTimer);
  if (!flyoutOpen) return;
  flyoutOpen = false;
  delete $("app").dataset.flyout;
  renderSidebar();
  maybeUnfreeze();
}

{
  const sidebar = document.querySelector(".sidebar");
  sidebar.addEventListener("pointerenter", () => {
    if (!state || state.sidebarExpanded || !state.prefs.sidebarFlyout || flyoutOpen || anythingOpen()) return;
    clearTimeout(flyoutTimer);
    flyoutTimer = setTimeout(openFlyout, 160);
  });
  sidebar.addEventListener("pointerleave", () => {
    clearTimeout(flyoutTimer);
    if (flyoutOpen && $("menu").hidden) closeFlyout();
  });
  // Choosing a page closes it: the new page should show straight away.
  sidebar.addEventListener("click", (event) => {
    if (flyoutOpen && event.target.closest(".mod:not(.mod--add), .mod-row--home .mod")) closeFlyout();
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && flyoutOpen && $("menu").hidden) closeFlyout();
  });
}

// items: { label, detail?, icon?, avatar?, danger?, disabled?, checked?, action } | "sep" | { heading }
async function openMenu(anchor, items) {
  closeMenu();
  const menu = $("menu");
  menuAnchor = anchor;
  const nodes = items.map((item) => {
    if (item === "sep") return el("div", { class: "menu__sep", role: "separator" });
    if (item.heading) return el("div", { class: "menu__label", text: item.heading });
    return el(
      "button",
      {
        class: `menu__item${item.danger ? " menu__item--danger" : ""}`,
        type: "button",
        role: "menuitem",
        disabled: item.disabled || null,
        onclick: () => {
          closeMenu();
          item.action();
        },
      },
      item.avatar ?? (item.icon ? svg(ICONS[item.icon]) : null),
      item.detail
        ? el("span", { class: "menu__text" }, el("span", { text: item.label }), el("small", { text: item.detail }))
        : el("span", { class: "menu__text", text: item.label }),
      item.checked ? el("span", { class: "menu__check", text: "✓" }) : null,
    );
  });
  menu.replaceChildren(...nodes);
  menu.style.left = "0px";
  menu.style.top = "0px";
  menu.hidden = false;

  // Place it beside the button (or at the pointer), kept inside the window.
  const a = anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y };
  const m = menu.getBoundingClientRect();
  let left = anchor instanceof HTMLElement ? a.left : a.left;
  let top = a.bottom + 4;
  if (left + m.width > innerWidth - 8) left = Math.max(8, innerWidth - m.width - 8);
  if (top + m.height > innerHeight - 8) top = Math.max(8, a.top - m.height - 4);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  if (anchor instanceof HTMLElement) anchor.setAttribute("aria-expanded", "true");

  // Over a site's page? Freeze it so the menu shows on top.
  const s = $("stage").getBoundingClientRect();
  const overlaps = left < s.right && left + m.width > s.left && top < s.bottom && top + m.height > s.top;
  if (overlaps && anySiteShown()) {
    menu.style.visibility = "hidden";
    await freeze();
    if (menu.hidden) return;
    menu.style.visibility = "";
  }
  menu.querySelector(".menu__item:not(:disabled)")?.focus();
}

document.addEventListener("mousedown", (event) => {
  if (!$("menu").hidden && !$("menu").contains(event.target) && !event.target.closest("[aria-haspopup]")) closeMenu();
});
$("menu").addEventListener("keydown", (event) => {
  const items = [...$("menu").querySelectorAll(".menu__item:not(:disabled)")];
  const i = items.indexOf(document.activeElement);
  if (event.key === "Escape") {
    event.preventDefault();
    closeMenu();
  } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const step = event.key === "ArrowDown" ? 1 : -1;
    items[(i + step + items.length) % items.length]?.focus();
  } else if (event.key === "Tab") {
    closeMenu();
  }
});
// Close menus when Mida loses the keyboard to another program. Opening a menu over a site hands
// the keyboard to our screen, which can blur it for a moment on Windows: only a lasting blur counts.
window.addEventListener("blur", () => setTimeout(() => !document.hasFocus() && closeMenu(), 150));

// "Open side by side" / "Close this side" for a page (module, tab or Home).
function splitItems(id) {
  const split = state.panes.length === 2;
  if (split && state.panes.includes(id)) {
    const other = state.panes.find((p) => p !== id);
    return [{ label: "Close this side", icon: "close", action: () => hub.closePane(other) }];
  }
  if (!split && id === state.activeId) return [];
  return [{ label: split ? "Put it on the right" : "Open side by side", icon: "split", action: () => hub.split(id, "right") }];
}

function tabMenu(tab, anchor) {
  openMenu(anchor, [
    { label: `Open ${tab.name}`, icon: "open", action: () => hub.select(tab.id) },
    ...splitItems(tab.id),
    "sep",
    { label: "Hide this tab", icon: "remove", action: () => hub.setTabs(state.tabs.filter((t) => t !== tab.id)) },
    { label: "Choose tabs…", icon: "edit", action: () => openSettings("tabs") },
  ]);
}

function moduleMenu(mod, anchor) {
  const index = state.modules.findIndex((m) => m.id === mod.id);
  const hasPage = Boolean(state.statuses[mod.id]);
  openMenu(anchor, [
    { label: `Open ${mod.name}`, icon: "open", action: () => hub.select(mod.id) },
    ...splitItems(mod.id),
    { label: "Reload", icon: "reload", disabled: !hasPage, action: () => hub.moduleAction(mod.id, "reload") },
    { label: "Open in your browser", icon: "browser", action: () => hub.moduleAction(mod.id, "browser") },
    "sep",
    { label: "Rename…", icon: "rename", action: () => openRename(mod) },
    { label: "Refresh icon", icon: "icon", disabled: !hasPage, action: () => hub.moduleAction(mod.id, "refresh-icon") },
    { label: "Move up", icon: "up", disabled: index <= 0, action: () => hub.moduleAction(mod.id, "up") },
    { label: "Move down", icon: "down", disabled: index >= state.modules.length - 1, action: () => hub.moduleAction(mod.id, "down") },
    "sep",
    { label: `Remove ${mod.name}`, icon: "remove", danger: true, action: () => hub.moduleAction(mod.id, "remove") },
  ]);
}

function profileMenu() {
  const current = state.profile;
  const others = state.profiles;
  openMenu($("profile-btn"), [
    { heading: "Profiles" },
    ...others.map((p) => ({
      label: p.name,
      detail: `${gameName(p)}${p.id === state.defaultProfile ? " · Default" : ""}`,
      avatar: avatar(p),
      checked: p.id === current?.id,
      action: () => p.id !== current?.id && hub.switchProfile(p.id),
    })),
    "sep",
    { label: "Edit profile…", icon: "edit", action: () => openProfileDialog(current) },
    {
      label: current?.id === state.defaultProfile ? "This is your default profile" : "Make this my default profile",
      icon: "star",
      disabled: current?.id === state.defaultProfile,
      action: () => hub.setDefaultProfile(current.id),
    },
    { label: "New profile…", icon: "plus", disabled: others.length >= state.maxProfiles, action: () => openWizard("new") },
    ...(others.length > 1
      ? [
          "sep",
          {
            label: `Delete ${current?.name}…`,
            icon: "remove",
            danger: true,
            action: () =>
              confirmDialog(`Delete ${current.name}?`, "Its modules and settings are removed from Mida. Your sign-ins on the sites aren't affected.", "Delete profile", () =>
                hub.deleteProfile(current.id),
              ),
          },
        ]
      : []),
  ]);
}

$("profile-btn").addEventListener("click", profileMenu);

// ---------- Profile form (first run, new profile, edit profile) ----------

// Resize a chosen picture to a small square (cropped to the middle).
function squarePicture(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const size = 128;
      const canvas = el("canvas", { width: size, height: size });
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      const sx = (img.naturalWidth - side) / 2;
      const sy = (img.naturalHeight - side) / 2;
      canvas.getContext("2d").drawImage(img, sx, sy, side, side, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/webp", 0.9));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file isn't a picture Mida can read."));
    };
    img.src = url;
  });
}

// The Inventory backdrop: the player's own picture, shrunk to at most 1920 wide and kept in this
// computer's browser storage (never uploaded). Read as a data address, which the page rules allow.
const BACKDROP_KEY = "mida-inv-backdrop";
function backdropPicture(file) {
  return new Promise((resolve, reject) => {
    const fail = () => reject(new Error("That file isn't a picture Mida can read."));
    if (!file.type.startsWith("image/")) return fail();
    const reader = new FileReader();
    reader.onerror = fail;
    reader.onload = () => {
      const img = new Image();
      img.onerror = fail;
      img.onload = () => {
        const scale = Math.min(1, 1920 / img.naturalWidth, 1200 / img.naturalHeight);
        const canvas = el("canvas", { width: Math.round(img.naturalWidth * scale), height: Math.round(img.naturalHeight * scale) });
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// What's drawn on inventory item icons; inventory.js reads the same key and defaults.
const OVERLAYS_KEY = "mida-inv-overlays";
const OVERLAY_OPTIONS = [
  ["power", "Power level", true],
  ["lock", "Lock icon (top-right corner)", true],
  ["element", "Element", true],
  ["tier", "Gear tier", false],
  ["watermark", "Season mark", true],
  ["masterwork", "Gold edge when masterworked", true],
  ["banner", "Dark strip behind power and element", false],
];
function overlaysSetting() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(OVERLAYS_KEY) ?? "{}") ?? {};
  } catch {
    // Defaults.
  }
  const save = (key, on) => {
    saved = { ...saved, [key]: on };
    try {
      localStorage.setItem(OVERLAYS_KEY, JSON.stringify(saved));
    } catch {
      // Only a convenience.
    }
    window.dispatchEvent(new Event("mida-overlays"));
  };
  return setting(
    "Inventory item icons",
    "What's drawn on top of each item in the Inventory tab.",
    el(
      "div",
      { class: "overlay-toggles" },
      ...OVERLAY_OPTIONS.map(([key, label, fallback]) =>
        el("div", { class: "overlay-toggles__row" }, el("span", { text: label }), toggle(`ov-${key}`, saved[key] ?? fallback, (v) => save(key, v), label)),
      ),
    ),
  );
}

function backdropSetting() {
  let saved = null;
  try {
    saved = localStorage.getItem(BACKDROP_KEY);
  } catch {
    // Storage unavailable: the built-in backdrop shows.
  }
  const status = el("span", { class: "inline-status", role: "status", text: saved ? "Using your picture." : "Using Mida's own dark backdrop." });
  const preview = el("span", { class: "backdrop-preview" });
  if (saved) preview.style.backgroundImage = `url("${saved}")`;
  const changed = () => window.dispatchEvent(new Event("mida-backdrop"));
  const choose = el("button", {
    class: "btn btn--small",
    type: "button",
    "data-key": "backdrop",
    text: "Choose picture…",
    onclick: () => {
      const input = $("picture-input");
      input.value = "";
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        try {
          const picture = await backdropPicture(file);
          localStorage.setItem(BACKDROP_KEY, picture);
          changed();
          renderSettings();
        } catch (err) {
          status.textContent = err?.name === "QuotaExceededError" ? "That picture is too big to keep. Try a smaller one." : err.message;
        }
      };
      input.click();
    },
  });
  const clear = el("button", {
    class: "btn btn--small",
    type: "button",
    text: "Remove",
    disabled: !saved || null,
    onclick: () => {
      try {
        localStorage.removeItem(BACKDROP_KEY);
      } catch {
        // Nothing to remove.
      }
      changed();
      renderSettings();
    },
  });
  return setting("Inventory backdrop", "A picture from your computer behind the Inventory tab, darkened and blurred. It stays on this computer.", el("div", { class: "picture" }, preview, el("div", {}, el("div", { class: "picture__buttons" }, choose, clear), status)));
}

function profileForm(initial = {}) {
  let picture = initial.image ?? null;
  const name = el("input", { class: "field__input", type: "text", maxlength: "32", value: initial.name ?? "", placeholder: "Your name or gamertag" });
  const preview = el("span");
  const showPicture = () => preview.replaceChildren(avatar({ name: name.value || "?", image: picture }, "avatar--medium"));
  name.addEventListener("input", showPicture);
  const error = el("p", { class: "dialog__error", role: "alert" });
  const choose = el("button", {
    class: "btn btn--small",
    type: "button",
    text: "Choose picture",
    onclick: () => {
      const input = $("picture-input");
      input.value = "";
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        try {
          picture = await squarePicture(file);
          error.textContent = "";
        } catch (err) {
          error.textContent = err.message;
        }
        showPicture();
      };
      input.click();
    },
  });
  const clear = el("button", { class: "btn btn--small", type: "button", text: "Remove", onclick: () => ((picture = null), showPicture()) });

  const games = state.games.map((g) => ({ id: g.id, name: g.name, note: "Suggested sites included" }));
  games.push({ id: "custom", name: "Another game", note: "Add your own sites" });
  const selected = initial.game ?? "destiny2";
  const customName = el("input", { class: "field__input", type: "text", maxlength: "40", value: initial.gameName ?? "", placeholder: "Game name" });
  const customField = el("label", { class: "field" }, el("span", { class: "field__label", text: "Which game?" }), customName);
  const gameChoices = el(
    "div",
    { class: "games", role: "radiogroup", "aria-label": "Game" },
    ...games.map((g) =>
      el(
        "label",
        { class: "game" },
        el("input", { type: "radio", name: "profile-game", value: g.id, checked: g.id === selected || null, onchange: () => (customField.hidden = g.id !== "custom") }),
        el("span", {}, el("span", { class: "game__name", text: g.name }), el("br"), el("span", { class: "game__note", text: g.note })),
      ),
    ),
  );
  customField.hidden = selected !== "custom";
  showPicture();

  const node = el(
    "div",
    { class: "profile-form" },
    el("label", { class: "field" }, el("span", { class: "field__label", text: "Profile name" }), name),
    el("div", { class: "picture" }, preview, el("div", {}, el("div", { class: "field__label", text: "Picture (optional)" }), el("div", { class: "picture__buttons" }, choose, clear))),
    el("div", { class: "field" }, el("span", { class: "field__label", text: "Game" }), gameChoices, customField),
    error,
  );
  return {
    node,
    focus: () => name.focus(),
    read: () => ({
      name: name.value.trim(),
      image: picture,
      game: gameChoices.querySelector("input:checked")?.value ?? "custom",
      gameName: customName.value.trim(),
    }),
    check(value) {
      if (!value.name) return "Give your profile a name.";
      if (value.game === "custom" && !value.gameName) return "Type the game's name.";
      return "";
    },
  };
}

// ---------- Wizard: first run and new profile ----------

const wizard = { mode: "first", step: 1, form: null, profile: null, picks: new Set() };

function openWizard(mode) {
  wizard.mode = mode;
  wizard.step = 1;
  wizard.form = profileForm({});
  wizard.profile = null;
  wizard.picks = new Set(state.catalogue.filter((c) => c.starter).map((c) => c.id));
  renderWizard();
  openDialog($("wizard")).then(() => wizard.form.focus());
}

function renderWizard() {
  const first = wizard.mode === "first";
  $("wizard-error").textContent = "";
  $("wizard-back").textContent = wizard.step === 1 ? "Cancel" : "Back";
  $("wizard-back").hidden = first && wizard.step === 1;
  if (wizard.step === 1) {
    $("wizard-title").textContent = first ? "Welcome to Mida" : "New profile";
    $("wizard-lede").textContent = first
      ? "Your game's companion sites in one window. Start with a profile: one for each game you play."
      : "A profile keeps the modules for one game. Switch profiles from the top of the sidebar.";
    $("wizard-body").replaceChildren(wizard.form.node);
    $("wizard-next").textContent = "Next";
    return;
  }
  const p = wizard.profile;
  const finish = first ? "Start" : "Create profile";
  $("wizard-next").textContent = finish;
  const recommended = state.catalogue.filter((c) => c.game === p.game);
  if (!recommended.length) {
    $("wizard-title").textContent = "Almost done";
    $("wizard-lede").textContent = `Mida doesn't have suggested sites for ${p.gameName || "this game"} yet.`;
    $("wizard-body").replaceChildren(
      el("p", { class: "note", text: "Add the sites you use with “Add a module” in the sidebar: any https site works. Your profile starts on its Home page." }),
    );
    return;
  }
  $("wizard-title").textContent = "Pick your modules";
  $("wizard-lede").textContent = `Sites for ${gameName(p)}. You can add or remove modules any time.`;
  const groups = [
    ["Starter modules", recommended.filter((c) => c.starter)],
    ["More sites", recommended.filter((c) => !c.starter)],
  ].filter(([, items]) => items.length);
  $("wizard-body").replaceChildren(
    ...groups.flatMap(([title, items]) => [
      el("h2", { class: "band", text: title }),
      el(
        "div",
        { class: "picks" },
        ...items.map((c) =>
          el(
            "label",
            { class: "pick" },
            el("input", {
              type: "checkbox",
              value: c.id,
              checked: wizard.picks.has(c.id) || null,
              onchange: (e) => (e.target.checked ? wizard.picks.add(c.id) : wizard.picks.delete(c.id)),
            }),
            el("span", { class: "pick__name", text: c.name }),
            el("span", { class: "pick__blurb", text: c.blurb }),
            el("span", { class: "pick__host", text: hostOf(c.url) }),
          ),
        ),
      ),
    ]),
  );
}

// The first-run picker can't be skipped with Esc: the app needs a profile.
$("wizard").addEventListener("cancel", (event) => {
  if (wizard.mode === "first") event.preventDefault();
});

$("wizard-back").addEventListener("click", () => {
  if (wizard.step === 1) $("wizard").close();
  else {
    wizard.step = 1;
    renderWizard();
  }
});

$("wizard-next").addEventListener("click", async () => {
  if (wizard.step === 1) {
    const value = wizard.form.read();
    const problem = wizard.form.check(value);
    if (problem) {
      $("wizard-error").textContent = problem;
      return;
    }
    wizard.profile = value;
    wizard.step = 2;
    renderWizard();
    return;
  }
  const button = $("wizard-next");
  button.disabled = true;
  const picks = state.catalogue.filter((c) => c.game === wizard.profile.game && wizard.picks.has(c.id)).map((c) => c.id);
  const result =
    wizard.mode === "first" ? await hub.finishFirstRun(wizard.profile, picks) : await hub.createProfile(wizard.profile, picks);
  button.disabled = false;
  if (result?.ok) $("wizard").close();
  else $("wizard-error").textContent = result?.error ?? "Something went wrong.";
});

// ---------- Edit profile ----------

let editing = null;

function openProfileDialog(profile) {
  editing = { id: profile.id, form: profileForm(profile) };
  $("profile-error").textContent = "";
  $("profile-form-host").replaceChildren(editing.form.node);
  openDialog($("profile-dialog")).then(() => editing.form.focus());
}
$("profile-cancel").addEventListener("click", () => $("profile-dialog").close());
$("profile-save").addEventListener("click", async () => {
  const value = editing.form.read();
  const problem = editing.form.check(value);
  if (problem) {
    $("profile-error").textContent = problem;
    return;
  }
  const result = await hub.updateProfile(editing.id, value);
  if (result?.ok) $("profile-dialog").close();
  else $("profile-error").textContent = result?.error ?? "Something went wrong.";
});

// ---------- Confirm ----------

let confirmAction = null;
function confirmDialog(title, text, yes, action) {
  $("confirm-title").textContent = title;
  $("confirm-text").textContent = text;
  $("confirm-yes").textContent = yes;
  confirmAction = action;
  openDialog($("confirm"));
}
$("confirm-no").addEventListener("click", () => $("confirm").close());
$("confirm-yes").addEventListener("click", () => {
  $("confirm").close();
  confirmAction?.();
});

// ---------- Rename ----------

let renaming = null;
function openRename(mod) {
  renaming = mod.id;
  $("rename-input").value = mod.name;
  $("rename-error").textContent = "";
  openDialog($("rename")).then(() => $("rename-input").select());
}
$("rename-cancel").addEventListener("click", () => $("rename").close());
$("rename-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const result = await hub.renameModule(renaming, $("rename-input").value);
  if (result?.ok) $("rename").close();
  else $("rename-error").textContent = result?.error ?? "Something went wrong.";
});

// ---------- Add a module ----------

function renderAddList() {
  const added = new Set(state.modules.map((m) => m.id));
  const game = state.profile?.game;
  const recommended = state.catalogue.filter((c) => c.game === game);
  $("add-list-section").hidden = recommended.length === 0;
  $("add-list-title").textContent = `Recommended for ${gameName(state.profile)}`;
  const left = recommended.filter((c) => !added.has(c.id));
  $("add-list").replaceChildren(
    ...(left.length
      ? left.map((c) =>
          el(
            "div",
            { class: "cat-row" },
            el("div", { class: "cat-row__text" }, el("span", { class: "cat-row__name", text: c.name }), el("span", { class: "cat-row__blurb", text: c.blurb })),
            el("button", { class: "btn btn--small", type: "button", text: "Add", "aria-label": `Add ${c.name}`, onclick: () => addWith(() => hub.addFromCatalogue(c.id)) }),
          ),
        )
      : [el("p", { class: "cat-empty", text: "Everything recommended is already in your sidebar." })]),
  );
}

async function addWith(action) {
  $("add-error").textContent = "";
  const result = await action();
  if (result?.ok) {
    $("add-form").reset();
    $("add").close();
  } else {
    $("add-error").textContent = result?.error ?? "Something went wrong.";
  }
}

function openAdd() {
  renderAddList();
  $("add-error").textContent = "";
  openDialog($("add"));
}

$("add-open").addEventListener("click", openAdd);
$("add-close").addEventListener("click", () => $("add").close());
$("add-form").addEventListener("submit", (event) => {
  event.preventDefault();
  addWith(() => hub.addCustom($("add-name").value, $("add-url").value));
});

// ---------- Settings ----------

let settingsTab = "personalization";
let saveTimer = null;

// Change preferences: shown straight away, saved by the app (which checks every value).
function updatePrefs(patch, rerender = true) {
  state.prefs = { ...state.prefs, ...patch };
  applyTheme(state.prefs);
  renderSidebar();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => hub.setPrefs(state.prefs), 120);
  if (rerender) renderSettings();
}

function setting(title, help, control, { row = false, disabled = false } = {}) {
  const head = el("div", {}, el("div", { class: "setting__title", text: title }), help ? el("p", { class: "setting__help", text: help }) : null);
  return el(
    "div",
    { class: `setting${disabled ? " is-disabled" : ""}` },
    row ? el("div", { class: "setting__row" }, head, control) : head,
    row ? null : el("div", { class: "setting__control" }, control),
  );
}

function toggle(key, checked, onchange, label) {
  return el(
    "label",
    { class: "switch" },
    el("input", { type: "checkbox", role: "switch", "data-key": key, "aria-label": label, checked: checked || null, onchange: (e) => onchange(e.target.checked) }),
    el("span"),
  );
}

function segmented(key, options, value, onpick, label) {
  return el(
    "div",
    { class: "segmented", role: "group", "aria-label": label },
    ...options.map(([v, text]) =>
      el("button", { type: "button", "data-key": `${key}-${v}`, "aria-pressed": String(v === value), text, onclick: () => onpick(v) }),
    ),
  );
}

const THEMES = [
  ["dark", "Dark", ["#15171b", "#0e1013"]],
  ["black", "Black", ["#060607", "#000000"]],
  ["light", "Light", ["#e6e1d7", "#f5f2ec"]],
  ["foundry", "Foundry", ["#f8f9f9", "#e3e7e8"]],
  ["retro", "Retro (D1)", ["#0d1117", "#1a2230"]],
];

// Shown open when the player picks "Custom" in Foundry's colours (before they change anything).
let foundryCustomOpen = false;

function foundrySettings(p) {
  const presetId = Object.keys(FOUNDRY_COLOURS).find((id) => FOUNDRY_COLOURS[id].glow === p.foundryGlow && FOUNDRY_COLOURS[id].mark === p.foundryMark);
  const current = presetId && !foundryCustomOpen ? presetId : "custom";
  const chips = [
    ...Object.entries(FOUNDRY_COLOURS).map(([id, c]) => [id, c.name, c.glow, c.mark]),
    ["custom", "Custom", p.foundryGlow, p.foundryMark],
  ];
  const swatches = el(
    "div",
    { class: "swatches" },
    ...chips.map(([id, name, glow, mark]) =>
      el(
        "button",
        {
          class: "swatch",
          type: "button",
          "data-key": `foundry-${id}`,
          "aria-pressed": String(current === id),
          onclick: () => {
            foundryCustomOpen = id === "custom";
            if (id === "custom") renderSettings();
            else updatePrefs({ foundryGlow: glow, foundryMark: mark });
          },
        },
        el("span", { class: "foundry-chip", style: { "--chip-glow": glow, "--chip-mark": mark } }),
        el("span", { text: name }),
      ),
    ),
  );
  let editor = null;
  if (current === "custom") {
    const colorInput = (label, key) =>
      el("label", { class: "color-input" }, el("input", { type: "color", value: p[key], oninput: (e) => updatePrefs({ [key]: e.target.value }, false) }), el("span", { text: label }));
    editor = el(
      "div",
      { class: "gradient-editor" },
      el("div", { class: "gradient-editor__row" }, colorInput("Lights (highlights, what's active)", "foundryGlow"), colorInput("Markings (chevrons, stripes)", "foundryMark")),
    );
  }
  return [
    setting("Foundry mode", "White architecture, or the same foundry in graphite.", segmented("foundry-mode", [["light", "Light"], ["dark", "Dark"]], p.foundryMode, (v) => updatePrefs({ foundryMode: v }), "Foundry mode")),
    setting("Foundry colours", "The colour of the lights and of the markings.", el("div", {}, swatches, editor)),
  ];
}

function personalizationPanel() {
  const p = state.prefs;
  // The previews show the chosen colorway, which Foundry itself doesn't use.
  const way = colorwayOf({ ...p, theme: "dark" });
  const themes = el(
    "div",
    { class: "themes" },
    ...THEMES.map(([id, name, [side, main]]) =>
      el(
        "button",
        { class: "theme-card", type: "button", "data-key": `theme-${id}`, "aria-pressed": String(p.theme === id), onclick: () => updatePrefs({ theme: id }) },
        el(
          "span",
          { class: `theme-card__preview theme-card__preview--${id}` },
          el("i", { style: { background: side } }),
          el("i", { style: { background: `linear-gradient(160deg, ${main}, ${main} 55%, color-mix(in srgb, ${way.accent} 25%, ${main}))` } }),
        ),
        el("span", { text: name }),
      ),
    ),
  );

  const presets = Object.entries(COLORWAYS).map(([id, w]) => [id, w.name, `linear-gradient(${w.angle}deg, ${w.colors.join(", ")})`, w.accent]);
  const custom = colorwayOf({ ...p, theme: "dark", colorway: "custom" });
  presets.push(["custom", "Custom", gradientCss(custom), custom.accent]);
  const swatches = el(
    "div",
    { class: "swatches" },
    ...presets.map(([id, name, bg, dot]) =>
      el(
        "button",
        { class: "swatch", type: "button", "data-key": `colorway-${id}`, "aria-pressed": String(p.colorway === id), onclick: () => updatePrefs({ colorway: id }) },
        el("span", { class: "swatch__chip", style: { background: bg, "--dot": dot } }),
        el("span", { text: name }),
      ),
    ),
  );

  let editor = null;
  if (p.colorway === "custom") {
    const preview = el("div", { class: "gradient-editor__preview" });
    const paint = () => {
      const w = colorwayOf(state.prefs);
      preview.style.background = gradientCss(w);
      preview.style.setProperty("--dot", w.accent);
    };
    const colorInput = (label, value, onInput) =>
      el("label", { class: "color-input" }, el("input", { type: "color", value, oninput: (e) => onInput(e.target.value) }), el("span", { text: label }));
    const stops = p.customColors.map((c, i) =>
      colorInput(`Colour ${i + 1}`, c, (v) => {
        const colors = [...state.prefs.customColors];
        colors[i] = v;
        updatePrefs({ customColors: colors }, false);
        paint();
      }),
    );
    const stopButton =
      p.customColors.length < 3
        ? el("button", { class: "btn btn--small", type: "button", text: "Add a colour", onclick: () => updatePrefs({ customColors: [...p.customColors, "#1b2a4d"] }) })
        : el("button", { class: "btn btn--small", type: "button", text: "Remove colour 3", onclick: () => updatePrefs({ customColors: p.customColors.slice(0, 2) }) });
    const angle = el("input", {
      type: "range",
      min: "0",
      max: "360",
      step: "5",
      value: String(p.customAngle),
      "aria-label": "Gradient angle",
      oninput: (e) => {
        updatePrefs({ customAngle: Number(e.target.value) }, false);
        angleValue.textContent = `${e.target.value}°`;
        paint();
      },
    });
    const angleValue = el("span", { text: `${p.customAngle}°` });
    editor = el(
      "div",
      { class: "gradient-editor" },
      preview,
      el("div", { class: "gradient-editor__row" }, ...stops, stopButton),
      el("div", { class: "gradient-editor__row" }, el("label", { class: "range" }, el("span", { text: "Angle" }), angle, angleValue)),
      el(
        "div",
        { class: "gradient-editor__row" },
        colorInput("Accent (buttons, highlights)", p.customAccent, (v) => {
          updatePrefs({ customAccent: v }, false);
          paint();
        }),
      ),
    );
    paint();
  }

  const hidden = !p.showAddressBar;
  const corners = el(
    "div",
    { class: "corners", role: "group", "aria-label": "Corner" },
    ...[
      ["top-left", "Top left"],
      ["top-right", "Top right"],
      ["bottom-left", "Bottom left"],
      ["bottom-right", "Bottom right"],
    ].map(([id, label]) =>
      el("button", { class: "corner", type: "button", "data-corner": id, "data-key": `corner-${id}`, "aria-label": label, title: label, "aria-pressed": String(p.controlsCorner === id), onclick: () => updatePrefs({ controlsCorner: id }) }),
    ),
  );

  return [
    el("h2", { text: "Personalization" }),
    el("p", { text: "How Mida looks. Changes show straight away." }),
    setting("Theme", null, themes),
    ...(p.theme === "foundry"
      ? foundrySettings(p)
      : p.theme === "retro"
        ? [setting("Colorway", "Retro keeps Destiny 1's own colours. Pick another theme to use a colorway.", el("div", {}, swatches), { disabled: true })]
        : [setting("Colorway", "The background gradient and accent colour.", el("div", {}, swatches, editor))]),
    backdropSetting(),
    overlaysSetting(),
    setting("Open the sidebar on hover", "While the sidebar is collapsed, pointing at it opens it over the page, without resizing the page.", toggle("flyout", p.sidebarFlyout, (v) => updatePrefs({ sidebarFlyout: v }), "Open the sidebar on hover"), { row: true }),
    setting("Fit the sidebar to its contents", "The sidebar is only as tall as your modules and buttons, instead of running down the whole window.", toggle("fit", p.sidebarFit, (v) => updatePrefs({ sidebarFit: v }), "Fit the sidebar to its contents"), { row: true }),
    setting("Show the address bar", "The bar above the site with back, forward, reload and the page's address.", toggle("address", p.showAddressBar, (v) => updatePrefs({ showAddressBar: v }), "Show the address bar"), { row: true }),
    setting("Site controls corner", "With the address bar hidden, back, forward and reload float in this corner of the site.", corners, { disabled: !hidden }),
    setting("Only show site controls when hovered", "They stay invisible until your mouse is over their corner.", toggle("autohide", p.controlsAutohide, (v) => updatePrefs({ controlsAutohide: v }), "Only show site controls when hovered"), { row: true, disabled: !hidden }),
  ];
}

function accessibilityPanel() {
  const p = state.prefs;
  const zoomOptions = [];
  for (let z = 50; z <= 150; z += 10) zoomOptions.push(z);
  const zoom = el(
    "select",
    { class: "select", "data-key": "zoom", "aria-label": "Site zoom", onchange: (e) => updatePrefs({ siteZoom: Number(e.target.value) }) },
    ...zoomOptions.map((z) => el("option", { value: String(z), selected: z === p.siteZoom || null, text: `${z}%${z === 80 ? " (default)" : ""}` })),
  );
  return [
    el("h2", { text: "Accessibility" }),
    el("p", { text: "Make Mida easier to see and use." }),
    setting("Reduce motion", "Turns off animations such as the loading sweep and pop-up slides.", segmented("motion", [["system", "Follow Windows"], ["on", "On"], ["off", "Off"]], p.reduceMotion, (v) => updatePrefs({ reduceMotion: v }), "Reduce motion")),
    setting("Interface size", "Makes Mida's own sidebar, bars and pop-ups bigger or smaller (not the sites).", segmented("scale", [[90, "90%"], [100, "100%"], [110, "110%"], [125, "125%"], [150, "150%"]], p.uiScale, (v) => updatePrefs({ uiScale: v }), "Interface size")),
    setting("High contrast", "Stronger borders and text, and solid panels instead of see-through ones.", toggle("contrast", p.highContrast, (v) => updatePrefs({ highContrast: v }), "High contrast"), { row: true }),
    setting("Site zoom", `How big sites start. ${modKey()} + and ${modKey()} − still zoom one site on its own.`, zoom, { row: true }),
  ];
}

function aboutPanel() {
  const status = el("span", { class: "inline-status", role: "status" });
  const check = el("button", {
    class: "btn",
    type: "button",
    "data-key": "check",
    text: "Check for updates",
    onclick: async () => {
      check.disabled = true;
      status.textContent = "Checking…";
      const result = await hub.checkUpdate();
      check.disabled = false;
      status.textContent =
        {
          none: "You're up to date.",
          available: "An update is ready: see the banner at the bottom of the sidebar.",
          busy: "An update is already downloading.",
        }[result] ?? "Couldn't check right now. Try again later.";
    },
  });
  return [
    el("div", { class: "about-mark" }, el("img", { src: "icon.png", alt: "" }), el("div", {}, el("strong", { text: "Mida" }), el("div", { class: "setting__help", text: `Version ${state.version}` }))),
    setting("Updates", "Mida checks by itself when it starts and every few hours, and always asks before updating.", el("div", {}, check, status)),
    setting(
      "More",
      null,
      el(
        "div",
        { class: "picture__buttons" },
        el("button", { class: "btn btn--small", type: "button", text: "What's new", onclick: () => hub.openLink("releases") }),
        el("button", { class: "btn btn--small", type: "button", text: "Project page", onclick: () => hub.openLink("project") }),
      ),
    ),
    el("p", { class: "dialog__fine", text: "Mida shows each site with Windows' own browser engine (WebView2). Not affiliated with Bungie or any of the sites it shows." }),
  ];
}

// Settings → Tabs: which built-in tabs this profile shows.
function tabsPanel() {
  const all = state.tabCatalogue.filter((t) => t.game === state.profile?.game);
  const intro = [el("h2", { text: "Tabs" }), el("p", { text: "Mida's own pages, in the sidebar above your modules. Switch any of them off for this profile." })];
  if (all.length === 0) return [...intro, el("p", { class: "note", text: "Built-in tabs are available on Destiny 2 profiles." })];
  const set = (id, on) => {
    const next = all.map((t) => t.id).filter((t) => (t === id ? on : state.tabs.includes(t)));
    state.tabs = next;
    hub.setTabs(next);
  };
  const a = state.account ?? {};
  const account = setting(
    "Bungie account",
    a.signedIn
      ? `Signed in as ${a.name}. Inventory, Quests and Seasonal hub read this account. The sign-in is kept on this computer only, encrypted by Windows.`
      : a.available
        ? "Sign in for Inventory, Quests and Seasonal hub. Signing in happens in your browser, on bungie.net."
        : "This copy of Mida was built without a Bungie key, so it can't sign in.",
    a.signedIn
      ? el("button", { class: "btn btn--small", type: "button", text: "Sign out", onclick: () => hub.signOut() })
      : el("button", { class: "btn btn--small btn--primary", type: "button", disabled: !a.available || a.busy || null, text: a.busy ? "Waiting…" : "Sign in", onclick: () => hub.signIn() }),
    { row: true },
  );
  return [
    ...intro,
    account,
    ...all.map((t) =>
      setting(t.name, `${t.blurb}${t.signIn ? " Needs a Bungie sign-in." : ""}`, toggle(`tab-${t.id}`, state.tabs.includes(t.id), (v) => set(t.id, v), `Show ${t.name}`), { row: true }),
    ),
  ];
}

function renderSettings() {
  const focusedKey = document.activeElement?.dataset?.key;
  for (const tab of document.querySelectorAll(".settings__tab")) tab.setAttribute("aria-selected", String(tab.dataset.tab === settingsTab));
  for (const panel of document.querySelectorAll(".settings__panel")) {
    const show = panel.dataset.panel === settingsTab;
    panel.hidden = !show;
    if (!show) continue;
    const build = { personalization: personalizationPanel, accessibility: accessibilityPanel, tabs: tabsPanel, about: aboutPanel }[settingsTab];
    panel.replaceChildren(...build());
  }
  if (focusedKey) document.querySelector(`[data-key="${CSS.escape(focusedKey)}"]`)?.focus();
}

function openSettings(tab) {
  if (tab) settingsTab = tab;
  renderSettings();
  openDialog($("settings"));
}

document.querySelectorAll(".settings__tab").forEach((tab) =>
  tab.addEventListener("click", () => {
    settingsTab = tab.dataset.tab;
    renderSettings();
  }),
);
$("settings-tablist").addEventListener("keydown", (event) => {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  event.preventDefault();
  const tabs = [...document.querySelectorAll(".settings__tab")];
  const i = tabs.findIndex((t) => t.dataset.tab === settingsTab);
  const next = tabs[(i + (event.key === "ArrowDown" ? 1 : -1) + tabs.length) % tabs.length];
  settingsTab = next.dataset.tab;
  renderSettings();
  next.focus();
});
$("settings-open").addEventListener("click", () => openSettings());
$("settings-close").addEventListener("click", () => $("settings").close());

// ---------- Updates ----------

let announcedUpdate = null; // version the pop-up has already been shown for (this session)

const UPDATE_TEXT = {
  available: (u) => ["Update available", `Mida ${u.version} · Click to update`],
  downloading: (u) => ["Downloading update", `${u.percent}% · Restarts when done`],
  ready: () => ["Restarting to update", "Just a moment"],
  error: () => ["Download failed", "Click to try again"],
};

function renderUpdate() {
  const update = state.update;
  const banner = $("update-banner");
  banner.hidden = !update;
  if (!update) return;
  const [title, detail] = UPDATE_TEXT[update.status](update);
  banner.dataset.status = update.status;
  banner.disabled = update.status === "downloading" || update.status === "ready";
  banner.title = `${title}. ${detail}`;
  $("update-title").textContent = title;
  $("update-detail").textContent = detail;
  $("update-bar").style.width = `${update.percent ?? 0}%`;
  if (update.status === "available" && announcedUpdate !== update.version) maybeAnnounce();
}

// Show the pop-up once per new version, but never on top of another window.
function maybeAnnounce() {
  if (!state?.update || state.update.status !== "available" || anythingOpen() || !state.firstRunDone) return;
  announcedUpdate = state.update.version;
  $("update-dialog-text").textContent = `Mida ${state.update.version} is available. You're using ${state.version}.`;
  openDialog($("update-dialog"));
}

$("update-banner").addEventListener("click", () => hub.downloadUpdate());
$("update-later").addEventListener("click", () => $("update-dialog").close());
$("update-now").addEventListener("click", () => {
  hub.downloadUpdate();
  $("update-dialog").close();
});

// ---------- Toolbar and sidebar buttons ----------

$("toggle").addEventListener("click", () => hub.toggleSidebar());
$("home-item").addEventListener("click", () => hub.select(HOME));
for (const action of ["back", "forward", "reload", "home", "external"]) {
  $(action).addEventListener("click", () => hub.nav(action));
}

// ---------- Start ----------

hub.onState((next) => {
  state = next;
  render();
});
hub.onStatus((id, status) => {
  if (!state) return;
  const hadError = Boolean(state.statuses[id]?.error);
  state.statuses[id] = status;
  // Only the loading dot changes here; redrawing the sidebar would move keyboard focus.
  const icon = document.querySelector(`.mod-row[data-id="${CSS.escape(id)}"] .mod__icon`);
  if (icon) {
    if (status.loading) icon.dataset.loading = "true";
    else delete icon.dataset.loading;
  }
  if (shownIds().includes(id) || hadError !== Boolean(status.error)) renderActive();
});
hub.onCommand((command) => {
  if (command === "settings" && state?.firstRunDone && !$("settings").open) openSettings();
});
hub.getState().then((initial) => {
  state = initial;
  render();
  reportStage();
});
