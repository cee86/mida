// MIDA's built-in Destiny 2 tabs, drawn by the app itself (not websites). Loaded as a module
// after shell.js, which calls window.midaTabs.mount(id, container, ctx) when a tab is shown and
// update(...) when the app's state changes. ctx gives the shell's helpers (el, svg) and state.
//
// The schedules and loot tables in ./d2/ are unchanged copies of seals.report's lib/rotations.js,
// lib/rotators.js and lib/loot-tables.js, so both show the same weeks; copy them again when those
// change. Everything here is worked out on this computer: nothing is fetched.

import { wallpaper } from "./wallpaper.js";
import { featuredRotation, RAID_NAMES, DUNGEON_NAMES } from "./d2/rotations.js";
import { LOOT_TABLES, WEAPON_KINDS } from "./d2/loot-tables.js";
import { inventory as inventoryScreen, loadoutDock } from "./inventory.js";
import { plannerTab } from "./planner.js";
import { guardianTab } from "./guardian.js";
import { directorTab } from "./director.js";
import { remind, postmasterCheck, REMINDERS, reminderChoices, setReminder } from "./reminders.js";
import { rotatorsTab } from "./rotators.js";

const CLOCK = ["M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z", "M12 7v5l3 2"];
const PIN = ["M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z", "M12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z"];

// "3d 4h", "4h 12m" or "12:34" (under an hour).
function timeLeft(ms) {
  const minutes = Math.floor(ms / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days >= 1) return `${days}d ${hours % 24}h`;
  if (hours >= 1) return `${hours}h ${minutes % 60}m`;
  return `${minutes}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
}


// A countdown that ticks by itself (see the timer at the bottom).
function until(ctx, iso, suffix = " left") {
  const node = ctx.el("span", { class: "until", "data-until": String(new Date(iso).getTime()), "data-suffix": suffix });
  node.textContent = `${timeLeft(new Date(iso).getTime() - Date.now())}${suffix}`;
  return node;
}

function card(ctx, { kicker, name, detail, place, meta, muted, note }) {
  const { el, svg } = ctx;
  return el(
    "div",
    { class: `card${muted ? " card--muted" : ""}` },
    kicker ? el("div", { class: "card__kicker", text: kicker }) : null,
    el("div", { class: "card__name", text: name }),
    detail ? el("div", { class: "card__detail", text: detail }) : null,
    place ? el("div", { class: "card__meta" }, svg(PIN), el("span", { text: place })) : null,
    meta ? el("div", { class: "card__meta" }, svg(CLOCK), meta) : null,
    note ? el("div", { class: "card__note", text: note }) : null,
  );
}

const band = (ctx, text) => ctx.el("h2", { class: "band", text });

function head(ctx, title, lede) {
  const { el } = ctx;
  return el("header", { class: "tab__head" }, el("h1", { class: "tab__title", text: title }), lede ? el("p", { class: "tab__lede" }, ...[].concat(lede)) : null);
}

// ---------- Rotators (was Featured; rotators.js) ----------

function featured(ctx) {
  return rotatorsTab(ctx, { until, remote: () => remoteRotators });
}

// ---------- RAD Assistant ----------

const RAD_KEY = "mida-rad-activity";
const radChoice = () => {
  try {
    return localStorage.getItem(RAD_KEY);
  } catch {
    return null;
  }
};
const saveRadChoice = (name) => {
  try {
    localStorage.setItem(RAD_KEY, name);
  } catch {
    // Only a convenience.
  }
};

function encounterCard(ctx, encounter, index, shared) {
  const { el } = ctx;
  return el(
    "div",
    { class: "encounter" },
    el("div", { class: "encounter__number", text: shared ? "·" : String(index + 1) }),
    el(
      "div",
      { class: "encounter__body" },
      el("div", { class: "encounter__name", text: shared ? "Shared loot pool" : encounter.name }),
      encounter.note ? el("div", { class: "card__detail", text: encounter.note }) : null,
      el(
        "div",
        { class: "chips" },
        ...(encounter.weapons ?? []).map((w) => el("span", { class: "chip", title: WEAPON_KINDS[w] ?? "", text: w })),
      ),
      encounter.armor ? el("div", { class: "card__meta" }, el("span", { text: `Armor: ${encounter.armor}` })) : null,
      el(
        "div",
        { class: "encounter__extras" },
        el("span", { class: "placeholder", text: "Tips: none yet" }),
        el("span", { class: "placeholder", text: "Map: none yet" }),
      ),
    ),
  );
}

function radDetail(ctx, name) {
  const { el } = ctx;
  const table = LOOT_TABLES[name];
  const kind = RAID_NAMES.includes(name) ? "Raid" : DUNGEON_NAMES.includes(name) ? "Dungeon" : "Activity";
  const thisWeek = featuredRotation().activities.find((a) => a.name === name);
  const encounters = (list) => {
    const shared = Boolean(table?.shared);
    return el("div", { class: "encounters" }, ...list.map((e, i) => encounterCard(ctx, e, i, shared)));
  };
  return el(
    "div",
    { class: "rad__detail" },
    el(
      "header",
      { class: "tab__head" },
      el("div", { class: "card__kicker", text: kind }),
      el("h1", { class: "tab__title", text: name }),
      thisWeek ? el("p", { class: "tab__lede" }, el("span", { class: "badge", text: thisWeek.always ? "Always featured" : "Featured this week" })) : null,
    ),
    el(
      "div",
      { class: "note" },
      "Asset packs, guides and maps for this activity will appear here, to view or download. Encounter tips and callouts will sit with each encounter below.",
    ),
    band(ctx, "Encounters and loot"),
    table ? encounters(table.encounters) : el("p", { class: "tab__note", text: "No loot table for this one yet." }),
    ...Object.entries(table?.modes ?? {}).flatMap(([mode, list]) => [band(ctx, `${mode} mode`), encounters(list)]),
    table?.exotic
      ? el(
          "div",
          { class: "cards" },
          card(ctx, { kicker: "Exotic", name: table.exotic.name, detail: `From ${table.exotic.from}`, note: table.exotic.note }),
        )
      : null,
  );
}

function rad(ctx) {
  const { el } = ctx;
  const extra = Object.keys(LOOT_TABLES).filter((n) => !RAID_NAMES.includes(n) && !DUNGEON_NAMES.includes(n));
  const groups = [
    ["Raids", RAID_NAMES],
    ["Dungeons", DUNGEON_NAMES],
    ["Other", extra],
  ].filter(([, names]) => names.length);
  let chosen = radChoice();
  if (!groups.some(([, names]) => names.includes(chosen))) chosen = RAID_NAMES[0];

  const detail = el("div", { class: "rad__pane" }, radDetail(ctx, chosen));
  const list = el(
    "nav",
    { class: "rad__list", "aria-label": "Raids and dungeons" },
    ...groups.flatMap(([title, names]) => [
      el("div", { class: "rad__group", text: title }),
      ...names.map((name) =>
        el("button", {
          class: "rad__item",
          type: "button",
          "aria-current": name === chosen ? "true" : "false",
          text: name,
          onclick: (event) => {
            saveRadChoice(name);
            list.querySelectorAll(".rad__item").forEach((b) => b.setAttribute("aria-current", "false"));
            event.currentTarget.setAttribute("aria-current", "true");
            detail.replaceChildren(radDetail(ctx, name));
            detail.scrollTop = 0;
          },
        }),
      ),
    ]),
  );
  return el("div", { class: "tab tab--rad" }, el("div", { class: "rad" }, list, detail));
}

// ---------- Bungie sign-in ----------

const SIGN_IN = {
  "tab-inventory": "Your characters' gear and your vault, with quick moves between them. For deeper work (loadouts, sorting, tags), DIM can sit beside it as a module.",
  "tab-planner": "Each character's week in one place: the weekly milestones still to do, bounties ready to turn in, and your own to-do list that resets every Tuesday.",
  "tab-guardian": "Your three characters, Guardian Rank and commendations, recent seals, triumphs and collections, and your latest games, like the Companion app's Guardian screen.",
  "tab-director": "The season and your reward pass, this week's Vanguard alerts and Ops with their bonus drops, plus the Seasonal Hub, vendors, quests, friends and your clan.",
};
const SHIELD = ["M12 3l8 4v5c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V7z", "M9 12l2 2 4-4"];

function signIn(ctx, id) {
  const { el, svg, state, hub } = ctx;
  const tab = state.tabCatalogue.find((t) => t.id === id);
  const account = state.account ?? {};
  const note = !account.available
    ? "This copy of MIDA was built without a Bungie key, so it can't sign in."
    : account.busy
      ? "Finish signing in in your browser, then come back here. (Closed the tab? Wait a moment and try again.)"
      : "Sign in with Bungie in your browser. MIDA keeps the sign-in on this computer only, encrypted by Windows, and can sign out any time from Settings.";
  return el(
    "div",
    { class: "tab tab--signin" },
    el(
      "div",
      { class: "signin" },
      el("div", { class: "signin__icon" }, svg(SHIELD)),
      el("h1", { class: "tab__title", text: tab?.name ?? "" }),
      el("p", { class: "tab__lede", text: SIGN_IN[id] ?? tab?.blurb ?? "" }),
      el("p", { class: "tab__note", text: note }),
      account.error ? el("p", { class: "tab__error", text: account.error }) : null,
      el("button", {
        class: "btn btn--primary",
        type: "button",
        disabled: !account.available || account.busy || null,
        text: account.busy ? "Waiting for Bungie…" : "Sign in with Bungie",
        onclick: () => hub.signIn(),
      }),
    ),
  );
}

// Data read from Bungie, shared by the tabs and kept for five minutes (moves clear the inventory's copy).
const cache = { inventory: null, activity: null };
async function read(ctx, which, fresh) {
  const entry = cache[which];
  // A read still on its way is shared too (Quests and the Seasonal Hub both want "activity").
  if (!fresh && entry && Date.now() - entry.at < 5 * 60_000) return entry.promise;
  const promise = which === "inventory" ? ctx.hub.d2Inventory() : ctx.hub.d2Activity();
  cache[which] = { at: Date.now(), promise };
  const result = await promise;
  if (which === "inventory" && result?.ok && cache[which]?.promise === promise) postmasterCheck(ctx, result.data);
  // Failures aren't kept: the next try asks again.
  if (!result?.ok && cache[which]?.promise === promise) cache[which] = null;
  return result;
}

// The app's progress messages (lib.rs `progress`), passed on to every bar on screen.
window.hub?.onProgress?.((p) => window.dispatchEvent(new CustomEvent("mida-progress", { detail: p })));

// A loading bar with a line under it saying what's happening. It follows the app's progress messages for `task`
// ("inventory", "activity", "seasonal", "vendors", "planner", "clan", "armor", "records", "guardian", "director", "portal", "friends") and the game data download every tab shares ("manifest"), and in
// between creeps forward on its own (never past 95%) so a slow answer still shows movement. It stops itself once
// it's off the screen.
function progressBar(ctx, task, text) {
  const { el } = ctx;
  const fill = el("span", { class: "load-bar__fill" });
  const bar = el("div", { class: "load-bar", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": "0", "aria-label": text }, fill);
  const step = el("p", { class: "load-step", text: text ?? "" });
  const node = el("div", { class: "load" }, bar, step);
  const born = performance.now();
  let target = 0.04;
  let since = born;
  let shown = 0;
  let download = null; // the game data download, while it runs
  let seen = false;
  const onProgress = (event) => {
    const p = event.detail ?? {};
    if (p.task === "manifest") {
      download = p.fraction < 1 ? p : null;
      if (download) step.textContent = p.label;
    } else if (task && p.task === task && p.fraction > target) {
      target = p.fraction;
      since = performance.now();
      if (!download) step.textContent = p.label;
    }
  };
  const tick = () => {
    if (node.isConnected) seen = true;
    else if (seen || performance.now() - born > 3000) return stop();
    // The download fills its own part of the bar (15% to 60%): it's the slow part the first time after an update.
    const goal = download ? 0.15 + 0.45 * download.fraction : target;
    const creep = Math.min(0.95, goal + (1 - goal) * 0.3 * (1 - Math.exp(-(performance.now() - since) / 5000)));
    shown += (Math.max(shown, creep) - shown) * 0.25;
    fill.style.width = `${(shown * 100).toFixed(1)}%`;
    bar.setAttribute("aria-valuenow", String(Math.round(shown * 100)));
  };
  const timer = setInterval(tick, 100);
  function stop() {
    clearInterval(timer);
    window.removeEventListener("mida-progress", onProgress);
  }
  window.addEventListener("mida-progress", onProgress);
  tick();
  return node;
}

function loadingView(ctx, text, task = null) {
  const { el } = ctx;
  return el("div", { class: "tab tab--signin" }, el("div", { class: "signin" }, el("p", { class: "tab__lede", text }), progressBar(ctx, task, "Starting…")));
}

function problemView(ctx, error, retry) {
  const { el } = ctx;
  return el(
    "div",
    { class: "tab tab--signin" },
    el(
      "div",
      { class: "signin" },
      el("h1", { class: "tab__title", text: "Couldn't load that" }),
      el("p", { class: "tab__error", text: error }),
      el("button", { class: "btn btn--primary", type: "button", text: "Try again", onclick: retry }),
    ),
  );
}

// A row of character buttons (most recently played first).
function characterPicker(ctx, characters, chosen, pick) {
  const { el } = ctx;
  return el(
    "div",
    { class: "segmented", role: "group", "aria-label": "Character" },
    ...characters.map((c) =>
      el("button", { type: "button", "aria-pressed": String(c.id === chosen), text: `${c.className} · ${c.light ?? ""}`, onclick: () => pick(c.id) }),
    ),
  );
}

function progress(ctx, value, goal) {
  const pct = goal > 0 ? Math.min(100, Math.round((value / goal) * 100)) : 0;
  const bar = ctx.el("span", { class: "meter__fill" });
  bar.style.width = `${pct}%`;
  return ctx.el("span", { class: "meter", role: "progressbar", "aria-valuenow": String(pct), "aria-valuemin": "0", "aria-valuemax": "100" }, bar);
}

function objectiveList(ctx, objectives) {
  const { el } = ctx;
  return el(
    "div",
    { class: "objectives" },
    ...objectives.map((o) =>
      el(
        "div",
        { class: `objective${o.complete ? " is-done" : ""}` },
        el("div", { class: "objective__row" }, el("span", { text: o.text || "Progress" }), el("span", { class: "objective__count", text: o.goal > 1 ? `${o.progress} / ${o.goal}` : o.complete ? "Done" : "" })),
        o.goal > 1 ? progress(ctx, o.progress, o.goal) : null,
      ),
    ),
  );
}

function questCard(ctx, q) {
  const { el } = ctx;
  return el(
    "div",
    { class: `card quest${q.complete ? " quest--done" : ""}` },
    el(
      "div",
      { class: "quest__head" },
      q.icon ? el("img", { class: "quest__icon", src: q.icon, alt: "", loading: "lazy" }) : null,
      el("div", { class: "quest__text" }, el("div", { class: "card__kicker", text: q.typeName || "Quest" }), el("div", { class: "card__name", text: q.name })),
    ),
    q.description ? el("div", { class: "card__detail quest__description", text: q.description }) : null,
    q.objectives.length ? objectiveList(ctx, q.objectives) : null,
    q.expires ? el("div", { class: "card__meta" }, ctx.svg(CLOCK), until(ctx, q.expires, " left")) : null,
    q.complete ? el("div", { class: "card__note", text: "Complete: turn it in in game." }) : null,
  );
}

const lastCharacter = {};


// Each character's week (planner.js).
function planner(ctx, container) {
  plannerTab(ctx, container, { read, loadingView, problemView, until, remote: () => remoteRotators });
}

// Everything a tab inside Guardian or Director may open needs (the Seasonal Hub, Quests, Vendors, Clan, Armor...).
const shared = (tab) => ({ read, loadingView, problemView, progressBar, until, characterPicker, questCard, lastCharacter, wallpaper: tab });

// Characters, journey, collections and recent games, with Triumphs and the collection pages inside (guardian.js).
function guardian(ctx, container) {
  guardianTab(ctx, container, shared("tab-guardian"));
}

// The season, Vanguard alerts and Ops, with the Seasonal Hub, Vendors, Quests, friends and clan inside (director.js).
function director(ctx, container) {
  directorTab(ctx, container, shared("tab-director"));
}





// ---------- Inventory (inventory.js) ----------

function inventoryTab(ctx, container) {
  inventoryScreen(ctx, container, { read, invalidate: () => (cache.inventory = null), loadingView, problemView });
}

// ---------- Mounting ----------

const BUILDERS = {
  "tab-featured": featured,
  "tab-rad": rad,
};
const SIGNED_IN = { "tab-guardian": guardian, "tab-director": director, "tab-planner": planner, "tab-inventory": inventoryTab };

// What a sign-in tab depends on: remount when the account changes.
const accountKey = (ctx) => {
  const a = ctx.state.account ?? {};
  return `${a.signedIn}|${a.busy}|${a.error ?? ""}|${a.name ?? ""}`;
};

// seals.report's answer for the Rotators tab: this week as the site works it out, its saved schedules and card art.
let remoteRotators = null; // { saved, art, week } from d2_rotators
const hosts = new Map(); // signed-in tab id -> { key, at, node, scrolls }: built tabs kept while another is open
let rotatorsAskedAt = 0;

window.midaTabs = {
  mount(id, container, ctx) {
    container.dataset.tab = id;
    container.midaCtx = ctx;
    container.dataset.account = accountKey(ctx);
    if (SIGNED_IN[id]) {
      if (!ctx.state.account?.signedIn) return container.replaceChildren(signIn(ctx, id));
      // Signed-in tabs stay built while another tab is open, so coming back is instant (scroll positions too).
      // Each draws into its own host element, so a read that finishes after you've left lands in the right place.
      // Rebuilt after half an hour or when the account changes; Refresh in each tab reads again any time.
      const key = accountKey(ctx);
      const kept = hosts.get(id);
      if (kept && kept.key === key && Date.now() - kept.at < 30 * 60e3) {
        container.replaceChildren(kept.node);
        for (const [node, top] of kept.scrolls) if (kept.node.contains(node)) node.scrollTop = top;
        kept.node.midaShown?.();
        return;
      }
      const host = { key, at: Date.now(), node: ctx.el("div", { class: "tab-host" }), scrolls: new Map() };
      // Scroll events don't bubble, but a capturing listener here still hears every scroller inside.
      host.node.addEventListener("scroll", (event) => event.target instanceof Element && host.scrolls.set(event.target, event.target.scrollTop), true);
      hosts.set(id, host);
      container.replaceChildren(host.node);
      SIGNED_IN[id](ctx, host.node);
      return;
    }
    const page = (BUILDERS[id] ?? ((c) => signIn(c, id)))(ctx);
    // The RAD Assistant's wallpaper sits behind it only when the player picked one (wallpaper.js).
    container.replaceChildren(id === "tab-rad" ? ctx.el("div", { class: "tab-wall" }, wallpaper(ctx, id, { quiet: true }), page) : page);
    // Asked again when the tab opens and the last answer is over 10 minutes old (seals.report caches it as long).
    if (id === "tab-featured" && Date.now() - rotatorsAskedAt > 10 * 60e3) {
      rotatorsAskedAt = Date.now();
      ctx.hub.d2Rotators().then((reply) => {
        if (!reply || typeof reply !== "object" || !(reply.week || Object.keys(reply.saved ?? {}).length || Object.keys(reply.art ?? {}).length)) return;
        remoteRotators = reply;
        if (container.dataset.tab === id) this.mount(id, container, ctx);
      });
    }
  },
  // The loadout dock beside the pages (shell.js shows and hides it).
  dock(container, ctx) {
    container.dataset.account = accountKey(ctx);
    if (!ctx.state.account?.signedIn) return container.replaceChildren();
    loadoutDock(ctx, container, { read, invalidate: () => (cache.inventory = null), loadingView, problemView });
  },
  dockUpdate(container, ctx) {
    if (container.dataset.account !== accountKey(ctx)) {
      cache.inventory = null;
      this.dock(container, ctx);
    }
  },
  // Reminders (reminders.js), called by shell.js once a minute on Destiny 2 profiles. Events come from seals.report's
  // weekly answer, asked for here too (at most every 30 minutes) when the Rotators tab hasn't been opened.
  remind(ctx) {
    if (Date.now() - rotatorsAskedAt > 30 * 60e3) {
      rotatorsAskedAt = Date.now();
      ctx.hub.d2Rotators().then((reply) => {
        if (reply?.week || Object.keys(reply?.saved ?? {}).length) remoteRotators = reply;
        remind(ctx, remoteRotators);
      });
    }
    remind(ctx, remoteRotators);
  },
  reminders: { list: REMINDERS, choices: reminderChoices, set: setReminder },
  update(id, container, ctx) {
    if (SIGNED_IN[id] && container.dataset.account !== accountKey(ctx)) {
      cache.inventory = cache.activity = null;
      hosts.clear();
      this.mount(id, container, ctx);
    }
  },
};

// Countdowns tick every second; when one runs out (a reset, the next Distortion), its tab is
// built again so everything moves on.
setInterval(() => {
  const now = Date.now();
  const rebuild = new Set();
  for (const node of document.querySelectorAll("[data-until]")) {
    const ms = Number(node.dataset.until) - now;
    if (ms <= 0) {
      const container = node.closest("[data-tab]");
      if (container) rebuild.add(container);
      continue;
    }
    node.textContent = `${timeLeft(ms)}${node.dataset.suffix ?? ""}`;
  }
  for (const container of rebuild) {
    const scroll = container.scrollTop;
    window.midaTabs.mount(container.dataset.tab, container, container.midaCtx);
    container.scrollTop = scroll;
  }
}, 1000);

window.dispatchEvent(new Event("mida-tabs-ready"));
