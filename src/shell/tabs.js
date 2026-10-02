// Mida's built-in Destiny 2 tabs, drawn by the app itself (not websites). Loaded as a module
// after shell.js, which calls window.midaTabs.mount(id, container, ctx) when a tab is shown and
// update(...) when the app's state changes. ctx gives the shell's helpers (el, svg) and state.
//
// The schedules and loot tables in ./d2/ are unchanged copies of seals.report's lib/rotations.js,
// lib/rotators.js and lib/loot-tables.js, so both show the same weeks; copy them again when those
// change. Everything here is worked out on this computer: nothing is fetched.

import { featuredRotation, dreamingCityWeek, distortionSchedule, RAID_NAMES, DUNGEON_NAMES } from "./d2/rotations.js";
import { ROTATORS, withSaved, rotatorNow } from "./d2/rotators.js";
import { LOOT_TABLES, WEAPON_KINDS } from "./d2/loot-tables.js";
import { inventory as inventoryScreen, loadoutDock } from "./inventory.js";
import { seasonalHub } from "./seasonal.js";

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

const localTime = (iso) => new Date(iso).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
const localDate = (iso) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });

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

// ---------- Featured ----------

function featured(ctx) {
  const { el } = ctx;
  const now = Date.now();
  const rotation = featuredRotation(now);
  const reset = rotation.activities.find((a) => a.ends)?.ends;
  const weekStart = new Date(new Date(reset).getTime() - 7 * 24 * 3600e3).toISOString();
  const activity = (a) =>
    card(ctx, {
      kicker: a.kind === "raid" ? "Raid" : "Dungeon",
      name: a.name,
      place: a.destination,
      meta: a.always ? el("span", { text: "Always featured" }) : until(ctx, a.ends),
    });
  const city = dreamingCityWeek(now);
  const distortions = distortionSchedule(now, 6);
  const [current, ...later] = distortions;

  return el(
    "div",
    { class: "tab" },
    head(ctx, "Featured", [`Week of ${localDate(weekStart)} to ${localDate(reset)} · weekly reset in `, until(ctx, reset, "")]),
    band(ctx, "Raids"),
    el("div", { class: "cards" }, ...rotation.activities.filter((a) => a.kind === "raid").map(activity)),
    band(ctx, "Dungeons"),
    el("div", { class: "cards" }, ...rotation.activities.filter((a) => a.kind === "dungeon").map(activity)),
    el(
      "p",
      { class: "tab__note" },
      `Next week: ${rotation.next.raids.join(" and ")}; ${rotation.next.dungeons.join(" and ")}.`,
    ),
    band(ctx, "Dreaming City"),
    el(
      "div",
      { class: "cards" },
      card(ctx, { kicker: "Ascendant Challenge", name: city.ascendant.name, place: city.ascendant.location, meta: until(ctx, city.weekEnd), note: "Moves every week on a six-week loop." }),
      card(ctx, { kicker: "Curse", name: city.curse.label, meta: until(ctx, city.weekEnd), note: "Grows over three weeks, then starts again." }),
    ),
    band(ctx, "Distortion"),
    el(
      "div",
      { class: "cards" },
      card(ctx, { kicker: "Distorted right now", name: current.destination, detail: current.activity, meta: until(ctx, current.end) }),
      el(
        "div",
        { class: "card card--list" },
        el("div", { class: "card__kicker", text: "Next, your time" }),
        ...later.map((d) => el("div", { class: "row" }, el("span", { class: "row__time", text: localTime(d.start) }), el("span", { text: `${d.destination} · ${d.activity}` }))),
      ),
    ),
    band(ctx, "Rotators"),
    el(
      "div",
      { class: "cards" },
      ...ROTATORS.map((def) => {
        const rotator = withSaved(def, savedRotators[def.id] ?? null);
        const at = rotatorNow(rotator, now, 3);
        const detail = at.current.detail;
        return el(
          "div",
          { class: `card${at.unknown ? " card--muted" : ""}` },
          el("div", { class: "card__kicker", text: `${def.title} · ${def.period}` }),
          el("div", { class: "card__name", text: at.current.name }),
          detail ? el("div", { class: "card__detail", text: detail }) : null,
          el("div", { class: "card__meta" }, ctx.svg(CLOCK), until(ctx, at.ends, " until it changes")),
          at.next.length
            ? el("div", { class: "card__next" }, ...at.next.map((n) => el("div", { class: "row" }, el("span", { class: "row__time", text: localDate(n.starts) }), el("span", { text: n.entry.name }))))
            : null,
          rotator.confirmed ? null : el("div", { class: "card__note", text: "Worked out from guide sites; may be off." }),
        );
      }),
    ),
    el(
      "p",
      { class: "tab__note" },
      "Bungie doesn't publish these schedules, so they're counted from known weeks, with any corrections made on seals.report. Times are shown in your time zone.",
    ),
  );
}

// ---------- RAD assistant ----------

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
  "tab-seasonal": "The season in one place: orders, daily and weekly objectives, weekly rewards and your season pass track (past passes too).",
  "tab-quests": "Every quest a character has picked up. Starts on the character you played last; switch any time.",
};
const SHIELD = ["M12 3l8 4v5c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V7z", "M9 12l2 2 4-4"];

function signIn(ctx, id) {
  const { el, svg, state, hub } = ctx;
  const tab = state.tabCatalogue.find((t) => t.id === id);
  const account = state.account ?? {};
  const note = !account.available
    ? "This copy of Mida was built without a Bungie key, so it can't sign in."
    : account.busy
      ? "Finish signing in in your browser, then come back here. (Closed the tab? Wait a moment and try again.)"
      : "Sign in with Bungie in your browser. Mida keeps the sign-in on this computer only, encrypted by Windows, and can sign out any time from Settings.";
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

// Data read from Bungie, shared by the tabs and kept for a minute.
const cache = { inventory: null, activity: null };
async function read(ctx, which, fresh) {
  const entry = cache[which];
  if (!fresh && entry && Date.now() - entry.at < 60_000) return entry.result;
  const result = await (which === "inventory" ? ctx.hub.d2Inventory() : ctx.hub.d2Activity());
  cache[which] = { at: Date.now(), result };
  return result;
}

function loadingView(ctx, text) {
  return ctx.el("div", { class: "tab tab--signin" }, ctx.el("div", { class: "signin" }, ctx.el("div", { class: "spinner", "aria-hidden": "true" }), ctx.el("p", { class: "tab__lede", text })));
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

// ---------- Quests ----------

function quests(ctx, container) {
  const { el } = ctx;
  const root = el("div", { class: "tab" });
  const draw = (data) => {
    const chosen = data.characters.some((c) => c.id === lastCharacter.quests) ? lastCharacter.quests : data.characters[0]?.id;
    const list = data.quests[chosen] ?? [];
    root.replaceChildren(
      head(ctx, "Quests", `${list.length} picked up · ${ctx.state.account?.name ?? ""}`),
      el(
        "div",
        { class: "tab__tools" },
        characterPicker(ctx, data.characters, chosen, (id) => {
          lastCharacter.quests = id;
          draw(data);
        }),
        el("button", { class: "btn btn--small", type: "button", text: "Refresh", onclick: () => load(true) }),
      ),
      list.length
        ? el("div", { class: "cards cards--wide" }, ...list.map((q) => questCard(ctx, q)))
        : el("p", { class: "tab__note", text: "No quests on this character." }),
    );
  };
  const load = async (fresh) => {
    container.replaceChildren(loadingView(ctx, "Reading your quests from Bungie…"));
    const result = await read(ctx, "activity", fresh);
    if (!result?.ok) return container.replaceChildren(problemView(ctx, result?.error ?? "Something went wrong.", () => load(true)));
    draw(result.data);
    container.replaceChildren(root);
  };
  load(false);
}

// ---------- Seasonal Hub ----------

function seasonal(ctx, container) {
  seasonalHub(ctx, container, { read, loadingView, problemView, until, characterPicker, questCard, lastCharacter });
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
const SIGNED_IN = { "tab-inventory": inventoryTab, "tab-quests": quests, "tab-seasonal": seasonal };

// What a sign-in tab depends on: remount when the account changes.
const accountKey = (ctx) => {
  const a = ctx.state.account ?? {};
  return `${a.signedIn}|${a.busy}|${a.error ?? ""}|${a.name ?? ""}`;
};

// seals.report's rotator corrections (fetched once a run), applied over the built-in defaults.
let savedRotators = {};
let rotatorsAsked = false;

window.midaTabs = {
  mount(id, container, ctx) {
    container.dataset.tab = id;
    container.midaCtx = ctx;
    container.dataset.account = accountKey(ctx);
    if (SIGNED_IN[id]) {
      if (ctx.state.account?.signedIn) SIGNED_IN[id](ctx, container);
      else container.replaceChildren(signIn(ctx, id));
      return;
    }
    container.replaceChildren((BUILDERS[id] ?? ((c) => signIn(c, id)))(ctx));
    if (id === "tab-featured" && !rotatorsAsked) {
      rotatorsAsked = true;
      ctx.hub.d2Rotators().then((saved) => {
        savedRotators = saved && typeof saved === "object" ? saved : {};
        if (Object.keys(savedRotators).length && container.dataset.tab === id) this.mount(id, container, ctx);
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
  update(id, container, ctx) {
    if (SIGNED_IN[id] && container.dataset.account !== accountKey(ctx)) {
      cache.inventory = cache.activity = null;
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
