// The shell page: draws the sidebar, toolbar and dialogs from the state the app sends,
// and passes clicks back through window.hub (src/preload.js). Text from sites (titles,
// addresses) is only ever set as plain text, never as HTML.
"use strict";

// `hub` is provided by src/preload.js (window.hub).
const $ = (id) => document.getElementById(id);

let state = null;
const mac = () => state?.platform === "darwin";

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children) if (child) node.append(child);
  return node;
}

const hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

function moduleIcon(mod, loading) {
  const icon = el("span", { class: "mod__icon", "data-loading": loading ? "true" : null, "aria-hidden": "true" });
  if (mod.icon) icon.append(el("img", { src: mod.icon, alt: "" }));
  else icon.textContent = (mod.name.match(/[a-z0-9]/i)?.[0] ?? "?").toUpperCase();
  return icon;
}

// ---------- Sidebar ----------

function renderSidebar() {
  const app = $("app");
  app.dataset.expanded = String(state.sidebarExpanded);
  const toggle = $("toggle");
  const label = state.sidebarExpanded ? "Collapse sidebar" : "Expand sidebar";
  toggle.setAttribute("aria-label", label);
  toggle.setAttribute("aria-expanded", String(state.sidebarExpanded));
  toggle.title = `${label} (${mac() ? "Cmd" : "Ctrl"}+B)`;

  const list = $("modules");
  list.replaceChildren(
    ...state.modules.map((mod, index) => {
      const status = state.statuses[mod.id];
      const shortcut = index < 9 ? ` (${mac() ? "Cmd" : "Ctrl"}+${index + 1})` : "";
      return el(
        "div",
        { class: "mod-row", "data-id": mod.id },
        el(
          "button",
          {
            class: "mod",
            type: "button",
            title: `${mod.name}${shortcut}`,
            "aria-current": mod.id === state.activeId ? "page" : null,
            onclick: () => hub.select(mod.id),
            oncontextmenu: (event) => {
              event.preventDefault();
              hub.moduleMenu(mod.id);
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
          onclick: () => hub.moduleMenu(mod.id),
        }),
      );
    }),
  );
}

// ---------- Toolbar and stage ----------

const FRIENDLY_ERRORS = {
  "-106": "You seem to be offline. Check your internet connection.",
  "-105": "Couldn't find this site. Check the address, or try again in a moment.",
  "-102": "The site refused the connection. It may be down.",
  "-118": "The site took too long to answer.",
  "-7": "The site took too long to answer.",
  "-200": "The site's security certificate isn't valid, so it was blocked.",
  "-111": "Couldn't connect through your network's proxy.",
  "-130": "Couldn't connect through your network's proxy.",
  "-109": "Couldn't reach the site. It may be down.",
  crashed: "The page stopped working.",
};

function renderActive() {
  const mod = state.modules.find((m) => m.id === state.activeId);
  const status = mod ? state.statuses[mod.id] : null;
  const has = Boolean(mod);

  $("back").disabled = !status?.canGoBack;
  $("forward").disabled = !status?.canGoForward;
  $("reload").disabled = !has;
  $("home").disabled = !has;
  $("external").disabled = !has;
  $("title").textContent = mod ? status?.title || mod.name : "";
  $("url").textContent = mod ? status?.url || mod.url : "";
  $("progress").dataset.on = String(Boolean(status?.loading));
  document.title = mod ? `${mod.name} · Mida` : "Mida";

  const msg = $("stage-msg");
  if (!state.firstRunDone) {
    msg.hidden = true;
  } else if (!mod) {
    msg.hidden = false;
    msg.replaceChildren(
      el("h2", { text: "No modules yet" }),
      el("p", { text: "Add a companion site to get started." }),
      el("div", { class: "stage__actions" }, el("button", { class: "btn btn--primary", type: "button", text: "Add a module", onclick: openAdd })),
    );
  } else if (status?.error) {
    const why = FRIENDLY_ERRORS[String(status.error.code)] ?? `The site didn't load (${status.error.description || "unknown error"}).`;
    msg.hidden = false;
    msg.replaceChildren(
      el("h2", { text: `Couldn't load ${mod.name}` }),
      el("p", { text: why }),
      el(
        "div",
        { class: "stage__actions" },
        el("button", { class: "btn btn--primary", type: "button", text: "Try again", onclick: () => hub.nav("retry") }),
        el("button", { class: "btn", type: "button", text: "Open in your browser", onclick: () => hub.nav("external") }),
      ),
    );
  } else {
    msg.hidden = true;
  }
}

function renderUpdate() {
  const button = $("update");
  button.hidden = !state.updateReady;
  if (state.updateReady) {
    $("update-text").textContent = `Restart to update to ${state.updateReady.version}`;
    button.title = "The new version has downloaded. Restart Mida to start using it (or it installs next time you close Mida).";
  }
  $("version").textContent = `Mida ${state.version}. Updates download by themselves.`;
}

function render() {
  renderSidebar();
  renderActive();
  renderUpdate();
  if (!state.firstRunDone && !$("welcome").open) openWelcome();
  if ($("add").open) renderAddList();
}

// The app places module pages over the stage, so it needs the stage's exact position.
function reportStage() {
  const r = $("stage").getBoundingClientRect();
  hub.setStageRect({ x: r.left, y: r.top, width: r.width, height: r.height });
}
new ResizeObserver(reportStage).observe($("stage"));
window.addEventListener("resize", reportStage);

// ---------- Dialogs ----------

// Module pages sit above the shell, so they're hidden while one of our dialogs is open.
function showDialog(dialog) {
  hub.setOverlay(true);
  dialog.showModal();
}
for (const dialog of document.querySelectorAll("dialog")) {
  dialog.addEventListener("close", () => {
    if (!document.querySelector("dialog[open]")) hub.setOverlay(false);
  });
}

function openWelcome() {
  const groups = [
    ["Starter modules", state.catalogue.filter((c) => c.starter)],
    ["More sites", state.catalogue.filter((c) => !c.starter)],
  ];
  $("welcome-list").replaceChildren(
    ...groups.flatMap(([title, items]) => [
      el("h2", { class: "band", text: title }),
      el(
        "div",
        { class: "picks" },
        ...items.map((c) =>
          el(
            "label",
            { class: "pick" },
            el("input", { type: "checkbox", value: c.id, checked: c.starter ? true : null }),
            el("span", { class: "pick__name", text: c.name }),
            el("span", { class: "pick__blurb", text: c.blurb }),
            el("span", { class: "pick__host", text: hostOf(c.url) }),
          ),
        ),
      ),
    ]),
  );
  $("welcome-error").textContent = "";
  showDialog($("welcome"));
}

// The welcome picker can't be skipped with Esc: the app needs at least one module.
$("welcome").addEventListener("cancel", (event) => event.preventDefault());

$("welcome-start").addEventListener("click", async () => {
  const ids = [...$("welcome-list").querySelectorAll("input:checked")].map((input) => input.value);
  const button = $("welcome-start");
  button.disabled = true;
  const result = await hub.finishFirstRun(ids);
  button.disabled = false;
  if (result?.ok) $("welcome").close();
  else $("welcome-error").textContent = result?.error ?? "Something went wrong.";
});

function renderAddList() {
  const added = new Set(state.modules.map((m) => m.id));
  const left = state.catalogue.filter((c) => !added.has(c.id));
  $("add-list").replaceChildren(
    ...(left.length
      ? left.map((c) =>
          el(
            "div",
            { class: "cat-row" },
            el(
              "div",
              { class: "cat-row__text" },
              el("span", { class: "cat-row__name", text: c.name }),
              el("span", { class: "cat-row__blurb", text: c.blurb }),
            ),
            el("button", {
              class: "btn btn--small",
              type: "button",
              text: "Add",
              "aria-label": `Add ${c.name}`,
              onclick: () => addWith(() => hub.addFromCatalogue(c.id)),
            }),
          ),
        )
      : [el("p", { class: "cat-empty", text: "Everything in the list is already in your sidebar." })]),
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
  showDialog($("add"));
}

$("add-open").addEventListener("click", openAdd);
$("add-close").addEventListener("click", () => $("add").close());
$("add-form").addEventListener("submit", (event) => {
  event.preventDefault();
  addWith(() => hub.addCustom($("add-name").value, $("add-url").value));
});

// ---------- Toolbar buttons ----------

$("toggle").addEventListener("click", () => hub.toggleSidebar());
$("update").addEventListener("click", () => hub.installUpdate());
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
  state.statuses[id] = status;
  // Only the loading dot changes here; redrawing the sidebar would move keyboard focus.
  const icon = document.querySelector(`.mod-row[data-id="${CSS.escape(id)}"] .mod__icon`);
  if (icon) {
    if (status.loading) icon.dataset.loading = "true";
    else delete icon.dataset.loading;
  }
  if (id === state.activeId) renderActive();
});
hub.getState().then((initial) => {
  state = initial;
  render();
  reportStage();
});
