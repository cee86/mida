// The Inventory tab (Destiny 2): the owner's layout, DIM-like tiles, the game's look.
//
//   [ title band on the current character's emblem ................. search ]
//   [ tabs | filters | size | postmaster | refresh | characters | panel        ]
//   [ character emblems (DIM style) ..................... vault: count / max ]  <- fixed bar,
//   [ currencies under the characters                                        ]     full width
//   [ one row per bucket: each character's equipped item + 3x3, then vault   ] [ side panel ]
//
// Over it: the item card (hover shows it, a click pins it with moves, lock, perk and mod
// changes), the filter screen (like the game's vault filters) and the postmaster drop-down.
// Behind it: a darkened, blurred backdrop (a picture the player picks in Settings, or our own).
// Data comes from the app (src-tauri/src/bungie.rs). Moves show at once and undo if Bungie
// refuses.

const TIERS = { 6: "exotic", 5: "legendary", 4: "rare", 3: "common", 2: "basic" };
const RARITY = { 6: "Exotic", 5: "Legendary", 4: "Rare", 3: "Uncommon", 2: "Common" };
const ELEMENTS = { 1: "kinetic", 2: "arc", 3: "solar", 4: "void", 6: "stasis", 7: "strand" };
const ELEMENT_NAMES = { arc: "Arc", solar: "Solar", void: "Void", stasis: "Stasis", strand: "Strand", kinetic: "Kinetic" };
const AMMO = { 1: "Primary", 2: "Special", 3: "Heavy" };
const BREAKERS = { 1: "Barrier", 2: "Overload", 3: "Unstoppable" };
const CLASSES = { 0: "Titan", 1: "Hunter", 2: "Warlock", 3: "Any class" };
const GROUPS = [
  ["weapons", "Weapons"],
  ["armor", "Armor"],
  ["general", "General"],
  ["inventory", "Inventory"],
];
const SIZES = { s: 44, m: 56, l: 68 };
// How many slots a character has per bucket besides the equipped one (engrams: 10, none equipped).
const SLOTS = { 375726501: 10 };
const ENGRAMS = 375726501;
export const BACKDROP_KEY = "mida-inv-backdrop";
// What's drawn on top of item icons (Settings -> Personalization -> Inventory item icons). Mirrored
// in shell.js, which saves it; each shows through a data attribute on the tab (CSS does the rest).
const OVERLAYS_KEY = "mida-inv-overlays";
const OVERLAY_DEFAULTS = { power: true, lock: true, element: true, watermark: true, masterwork: true, tier: false, banner: false };
const overlayChoices = () => {
  try {
    return { ...OVERLAY_DEFAULTS, ...JSON.parse(localStorage.getItem(OVERLAYS_KEY) ?? "{}") };
  } catch {
    return { ...OVERLAY_DEFAULTS };
  }
};

const LOCK = ["M7 11V8a5 5 0 0 1 10 0v3", "M5 11h14v10H5z"];
const UNLOCK = ["M7 11V8a5 5 0 0 1 9.6-2", "M5 11h14v10H5z"];
const SEARCH = ["M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z", "M20 20l-4-4"];
const PANEL = ["M4 5h16v14H4z", "M15 5v14"];
const MAIL = ["M4 6h16v12H4z", "M4 7l8 6 8-6"];
const FILTER = ["M4 5h16l-6 8v5l-4 2v-7z"];
const RELOAD = ["M19 12a7 7 0 1 1-2.05-4.95M19 4v4h-4"];
// Our own vault-door mark (circle, hub and bolts), not Bungie's art.
const VAULT = ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", "M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z", "M12 3v5.5M12 15.5V21M3 12h5.5M15.5 12H21M5.6 5.6l3.9 3.9M14.5 14.5l3.9 3.9M18.4 5.6l-3.9 3.9M9.5 14.5l-3.9 3.9"];
const MAIN_CURRENCIES = [/^glimmer$/i, /chronolog/i, /^bright dust$/i];
// Materials shown with the currencies (names as Bungie spells them; anything else stays in Consumables).
const MATERIALS = /enhancement (core|prism)|ascendant (shard|alloy)|upgrade module|spoils of conquest|strange coin|exotic cipher|chronolog|raid banner|phantasmal|harmonic|synthweave|kell's|engram tracker/i;

// Remembered between visits (only conveniences, so the browser's storage is fine).
const remember = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(`mida-inv-${key}`)) ?? fallback;
  } catch {
    return fallback;
  }
};
const keep = (key, value) => {
  try {
    localStorage.setItem(`mida-inv-${key}`, JSON.stringify(value));
  } catch {
    // Only a convenience.
  }
};
const backdropPicture = () => {
  try {
    return localStorage.getItem(BACKDROP_KEY);
  } catch {
    return null;
  }
};

// Class figures for the loadout: a picture the player picked for that class (Settings ->
// Personalization -> Loadout figures, kept on this PC), else our own simple silhouette in front of
// a soft glow in the class's colour.
export const FIGURE_KEY = (classType) => `mida-inv-figure-${classType}`;
const FIGURES = {
  // Titan: broad shoulders, rifle raised.
  0: ["M44 22a8 9 0 1 1 12 0v12H44z", "M29 44l16-6h10l16 6 4 16-6 36H31l-6-36z", "M22 44l15-5-2 19-14-2z", "M78 44l-15-5 2 19 14-2z", "M22 57l9 2-2 32-8-2z", "M68 57l8-1 6-28-7-2z", "M74 6h6l2 56h-6z", "M31 96h38l2 12H29z", "M30 108h18l-2 62 2 16H30l2-16z", "M52 108h18l-2 62 2 16H52l2-16z"],
  // Hunter: hood, cloak, gun over the shoulder.
  1: ["M42 24q8-12 16 0v14H42z", "M36 40h28l2 55H34z", "M60 42l12 8 8 120-10-10-4 15-4-75z", "M36 42l-6 2v-14l6-2z", "M20 36l44-17 2 5-44 17z", "M64 44l6 2v44h-6z", "M35 95h14l-1 74 2 17H35l2-17z", "M51 95h14l-2 74 2 17H51l2-17z"],
  // Warlock: long coat, Light in an open hand, rifle at the side.
  2: ["M43 24a7 8 0 1 1 14 0v12H43z", "M38 40h24l8 110-12 10-8-10-8 10-12-10z", "M62 44l18 26-4 4-16-18z", "M38 44l-6 46 5 2 5-42z", "M27 70h5l-1 60h-5z", "M42 150h7l-1 36h-8z", "M51 150h7l2 36h-8z"],
};
export function classFigure(classType) {
  let picture = null;
  try {
    picture = localStorage.getItem(FIGURE_KEY(classType));
  } catch {
    // The drawn figure shows.
  }
  const box = document.createElement("div");
  box.className = `inv-figure inv-figure--${{ 0: "titan", 1: "hunter", 2: "warlock" }[classType] ?? "any"}`;
  box.setAttribute("aria-hidden", "true");
  if (picture) {
    box.classList.add("has-picture");
    box.style.backgroundImage = `url("${picture}")`;
    return box;
  }
  const ns = "http://www.w3.org/2000/svg";
  const art = document.createElementNS(ns, "svg");
  art.setAttribute("viewBox", "0 0 100 190");
  for (const d of FIGURES[classType] ?? FIGURES[0]) {
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", d);
    art.append(path);
  }
  if (classType === 2) {
    const orb = document.createElementNS(ns, "circle");
    Object.entries({ cx: 82, cy: 68, r: 5, class: "inv-figure__light" }).forEach(([k, v]) => orb.setAttribute(k, v));
    art.append(orb);
  }
  box.append(art);
  return box;
}

const view = {
  group: remember("group", "weapons"),
  size: remember("size", "m"),
  allCharacters: remember("all", true),
  panel: remember("panel", true),
  // Per tab: { category: [values] }.
  filters: remember("filters2", {}),
  current: null,
};

export function inventory(ctx, container, { read, invalidate, loadingView, problemView }) {
  const { el, svg } = ctx;
  let data = null;
  let search = "";
  let resync = null;
  let overlay = null; // "filters" | "postmaster" | "wallet" | null
  let filterCategory = null;
  let card = null; // { item, tile, pinned, picking }
  let hoverTimer = null;
  const details = {}; // side panel data per character
  const itemDetails = new Map(); // item card data per instance
  const root = el("div", { class: "tab tab--inventory inv" });
  const backdrop = el("div", { class: "inv-backdrop", "aria-hidden": "true" });
  const toast = el("div", { class: "toast", role: "status", hidden: true });
  const say = (text) => {
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => (toast.hidden = true), 5000);
  };
  // Something Bungie refused: shown here and kept in the notifications (the bell in the sidebar).
  const fail = (title, detail) => {
    say(detail);
    ctx.notify?.({ kind: "error", title, detail });
  };

  const chars = () => data.characters;
  const current = () => chars().find((c) => c.id === view.current) ?? chars()[0];
  // "Current only" applies to weapons and armor; General and Inventory always show everyone.
  const characterChoice = () => view.group === "weapons" || view.group === "armor";
  const shown = () => (view.allCharacters || !characterChoice() ? chars() : [current()]);
  const charName = (id) => chars().find((c) => c.id === id)?.className ?? "character";
  const fits = (item, c) => item.classType === 3 || item.classType === c.classType;
  const bucketInfo = (hash) => data.buckets.find((b) => b.hash === hash);
  // Bungie needs a character for account-wide and vault items: use the first.
  const actingCharacter = (item) => (item.owner === "vault" || item.owner === "account" ? chars()[0].id : item.owner);

  // ---------- Filters (like the game's vault filters) ----------

  let duplicates = new Set();
  const countDuplicates = () => {
    const seen = new Map();
    for (const i of data.items) if (i.instance) seen.set(i.hash, (seen.get(i.hash) ?? 0) + 1);
    duplicates = new Set([...seen].filter(([, n]) => n > 1).map(([h]) => h));
  };
  const common = {
    gear: ["Gear Tier", (i) => (i.gearTier ? `Tier ${i.gearTier}` : null)],
    rarity: ["Rarity", (i) => RARITY[i.tier] ?? null],
    mw: ["Masterwork", (i) => (i.instance ? (i.masterwork ? "Masterworked" : "Not masterworked") : null)],
    dupes: ["Duplicates", (i) => (i.instance ? (duplicates.has(i.hash) ? "Duplicates" : "No duplicates") : null)],
    locked: ["Locked", (i) => (i.instance ? (i.locked ? "Locked" : "Unlocked") : null)],
  };
  const slotOf = (i) => bucketInfo(i.bucket)?.name ?? null;
  const CATEGORIES = {
    weapons: [
      ["slot", "Slot", slotOf],
      ["type", "Archetype", (i) => i.typeName || null],
      ["damage", "Damage Type", (i) => ELEMENT_NAMES[ELEMENTS[i.damage]] ?? null],
      ["ammo", "Ammo Type", (i) => AMMO[i.ammo] ?? null],
      ["breaker", "Anti-Champion", (i) => BREAKERS[i.breaker] ?? null],
      ["gear", ...common.gear],
      ["rarity", ...common.rarity],
      ["mw", ...common.mw],
      ["dupes", ...common.dupes],
      ["locked", ...common.locked],
    ],
    armor: [
      ["slot", "Armor Slot", slotOf],
      ["archetype", "Archetype", (i) => i.archetype ?? null],
      ["class", "Class", (i) => CLASSES[i.classType] ?? null],
      ["gear", ...common.gear],
      ["mw", ...common.mw],
      ["rarity", ...common.rarity],
      ["dupes", ...common.dupes],
      ["locked", ...common.locked],
      ["set", "Set Bonus", (i) => (i.set ? data.setNames?.[i.set] ?? null : null)],
    ],
    general: [["slot", "Slot", slotOf], ["rarity", ...common.rarity], ["dupes", ...common.dupes], ["locked", ...common.locked]],
    inventory: [["slot", "Slot", slotOf], ["rarity", ...common.rarity]],
  };
  const groupItems = () => data.items.filter((i) => bucketInfo(i.bucket)?.group === view.group);
  const optionsFor = ([, , value]) => {
    const values = [...new Set(groupItems().map(value).filter(Boolean))];
    return values.sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
  };
  const chosen = () => view.filters[view.group] ?? {};
  const chosenCount = () => Object.values(chosen()).reduce((n, list) => n + list.length, 0);
  function setChosen(cat, values) {
    const next = { ...chosen(), [cat]: values };
    if (!values.length) delete next[cat];
    view.filters = { ...view.filters, [view.group]: next };
    keep("filters2", view.filters);
  }
  function passes(item) {
    if (search && !`${item.name} ${item.typeName} ${item.archetype ?? ""}`.toLowerCase().includes(search)) return false;
    const picks = chosen();
    for (const cat of CATEGORIES[view.group] ?? []) {
      const list = picks[cat[0]];
      if (list?.length && !list.includes(cat[2](item))) return false;
    }
    return true;
  }

  // ---------- Moves and changes ----------

  async function act(item, to, equip) {
    const before = { owner: item.owner, equipped: item.equipped };
    const displaced = equip ? data.items.find((i) => i.owner === to && i.equipped && i.bucket === item.bucket && i !== item) : null;
    item.moving = true;
    item.owner = to === chars()[0].id && bucketInfo(item.bucket)?.account ? "account" : to;
    item.equipped = Boolean(equip);
    if (displaced) displaced.equipped = false;
    closeCard();
    draw();
    const ref = { hash: item.hash, instance: item.instance, owner: before.owner === "account" ? chars()[0].id : before.owner, quantity: item.quantity };
    const result = equip ? await ctx.hub.d2Equip(ref, to) : await ctx.hub.d2Transfer(ref, to);
    item.moving = false;
    if (!result?.ok) {
      item.owner = before.owner;
      item.equipped = before.equipped;
      if (displaced) displaced.equipped = true;
      fail(`Couldn't move ${item.name}`, result?.error ?? "That didn't work.");
    } else {
      invalidate();
      window.dispatchEvent(new CustomEvent("mida-inventory-changed", { detail: root }));
      delete details[to];
      clearTimeout(resync);
      resync = setTimeout(() => load(true, true), 6000);
    }
    draw();
  }

  async function pull(item) {
    closeCard();
    const result = await ctx.hub.d2Pull({ hash: item.hash, instance: item.instance, owner: item.owner, quantity: item.quantity });
    if (!result?.ok) return fail(`Couldn't pull ${item.name}`, result?.error ?? "Couldn't pull that.");
    say(`${item.name} is on its way to your ${charName(item.owner)}.`);
    invalidate();
    load(true, true);
  }

  async function toggleLock(item) {
    const want = !item.locked;
    item.locked = want;
    drawCard();
    const result = await ctx.hub.d2Lock(item.instance, actingCharacter(item), want);
    if (!result?.ok) {
      item.locked = !want;
      fail(`Couldn't ${want ? "lock" : "unlock"} ${item.name}`, result?.error ?? "Couldn't change the lock.");
    } else {
      invalidate();
    }
    draw();
  }

  // Perk and mod swaps run in the background: the card shows the new choice at once (marked as
  // waiting), stays usable, and any other item can be looked at meanwhile; Bungie's refusal undoes it.
  async function swapPlug(item, socket, plug) {
    const key = item.instance;
    const s = itemDetails.get(key)?.sockets?.find((x) => x.index === socket.index);
    if (!s || s.pending) return;
    const before = { current: s.current, picks: s.options.map((o) => o.current) };
    s.options.forEach((o) => (o.current = o.hash === plug.hash));
    s.current = { ...plug, current: undefined };
    s.pending = true;
    if (card?.item.instance === key) card.picking = null;
    const redraw = () => card?.item.instance === key && drawCard();
    redraw();
    const result = await ctx.hub.d2Plug(item.instance, actingCharacter(item), socket.index, plug.hash);
    s.pending = false;
    if (!result?.ok) {
      s.current = before.current;
      s.options.forEach((o, i) => (o.current = before.picks[i]));
      fail(`Couldn't change ${plug.name} on ${item.name}`, result?.error ?? "Couldn't change that.");
    } else {
      invalidate();
      // Read the item again quietly (stats change with perks and mods).
      ctx.hub.d2Item(item.instance, item.hash).then((fresh) => {
        if (fresh?.ok) itemDetails.set(key, fresh.data);
        redraw();
      });
    }
    redraw();
  }

  // What can be done with an item, as card buttons.
  function actionsFor(item) {
    if (item.postmaster) return [{ label: `Pull to ${charName(item.owner)}`, disabled: !item.transferable, run: () => pull(item) }];
    const list = [];
    const account = bucketInfo(item.bucket)?.account;
    if (account) {
      if (item.owner === "vault") list.push({ label: "To inventory", disabled: !item.transferable, run: () => act(item, chars()[0].id, false) });
      else list.push({ label: "To vault", disabled: !item.transferable, run: () => act(item, "vault", false) });
      return list;
    }
    if (item.instance && item.bucket !== ENGRAMS) {
      for (const c of chars()) {
        if (fits(item, c) && !(item.owner === c.id && item.equipped)) {
          list.push({ label: `Equip ${c.className}`, primary: true, disabled: (!item.transferable && item.owner !== c.id) || (item.equipped && item.owner !== c.id), run: () => act(item, c.id, true) });
        }
      }
    }
    for (const c of chars()) {
      if (c.id !== item.owner && fits(item, c)) list.push({ label: `To ${c.className}`, disabled: !item.transferable || item.equipped, run: () => act(item, c.id, false) });
    }
    if (item.owner !== "vault") list.push({ label: "To vault", disabled: !item.transferable || item.equipped, run: () => act(item, "vault", false) });
    return list;
  }

  // ---------- Tiles ----------

  function tile(item) {
    const element = ELEMENTS[item.damage];
    const value = item.power ? String(item.power) : item.quantity > 1 ? item.quantity.toLocaleString() : "";
    const node = el(
      "button",
      {
        class: `tile2 tile2--${TIERS[item.tier] ?? "basic"}${item.masterwork ? " is-mw" : ""}${item.moving ? " is-moving" : ""}${passes(item) ? "" : " is-dim"}${card?.item === item ? " is-open" : ""}`,
        type: "button",
        draggable: item.transferable && !item.equipped && !item.postmaster ? "true" : null,
        "aria-label": item.name,
        "aria-haspopup": "dialog",
        onclick: (event) => {
          event.stopPropagation();
          clearTimeout(hoverTimer);
          if (card?.pinned && card.item === item) closeCard();
          else openCard(item, event.currentTarget, true);
        },
        onpointerenter: (event) => {
          if (event.pointerType !== "mouse" || card?.pinned) return;
          const target = event.currentTarget;
          clearTimeout(hoverTimer);
          hoverTimer = setTimeout(() => !card?.pinned && openCard(item, target, false), 260);
        },
        onpointerleave: () => {
          clearTimeout(hoverTimer);
          if (card && !card.pinned) closeCard();
        },
        ondragstart: (event) => {
          clearTimeout(hoverTimer);
          if (card && !card.pinned) closeCard();
          event.dataTransfer.setData("text/plain", item.id);
          event.dataTransfer.effectAllowed = "move";
        },
      },
      item.icon ? el("img", { class: "tile2__icon", src: item.icon, alt: "", loading: "lazy", draggable: "false" }) : null,
      item.watermark ? el("img", { class: "tile2__mark", src: item.watermark, alt: "", loading: "lazy", draggable: "false" }) : null,
      item.locked ? el("span", { class: "tile2__lock", title: "Locked" }, svg(LOCK)) : null,
      item.gearTier && item.instance ? el("span", { class: "tile2__tier", title: `Gear tier ${item.gearTier}` }, ...Array.from({ length: Math.min(5, item.gearTier) }, () => el("i"))) : null,
      value
        ? el(
            "span",
            { class: `tile2__bar${item.power ? "" : " tile2__bar--count"}` },
            element && element !== "kinetic" ? el("i", { class: `tile2__element tile2__element--${element}` }) : null,
            el("span", { class: item.power ? "tile2__power" : "tile2__count", text: value }),
          )
        : null,
    );
    return node;
  }
  const slot = () => el("span", { class: "tile2 tile2--empty", "aria-hidden": "true" });

  // ---------- The item card ----------

  function openCard(item, tileNode, pinned) {
    card = { item, tile: tileNode, pinned, picking: null };
    if (item.instance && !itemDetails.has(item.instance)) {
      itemDetails.set(item.instance, null);
      ctx.hub.d2Item(item.instance, item.hash).then((result) => {
        itemDetails.set(item.instance, result?.ok ? result.data : { error: result?.error ?? "Couldn't read the details." });
        if (card?.item === item) drawCard();
      });
    }
    drawCard();
    if (pinned) markOpen();
  }

  function closeCard() {
    clearTimeout(hoverTimer);
    card = null;
    root.querySelector(".inv-card")?.remove();
    markOpen();
  }

  function markOpen() {
    root.querySelectorAll(".tile2.is-open").forEach((t) => t.classList.remove("is-open"));
    if (card?.pinned) card.tile.classList.add("is-open");
  }

  function perkButton(item, socket, option, pinned) {
    const active = option.current;
    const canPick = pinned && !active && item.instance && !socket.pending;
    return el(
      "button",
      {
        class: `inv-perk${active ? " is-current" : ""}${active && socket.pending ? " is-pending" : ""}`,
        type: "button",
        title: `${option.name}${option.description ? `\n${option.description}` : ""}${canPick ? "\nClick to switch to this" : ""}`,
        disabled: !canPick || null,
        onclick: (event) => {
          event.stopPropagation();
          swapPlug(item, socket, option);
        },
      },
      option.icon ? el("img", { src: option.icon, alt: "" }) : el("span", { text: option.name.slice(0, 2) }),
    );
  }

  function drawCard() {
    root.querySelector(".inv-card")?.remove();
    if (!card) return;
    const { item, pinned } = card;
    const d = item.instance ? itemDetails.get(item.instance) : undefined;
    const element = ELEMENTS[d?.damage ?? item.damage];
    const power = d?.power ?? item.power;
    const node = el(
      "div",
      { class: `inv-card inv-card--${TIERS[item.tier] ?? "basic"}${pinned ? " is-pinned" : ""}`, role: "dialog", "aria-label": item.name, onclick: (e) => e.stopPropagation() },
      // The game's header: name, then type and rarity, with the season mark and gear tier pips
      // stacked at the right.
      el(
        "header",
        { class: "inv-card__head" },
        el(
          "div",
          { class: "inv-card__titles" },
          el("div", { class: "inv-card__name", text: item.name }),
          el("div", { class: "inv-card__sub" }, el("span", { text: item.typeName }), el("span", { text: d?.tierName || RARITY[item.tier] || "" })),
        ),
        item.watermark || (d?.gearTier ?? item.gearTier)
          ? el(
              "div",
              { class: "inv-card__badges" },
              item.watermark ? el("img", { src: item.watermark, alt: "" }) : null,
              ...Array.from({ length: Math.min(5, d?.gearTier ?? item.gearTier ?? 0) }, () => el("i")),
            )
          : null,
      ),
    );
    const body = el("div", { class: "inv-card__body" });
    node.append(body);

    if (power) {
      body.append(
        el(
          "div",
          { class: "inv-card__power" },
          el("span", { class: `inv-card__light${element ? ` is-${element}` : ""}`, text: String(power) }),
          AMMO[d?.ammo ?? item.ammo] ? el("span", { class: "inv-card__ammo", text: AMMO[d?.ammo ?? item.ammo] }) : null,
        ),
      );
    }
    if (!item.instance) {
      if (item.description) body.append(el("p", { class: "inv-card__desc", text: item.description }));
      if (item.quantity > 1) body.append(el("p", { class: "inv-card__desc", text: `You have ${item.quantity.toLocaleString()}.` }));
    } else if (d === null || d === undefined) {
      body.append(el("p", { class: "tab__note", text: "Reading details…" }));
    } else if (d.error) {
      body.append(el("p", { class: "tab__error", text: d.error }));
    } else {
      for (const t of d.trackers.slice(0, 2)) body.append(el("div", { class: "inv-card__tracker" }, el("span", { text: t.label }), el("strong", { text: Number(t.value ?? 0).toLocaleString() })));
      if (d.stats.length) {
        body.append(
          el(
            "div",
            { class: "inv-card__stats" },
            ...d.stats.map((s) => {
              const row = el("div", { class: "inv-card__stat" }, el("span", { class: "inv-card__statname", text: s.name }));
              if (s.bar) {
                const fill = el("span");
                fill.style.width = `${Math.max(0, Math.min(100, s.value))}%`;
                row.append(el("span", { class: "inv-card__statbar" }, fill));
              } else row.append(el("span"));
              row.append(el("span", { class: "inv-card__statvalue", text: String(s.value) }));
              return row;
            }),
          ),
        );
      }
      const intrinsic = d.sockets.filter((s) => s.kind === "intrinsic");
      for (const s of intrinsic.slice(0, 1)) {
        body.append(el("div", { class: "inv-card__frame" }, s.current.icon ? el("img", { src: s.current.icon, alt: "" }) : null, el("span", { text: s.current.name })));
      }
      const perks = d.sockets.filter((s) => s.kind === "perks");
      if (perks.length) {
        body.append(
          el(
            "div",
            { class: "inv-card__perks" },
            ...perks.map((s) =>
              el(
                "div",
                { class: "inv-perk-col" },
                ...(s.options.length ? s.options : [{ ...s.current, current: true }]).map((o) => perkButton(item, s, o, pinned)),
              ),
            ),
          ),
        );
      }
      const mods = d.sockets.filter((s) => s.kind === "mods");
      if (mods.length) {
        body.append(
          el(
            "div",
            { class: "inv-card__mods" },
            ...mods.map((s) =>
              el(
                "button",
                {
                  class: `inv-mod${card.picking === s.index ? " is-picking" : ""}${s.pending ? " is-pending" : ""}`,
                  type: "button",
                  title: `${s.current.name}${s.current.description ? `\n${s.current.description}` : ""}${pinned && s.options.length ? "\nClick to change" : ""}`,
                  disabled: !pinned || !s.options.length || s.pending || null,
                  onclick: (event) => {
                    event.stopPropagation();
                    card.picking = card.picking === s.index ? null : s.index;
                    drawCard();
                  },
                },
                s.current.icon ? el("img", { src: s.current.icon, alt: "" }) : el("span", { text: "+" }),
              ),
            ),
          ),
        );
        const open = mods.find((s) => s.index === card.picking);
        if (open) {
          body.append(
            el("div", { class: "inv-label" }, el("span", { text: `Change ${open.category.toLowerCase()}` }), el("span", { class: "inv-label__count", text: `${open.options.length} available` })),
            el(
              "div",
              { class: "inv-card__choices" },
              ...open.options.map((o) =>
                el(
                  "button",
                  {
                    class: `inv-choice${o.current ? " is-current" : ""}`,
                    type: "button",
                    title: o.description || o.name,
                    disabled: o.current || open.pending || null,
                    onclick: (event) => {
                      event.stopPropagation();
                      swapPlug(item, open, o);
                    },
                  },
                  o.icon ? el("img", { src: o.icon, alt: "" }) : null,
                  el("span", { text: o.name }),
                ),
              ),
            ),
          );
        }
      }
      if (d.flavor) body.append(el("p", { class: "inv-card__flavor", text: d.flavor }));
    }
    if (d?.sockets?.some((x) => x.pending)) body.append(el("p", { class: "tab__note", text: "Changing it in the game… you can keep browsing." }));

    if (pinned) {
      const actions = actionsFor(item);
      node.append(
        el(
          "footer",
          { class: "inv-card__foot" },
          item.instance && !item.postmaster
            ? el("button", { class: "btn btn--small inv-card__lock", type: "button", title: item.locked ? "Unlock" : "Lock", onclick: () => toggleLock(item) }, svg(item.locked ? LOCK : UNLOCK), el("span", { text: item.locked ? "Locked" : "Unlocked" }))
            : null,
          ...actions.map((a) => el("button", { class: `btn btn--small${a.primary ? " btn--primary" : ""}`, type: "button", disabled: a.disabled || null, text: a.label, onclick: a.run })),
        ),
      );
    } else {
      node.append(el("footer", { class: "inv-card__hint", text: "Click for moves, lock, perks and mods" }));
    }
    root.append(node);
    place(node, card.tile);
  }

  // Next to the tile, inside this tab (never over another pane), flipped to fit.
  function place(node, tileNode) {
    const box = root.getBoundingClientRect();
    const t = tileNode.getBoundingClientRect();
    const w = node.offsetWidth;
    const h = node.offsetHeight;
    let left = t.right - box.left + 10;
    if (left + w > box.width - 8) left = t.left - box.left - w - 10;
    left = Math.max(8, Math.min(left, box.width - w - 8));
    let top = t.top - box.top;
    top = Math.max(8, Math.min(top, box.height - h - 8));
    node.style.left = `${left}px`;
    node.style.top = `${top}px`;
  }

  // ---------- Drop targets ----------

  function dropTarget(node, owner, bucket, equipSlot) {
    node.addEventListener("dragover", (event) => {
      event.preventDefault();
      node.dataset.over = "true";
    });
    node.addEventListener("dragleave", () => delete node.dataset.over);
    node.addEventListener("drop", (event) => {
      event.preventDefault();
      delete node.dataset.over;
      const item = data.items.find((i) => i.id === event.dataTransfer.getData("text/plain"));
      if (!item || item.bucket !== bucket) return say("Drop it in the same row it came from.");
      if (equipSlot && event.target.closest(".inv__equipped")) return act(item, owner, true);
      const target = owner === "account" ? chars()[0].id : owner;
      if (item.owner === owner) return;
      const c = chars().find((x) => x.id === owner);
      if (c && !fits(item, c)) return say(`${c.className}s can't use that.`);
      act(item, target, false);
    });
    return node;
  }

  // ---------- Heads: emblems, vault, currencies ----------

  function emblem(c) {
    const active = c.id === current().id;
    const node = el(
      "div",
      { class: `inv-emblem${active ? " is-current" : ""}`, title: active ? "The character shown in the side panel" : "Click to make this the current character" },
      el("button", { class: "inv-emblem__hit", type: "button", "aria-label": `${c.className}${active ? " (current)" : ""}`, onclick: () => ((view.current = c.id), draw()) }),
      el("span", { class: "inv-emblem__text" }, el("span", { class: "inv-emblem__class", text: c.className }), el("span", { class: "inv-emblem__title", text: c.subtitle ?? "" })),
      el("span", { class: "inv-emblem__power" }, el("i", { text: "◆" }), document.createTextNode(String(c.light ?? ""))),
      el("button", {
        class: "inv-emblem__more",
        type: "button",
        "aria-label": `Options for ${c.className}`,
        "aria-haspopup": "menu",
        text: "⋮",
        onclick: (event) =>
          ctx.openMenu(event.currentTarget, [
            { heading: `${c.className} · ${c.subtitle ?? ""}` },
            { label: "Make this the current character", icon: "star", disabled: active, action: () => ((view.current = c.id), draw()) },
            { label: view.allCharacters ? "Show only this character (weapons, armor)" : "Show every character", icon: "split", action: () => ((view.current = c.id), toggleCharacters()) },
          ]),
      }),
    );
    if (c.banner) node.style.backgroundImage = `url("${c.banner}")`;
    return node;
  }

  // The vault's own emblem, like DIM's: a vault-door mark, its name, and how full it is where a
  // character shows power.
  function vaultCard() {
    const v = data.vault ?? {};
    const count = v.count ?? data.items.filter((i) => i.owner === "vault").length;
    return el(
      "div",
      { class: "inv-emblem inv-emblem--vault", title: v.max ? `${count} of ${v.max} vault spaces used` : "Vault" },
      el("span", { class: "inv-vault__mark" }, svg(VAULT)),
      el("span", { class: "inv-emblem__text" }, el("span", { class: "inv-emblem__class", text: "Vault" })),
      el("span", { class: `inv-vault__count${v.max && count >= v.max - 20 ? " is-full" : ""}` }, el("strong", { text: count.toLocaleString() }), document.createTextNode(v.max ? ` / ${v.max.toLocaleString()}` : "")),
    );
  }

  // Currencies: Bungie's profile currencies plus the materials worth tracking (summed from the
  // consumables, wherever they sit). Glimmer, Chronologs and Bright Dust lead; the rest open on click.
  function wallet() {
    const list = (data.currencies ?? []).map((c) => ({ ...c }));
    const seen = new Set(list.map((c) => c.hash));
    const extra = new Map();
    for (const i of data.items) {
      if (seen.has(i.hash) || i.instance || !MATERIALS.test(i.name ?? "")) continue;
      const entry = extra.get(i.hash) ?? { hash: i.hash, name: i.name, icon: i.icon, quantity: 0 };
      entry.quantity += Number(i.quantity ?? 0);
      extra.set(i.hash, entry);
    }
    list.push(...[...extra.values()].sort((a, b) => a.name.localeCompare(b.name)));
    const main = MAIN_CURRENCIES.map((re) => list.find((c) => re.test(c.name ?? ""))).filter(Boolean);
    for (const c of list) if (main.length < 3 && !main.includes(c)) main.push(c);
    return { main, all: list };
  }
  const coin = (c) => el("span", { class: "inv-currency", title: c.name }, c.icon ? el("img", { src: c.icon, alt: "", loading: "lazy" }) : null, el("span", { text: Number(c.quantity ?? 0).toLocaleString() }));

  function currencies() {
    const { main, all } = wallet();
    return el(
      "button",
      {
        class: `inv-wallet${overlay === "wallet" ? " is-open" : ""}`,
        type: "button",
        title: "All currencies",
        "aria-expanded": String(overlay === "wallet"),
        disabled: !all.length || null,
        onclick: (event) => {
          event.stopPropagation();
          overlay = overlay === "wallet" ? null : "wallet";
          closeCard();
          draw();
        },
      },
      ...main.map(coin),
      all.length > main.length ? el("span", { class: "inv-wallet__more", "aria-hidden": "true", text: "▾" }) : null,
    );
  }

  function walletPanel() {
    const { all } = wallet();
    const close = () => ((overlay = null), draw());
    const panel = el(
      "div",
      { class: "inv-wallet-list", role: "dialog", "aria-label": "Currencies", onclick: (e) => e.stopPropagation() },
      el("div", { class: "inv-label" }, el("span", { text: "Currencies" }), el("span", { class: "inv-label__count", text: String(all.length) })),
      ...all.map((c) => el("div", { class: "inv-wallet-list__row" }, c.icon ? el("img", { src: c.icon, alt: "" }) : el("span"), el("span", { class: "inv-wallet-list__name", text: c.name }), el("strong", { text: Number(c.quantity ?? 0).toLocaleString() }))),
    );
    return el("div", { class: "inv-overlay inv-overlay--clear", onclick: close }, panel);
  }

  function toggleCharacters() {
    view.allCharacters = !view.allCharacters;
    keep("all", view.allCharacters);
    draw();
  }

  // ---------- Toolbar ----------

  function toolbar() {
    const picks = chosenCount();
    const mail = data.postmaster ?? [];
    return el(
      "div",
      { class: "inv-bar" },
      el("div", { class: "segmented", role: "group", "aria-label": "Show" }, ...GROUPS.map(([id, label]) => el("button", { type: "button", "aria-pressed": String(view.group === id), text: label, onclick: () => ((view.group = id), keep("group", id), closeCard(), draw()) }))),
      el("button", { class: `btn inv-bar__btn${picks ? " is-on" : ""}`, type: "button", "aria-expanded": String(overlay === "filters"), onclick: () => ((overlay = overlay === "filters" ? null : "filters"), closeCard(), draw()) }, svg(FILTER), el("span", { text: picks ? `Filters (${picks})` : "Filters" })),
      el("div", { class: "segmented", role: "group", "aria-label": "Item size" }, ...[["s", "S"], ["m", "M"], ["l", "L"]].map(([id, label]) => el("button", { type: "button", title: `${{ s: "Small", m: "Medium", l: "Large" }[id]} items`, "aria-pressed": String(view.size === id), text: label, onclick: () => ((view.size = id), keep("size", id), draw()) }))),
      el("button", { class: `btn inv-bar__btn${mail.length ? " is-on" : ""}`, type: "button", "aria-expanded": String(overlay === "postmaster"), onclick: () => ((overlay = overlay === "postmaster" ? null : "postmaster"), closeCard(), draw()) }, svg(MAIL), el("span", { text: `Postmaster${mail.length ? ` (${mail.length})` : ""}` })),
      el("button", { class: "btn inv-bar__btn", type: "button", title: "Read everything from Bungie again", onclick: () => load(true) }, svg(RELOAD), el("span", { text: "Refresh" })),
      el("span", { class: "inv-bar__spacer" }),
      characterChoice()
        ? el("div", { class: "segmented", role: "group", "aria-label": "Characters" }, ...[[true, "All characters"], [false, "Current only"]].map(([all, label]) => el("button", { type: "button", "aria-pressed": String(view.allCharacters === all), text: label, onclick: () => view.allCharacters !== all && toggleCharacters() })))
        : null,
      el("button", { class: `icon-btn inv-bar__panel${view.panel ? " is-on" : ""}`, type: "button", title: view.panel ? "Hide the side panel" : "Show the side panel", "aria-pressed": String(view.panel), onclick: () => ((view.panel = !view.panel), keep("panel", view.panel), draw()) }, svg(PANEL)),
    );
  }

  // ---------- The filter screen ----------

  function filterScreen() {
    const cats = (CATEGORIES[view.group] ?? []).filter((c) => optionsFor(c).length);
    if (!cats.find((c) => c[0] === filterCategory)) filterCategory = cats[0]?.[0] ?? null;
    const cat = cats.find((c) => c[0] === filterCategory);
    const options = cat ? optionsFor(cat) : [];
    const picked = cat ? chosen()[cat[0]] ?? [] : [];
    const close = () => ((overlay = null), draw());
    return el(
      "div",
      { class: "inv-overlay", onclick: close },
      el(
        "div",
        { class: "inv-filter", role: "dialog", "aria-label": "Filters", onclick: (e) => e.stopPropagation() },
        el(
          "nav",
          { class: "inv-filter__cats" },
          ...cats.map((c) => {
            const n = (chosen()[c[0]] ?? []).length;
            return el("button", { class: "inv-filter__cat", type: "button", "aria-current": String(c[0] === filterCategory), onclick: () => ((filterCategory = c[0]), draw()) }, el("span", { text: c[1] }), n ? el("span", { class: "inv-filter__n", text: String(n) }) : null);
          }),
        ),
        el(
          "div",
          { class: "inv-filter__main" },
          el("div", { class: "inv-filter__head" }, el("span", { text: "Filters" }), el("span", { class: "inv-filter__count", text: `Currently selected: ${picked.length}/${options.length}` })),
          el(
            "div",
            { class: "inv-filter__grid" },
            ...options.map((o) =>
              el("button", {
                class: "inv-filter__opt",
                type: "button",
                "aria-pressed": String(picked.includes(o)),
                text: o,
                onclick: () => {
                  setChosen(cat[0], picked.includes(o) ? picked.filter((x) => x !== o) : [...picked, o]);
                  draw();
                },
              }),
            ),
          ),
          el(
            "div",
            { class: "inv-filter__foot" },
            el("button", { class: "btn", type: "button", disabled: !cat || null, text: "Select all", onclick: () => (setChosen(cat[0], [...options]), draw()) }),
            el("button", { class: "btn", type: "button", disabled: !picked.length || null, text: "Deselect all", onclick: () => (setChosen(cat[0], []), draw()) }),
            el("button", { class: "btn", type: "button", disabled: !chosenCount() || null, text: "Clear every filter", onclick: () => ((view.filters = { ...view.filters, [view.group]: {} }), keep("filters2", view.filters), draw()) }),
            el("span", { class: "inv-bar__spacer" }),
            el("button", { class: "btn btn--primary", type: "button", text: "Done", onclick: close }),
          ),
        ),
      ),
    );
  }

  // ---------- The postmaster drop-down ----------

  function postmasterPanel() {
    const mail = (data.postmaster ?? []).map((i) => Object.assign(i, { postmaster: true }));
    const close = () => ((overlay = null), closeCard(), draw());
    return el(
      "div",
      { class: "inv-overlay inv-overlay--clear", onclick: close },
      el(
        "div",
        { class: "inv-drop", role: "dialog", "aria-label": "Postmaster", onclick: (e) => e.stopPropagation() },
        el("div", { class: "inv-label" }, el("span", { text: "Postmaster" }), el("span", { class: "inv-label__count", text: `${mail.length} waiting` })),
        mail.length
          ? el(
              "div",
              { class: "inv-drop__chars" },
              ...chars().map((c) => {
                const mine = mail.filter((i) => i.owner === c.id);
                return el(
                  "div",
                  { class: "inv-drop__char" },
                  el("div", { class: "inv-drop__who" }, el("strong", { text: c.className }), el("span", { class: "inv-label__count", text: `${mine.length} / 21` })),
                  el("div", { class: "inv__flow" }, ...mine.map(tile), ...Array.from({ length: Math.max(0, 7 - mine.length) }, slot)),
                );
              }),
            )
          : el("p", { class: "tab__note", text: "Nothing waiting at the postmaster." }),
        el("p", { class: "tab__note", text: "Hover an item for its details; click it to pull it to that character." }),
      ),
    );
  }

  // ---------- The grid ----------

  function grid(children) {
    const g = el("div", { class: "inv__grid" }, ...children);
    g.style.gridTemplateColumns = `${shown().map(() => "var(--cw)").join(" ")} minmax(calc(var(--tile) * 4), 1fr)`;
    return g;
  }

  function rows() {
    const list = shown();
    const buckets = data.buckets.filter((b) => b.group === view.group);
    return buckets.map((b) => {
      const inBucket = data.items.filter((i) => i.bucket === b.hash);
      const cells = [];
      if (b.account) {
        const mine = inBucket.filter((i) => i.owner === "account");
        const cell = el("div", { class: "inv__cell inv__cell--account" }, el("div", { class: "inv__flow" }, ...mine.map(tile)));
        cell.style.gridColumn = `1 / span ${list.length}`;
        cells.push(dropTarget(cell, "account", b.hash, false));
      } else {
        for (const c of list) {
          const mine = inBucket.filter((i) => i.owner === c.id);
          const equipped = mine.find((i) => i.equipped);
          const rest = mine.filter((i) => !i.equipped);
          const capacity = SLOTS[b.hash] ?? 9;
          const empties = Array.from({ length: Math.max(0, capacity - rest.length) }, slot);
          const noEquip = b.hash === ENGRAMS;
          cells.push(
            dropTarget(
              el("div", { class: `inv__cell${noEquip ? " inv__cell--engrams" : ""}` }, noEquip ? null : el("div", { class: "inv__equipped" }, equipped ? tile(equipped) : slot()), el("div", { class: "inv__slots" }, ...rest.map(tile), ...empties)),
              c.id,
              b.hash,
              !noEquip,
            ),
          );
        }
      }
      const inVault = inBucket.filter((i) => i.owner === "vault");
      cells.push(dropTarget(el("div", { class: "inv__cell inv__cell--vault" }, el("div", { class: "inv__flow" }, ...inVault.map(tile))), "vault", b.hash, false));
      const total = b.account ? inBucket.filter((i) => i.owner === "account").length : null;
      return el("section", { class: "inv__row" }, el("div", { class: "inv-label" }, el("span", { text: b.name }), el("span", { class: "inv-label__count", text: total !== null ? `${total} / 50` : `${inVault.length} in vault` })), grid(cells));
    });
  }

  // ---------- Side panel ----------

  function panel() {
    const c = current();
    const d = details[c.id];
    if (d === undefined) {
      details[c.id] = null;
      ctx.hub.d2Character(c.id).then((result) => {
        details[c.id] = result?.ok ? result.data : { error: result?.error ?? "Couldn't load." };
        if (current().id === c.id) draw();
      });
    }
    const equipped = (group) =>
      data.buckets
        .filter((b) => b.group === group || (group === "weapons" && b.name === "Ghost"))
        .map((b) => data.items.find((i) => i.owner === c.id && i.equipped && i.bucket === b.hash))
        .map((i) => (i ? tile(i) : slot()));
    const side = el(
      "aside",
      { class: "inv-side" },
      el("div", { class: "inv-label" }, el("span", { text: "Loadout" })),
      el("div", { class: "inv-side__loadout" }, el("div", { class: "inv-side__col" }, ...equipped("weapons")), classFigure(c.classType), el("div", { class: "inv-side__col" }, ...equipped("armor"))),
    );
    if (!d) side.append(el("p", { class: "tab__note", text: "Reading stats…" }));
    else if (d.error) side.append(el("p", { class: "tab__error", text: d.error }));
    else {
      side.append(
        el("div", { class: "inv-label" }, el("span", { text: "Stats" })),
        el(
          "div",
          { class: "inv-stats" },
          ...d.stats.map((s) => {
            const fill = el("span", { class: "meter__fill" });
            fill.style.width = `${Math.min(100, (Number(s.value) / 200) * 100)}%`;
            return el("div", { class: "inv-stat" }, s.icon ? el("img", { src: s.icon, alt: "" }) : el("span"), el("span", { class: "inv-stat__name", text: s.name }), el("span", { class: "inv-stat__value", text: String(s.value) }), el("span", { class: "meter inv-stat__bar" }, fill));
          }),
        ),
        el("div", { class: "inv-label" }, el("span", { text: "Armor set bonuses" })),
        d.sets.length
          ? el(
              "div",
              { class: "inv-sets" },
              ...d.sets.map((set) =>
                el(
                  "div",
                  { class: "inv-set" },
                  el("div", { class: "inv-set__name" }, el("span", { text: set.name || "Armor set" }), el("span", { class: "inv-label__count", text: `${set.count} equipped` })),
                  ...set.perks.map((p) => el("div", { class: `inv-set__perk${p.active ? " is-active" : ""}` }, el("span", { class: "inv-set__need", text: `${p.need}` }), el("span", {}, el("strong", { text: p.name || "Bonus" }), p.description ? el("span", { class: "inv-set__desc", text: p.description }) : null))),
                ),
              ),
            )
          : el("p", { class: "tab__note", text: "No armor set bonuses from the equipped armor." }),
      );
    }
    return side;
  }

  // ---------- Drawing ----------

  function paintBackdrop() {
    const picture = backdropPicture();
    backdrop.style.backgroundImage = picture ? `url("${picture}")` : "";
    backdrop.classList.toggle("has-picture", Boolean(picture));
  }

  function draw() {
    const c = current();
    view.current = c.id;
    root.style.setProperty("--tile", `${SIZES[view.size] ?? 56}px`);
    const scroll = root.querySelector(".inv-scroll");
    const keepScroll = scroll ? [scroll.scrollTop, scroll.scrollLeft] : null;
    countDuplicates();

    const top = el(
      "header",
      { class: "inv-top" },
      el("div", { class: "inv-top__text" }, el("h1", { class: "inv-top__title", text: "Inventory" }), el("span", { class: "inv-top__sub", text: `${ctx.state.account?.name ?? ""} · ${c.className} · ${c.subtitle ?? ""}` })),
      el(
        "label",
        { class: "inv-search" },
        svg(SEARCH),
        el("input", {
          type: "search",
          placeholder: "Search items",
          value: search,
          "aria-label": "Search items",
          oninput: (event) => {
            search = event.target.value.trim().toLowerCase();
            const pos = event.target.selectionStart;
            draw();
            const input = root.querySelector(".inv-search input");
            input?.focus();
            input?.setSelectionRange(pos, pos);
          },
        }),
      ),
    );
    if (c.wide || c.banner) top.style.backgroundImage = `linear-gradient(90deg, rgba(8, 10, 12, 0.82), rgba(8, 10, 12, 0.35) 60%, rgba(8, 10, 12, 0.6)), url("${c.wide || c.banner}")`;

    // Characters, then the vault's emblem with the currencies box at the far right of its column.
    const heads = grid([...shown().map(emblem), el("div", { class: "inv-heads__vault" }, vaultCard(), currencies())]);
    // The bar runs the whole width (over the side panel too); only the rows under it scroll.
    const headScroll = el("div", { class: "inv-headbar__scroll" }, el("div", { class: "inv-headbar__inner" }, heads));
    const headbar = el(
      "div",
      { class: "inv-headbar" },
      headScroll,
      view.panel
        ? el("div", { class: "inv-headbar__side" }, el("span", { class: "inv-side__class", text: c.className }), el("span", { class: "inv-side__power" }, el("i", { text: "◆" }), document.createTextNode(String(c.light ?? ""))))
        : null,
    );
    const body = el("div", { class: "inv-scroll" }, ...rows());
    body.addEventListener("scroll", () => {
      headScroll.scrollLeft = body.scrollLeft;
      if (card && !card.pinned) closeCard();
    });

    const main = el("div", { class: "inv-main" }, body, view.panel ? panel() : null);
    root.replaceChildren(backdrop, top, toolbar(), headbar, main, toast);
    if (overlay === "filters") root.append(filterScreen());
    if (overlay === "wallet") {
      // Opens under the currencies box (the bar clips anything inside it, so it lives on the tab).
      const layer = walletPanel();
      root.append(layer);
      const box = root.querySelector(".inv-wallet")?.getBoundingClientRect();
      const tab = root.getBoundingClientRect();
      if (box) {
        layer.style.paddingTop = `${box.bottom - tab.top + 6}px`;
        layer.style.paddingRight = `${Math.max(8, tab.right - box.right)}px`;
      }
    }
    if (overlay === "postmaster") {
      // The drop-down hangs just under the toolbar, whatever its height.
      const drop = postmasterPanel();
      root.append(drop);
      const bar = root.querySelector(".inv-bar");
      drop.style.paddingTop = `${bar.offsetTop + bar.offsetHeight + 6}px`;
    }
    if (keepScroll) {
      body.scrollTop = keepScroll[0];
      body.scrollLeft = keepScroll[1];
      headScroll.scrollLeft = keepScroll[1];
    }
    // A pinned card stays open across redraws, on its item's new tile.
    if (card) {
      const tiles = [...root.querySelectorAll(".tile2:not(.tile2--empty)")];
      const again = tiles.find((t) => t.getAttribute("aria-label") === card.item.name && t.classList.contains("is-open"));
      if (again) card.tile = again;
      if (card.pinned && document.body.contains(card.tile)) drawCard();
      else closeCard();
    }
  }

  // Clicking elsewhere or Esc closes the pinned card and overlays.
  root.addEventListener("click", () => card?.pinned && closeCard());
  // Esc works wherever focus is (a redrawn card can drop it to the page).
  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !document.body.contains(root) || document.querySelector("dialog[open]")) return;
    if (card) closeCard();
    else if (overlay) ((overlay = null), draw());
  });
  window.addEventListener("mida-backdrop", paintBackdrop);
  paintBackdrop();
  function paintOverlays() {
    const choices = overlayChoices();
    for (const key of Object.keys(OVERLAY_DEFAULTS)) root.dataset[`ov${key[0].toUpperCase()}${key.slice(1)}`] = choices[key] ? "on" : "off";
  }
  window.addEventListener("mida-overlays", paintOverlays);
  window.addEventListener("mida-figures", () => data && draw());
  // The loadout dock moved something: read again quietly (it already cleared the shared copy).
  window.addEventListener("mida-inventory-changed", (event) => {
    if (event.detail !== root && data && document.body.contains(root)) load(false, true);
  });
  paintOverlays();

  async function load(fresh, quiet) {
    if (!quiet) container.replaceChildren(loadingView(ctx, "Reading your gear from Bungie… (the first time also downloads Destiny's item list)"));
    const result = await read(ctx, "inventory", fresh);
    if (!result?.ok) {
      if (quiet) return say(result?.error ?? "Couldn't refresh.");
      return container.replaceChildren(problemView(ctx, result?.error ?? "Something went wrong.", () => load(true)));
    }
    data = result.data;
    if (!data.characters?.length) return container.replaceChildren(problemView(ctx, "That account has no Destiny 2 characters.", () => load(true)));
    if (!view.current || !data.characters.some((ch) => ch.id === view.current)) view.current = data.characters[0].id;
    if (fresh) {
      for (const key of Object.keys(details)) delete details[key];
      itemDetails.clear();
    }
    if (card) card = { ...card, item: data.items.find((i) => i.id === card.item.id) ?? card.item };
    draw();
    if (!container.contains(root)) container.replaceChildren(root);
  }
  load(false);
}

// ---------- The loadout dock ----------
//
// The current character's equipped gear beside any page (the shell's dock, next to the panes):
// weapons | class figure | armor, then stats. Pointing at a slot lists the other items in that
// character's inventory for it (up to 9, like the game's slot); clicking one equips it. Everything
// stays inside the dock, because sites are drawn over the rest of the window.

const DOCK_SLOTS = { weapons: [1498876634, 2465295065, 953998645, 4023194814], armor: [3448274439, 3551918588, 14239492, 20886954, 1585787867] };

function dockTile(el, svg, item, extra = {}) {
  const element = ELEMENTS[item.damage];
  return el(
    "button",
    { class: `tile2 tile2--${TIERS[item.tier] ?? "basic"}${item.masterwork ? " is-mw" : ""}${item.moving ? " is-moving" : ""}`, type: "button", title: `${item.name}${item.typeName ? ` · ${item.typeName}` : ""}`, "aria-label": item.name, ...extra },
    item.icon ? el("img", { class: "tile2__icon", src: item.icon, alt: "", loading: "lazy", draggable: "false" }) : null,
    item.watermark ? el("img", { class: "tile2__mark", src: item.watermark, alt: "", loading: "lazy", draggable: "false" }) : null,
    item.locked ? el("span", { class: "tile2__lock" }, svg(LOCK)) : null,
    item.gearTier ? el("span", { class: "tile2__tier" }, ...Array.from({ length: Math.min(5, item.gearTier) }, () => el("i"))) : null,
    item.power
      ? el("span", { class: "tile2__bar" }, element && element !== "kinetic" ? el("i", { class: `tile2__element tile2__element--${element}` }) : null, el("span", { class: "tile2__power", text: String(item.power) }))
      : null,
  );
}

export function loadoutDock(ctx, container, { read, invalidate, loadingView, problemView }) {
  const { el, svg } = ctx;
  let data = null;
  let current = remember("dock-character", null);
  let pick = null; // { bucket, tile }
  let closeTimer = null;
  const stats = {};
  const root = el("div", { class: "inv inv-dock" });
  const note = el("p", { class: "tab__note inv-dock__note", role: "status" });

  const paint = () => {
    const choices = overlayChoices();
    for (const key of Object.keys(OVERLAY_DEFAULTS)) root.dataset[`ov${key[0].toUpperCase()}${key.slice(1)}`] = choices[key] ? "on" : "off";
  };
  paint();
  window.addEventListener("mida-overlays", paint);
  window.addEventListener("mida-figures", () => data && draw());
  window.addEventListener("mida-inventory-changed", (event) => {
    if (event.detail !== root && document.body.contains(root)) load(true);
  });

  const char = () => data.characters.find((c) => c.id === current) ?? data.characters[0];
  const equippedIn = (c, bucket) => data.items.find((i) => i.owner === c.id && i.equipped && i.bucket === bucket);
  const spares = (c, bucket) => data.items.filter((i) => i.owner === c.id && !i.equipped && i.bucket === bucket && i.instance).slice(0, 9);
  const slot = () => el("span", { class: "tile2 tile2--empty", "aria-hidden": "true" });

  async function equip(item, c) {
    const was = equippedIn(c, item.bucket);
    item.moving = true;
    item.equipped = true;
    if (was) was.equipped = false;
    pick = null;
    draw();
    const result = await ctx.hub.d2Equip({ hash: item.hash, instance: item.instance, owner: c.id, quantity: 1 }, c.id);
    item.moving = false;
    if (!result?.ok) {
      item.equipped = false;
      if (was) was.equipped = true;
      note.textContent = result?.error ?? "Couldn't equip that.";
      ctx.notify?.({ kind: "error", title: `Couldn't equip ${item.name}`, detail: note.textContent });
    } else {
      note.textContent = "";
      invalidate();
      delete stats[c.id];
      window.dispatchEvent(new CustomEvent("mida-inventory-changed", { detail: root }));
    }
    draw();
  }

  function slotTile(c, bucket) {
    const item = equippedIn(c, bucket);
    if (!item) return slot();
    const node = dockTile(el, svg, item, {
      "aria-haspopup": "true",
      "aria-expanded": String(pick?.bucket === bucket),
      onpointerenter: (event) => {
        clearTimeout(closeTimer);
        const target = event.currentTarget;
        closeTimer = setTimeout(() => ((pick = { bucket, side: DOCK_SLOTS.weapons.includes(bucket) ? "left" : "right" }), drawPick(target)), 120);
      },
      onpointerleave: () => scheduleClose(),
      onclick: (event) => {
        pick = { bucket, side: DOCK_SLOTS.weapons.includes(bucket) ? "left" : "right" };
        drawPick(event.currentTarget);
      },
    });
    return node;
  }

  function scheduleClose() {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      pick = null;
      root.querySelector(".inv-dock__pick")?.remove();
    }, 220);
  }

  // The slot's other items, beside the hovered tile, over the figure.
  function drawPick(anchor) {
    root.querySelector(".inv-dock__pick")?.remove();
    if (!pick) return;
    const c = char();
    const list = spares(c, pick.bucket);
    const name = data.buckets.find((b) => b.hash === pick.bucket)?.name ?? "Slot";
    const panel = el(
      "div",
      { class: "inv-dock__pick", role: "menu", "aria-label": `${name}: equip another`, onpointerenter: () => clearTimeout(closeTimer), onpointerleave: () => scheduleClose() },
      el("div", { class: "inv-label" }, el("span", { text: name }), el("span", { class: "inv-label__count", text: `${list.length} / 9` })),
      list.length
        ? el("div", { class: "inv-dock__grid" }, ...list.map((i) => dockTile(el, svg, i, { role: "menuitem", title: `Equip ${i.name}`, onclick: () => equip(i, c) })))
        : el("p", { class: "tab__note", text: "Nothing else in this slot on this character." }),
    );
    root.append(panel);
    const box = root.getBoundingClientRect();
    const t = anchor.getBoundingClientRect();
    const w = panel.offsetWidth;
    const left = pick.side === "left" ? t.right - box.left + 8 : t.left - box.left - w - 8;
    panel.style.left = `${Math.max(6, Math.min(left, box.width - w - 6))}px`;
    panel.style.top = `${Math.max(6, Math.min(t.top - box.top, box.height - panel.offsetHeight - 6))}px`;
  }

  function draw() {
    const c = char();
    current = c.id;
    if (stats[c.id] === undefined) {
      stats[c.id] = null;
      ctx.hub.d2Character(c.id).then((result) => {
        stats[c.id] = result?.ok ? result.data : { error: result?.error ?? "Couldn't read stats." };
        if (char().id === c.id) draw();
      });
    }
    const st = stats[c.id];
    const head = el(
      "div",
      { class: "inv-dock__head" },
      el(
        "div",
        { class: "segmented inv-dock__chars", role: "group", "aria-label": "Character" },
        ...data.characters.map((x) => el("button", { type: "button", "aria-pressed": String(x.id === c.id), text: x.className, onclick: () => ((current = x.id), keep("dock-character", x.id), (pick = null), draw()) })),
      ),
      el("button", { class: "icon-btn", type: "button", title: "Close the loadout dock", "aria-label": "Close the loadout dock", onclick: () => window.dispatchEvent(new Event("mida-dock-close")) }, svg(["M6 6l12 12M18 6L6 18"])),
    );
    const banner = el(
      "div",
      { class: "inv-emblem inv-dock__emblem" },
      el("span", { class: "inv-emblem__text" }, el("span", { class: "inv-emblem__class", text: c.className }), el("span", { class: "inv-emblem__title", text: c.subtitle ?? "" })),
      el("span", { class: "inv-emblem__power" }, el("i", { text: "◆" }), document.createTextNode(String(c.light ?? ""))),
    );
    if (c.banner) banner.style.backgroundImage = `url("${c.banner}")`;
    const gear = el(
      "div",
      { class: "inv-side__loadout inv-dock__loadout" },
      el("div", { class: "inv-side__col" }, ...DOCK_SLOTS.weapons.map((b) => slotTile(c, b))),
      classFigure(c.classType),
      el("div", { class: "inv-side__col" }, ...DOCK_SLOTS.armor.map((b) => slotTile(c, b))),
    );
    const statList = !st
      ? el("p", { class: "tab__note", text: "Reading stats…" })
      : st.error
        ? el("p", { class: "tab__error", text: st.error })
        : el(
            "div",
            { class: "inv-stats" },
            ...st.stats.map((x) => {
              const fill = el("span", { class: "meter__fill" });
              fill.style.width = `${Math.min(100, (Number(x.value) / 200) * 100)}%`;
              return el("div", { class: "inv-stat" }, x.icon ? el("img", { src: x.icon, alt: "" }) : el("span"), el("span", { class: "inv-stat__name", text: x.name }), el("span", { class: "inv-stat__value", text: String(x.value) }), el("span", { class: "meter inv-stat__bar" }, fill));
            }),
          );
    root.replaceChildren(
      head,
      el("div", { class: "inv-dock__body" }, banner, el("div", { class: "inv-label" }, el("span", { text: "Loadout" }), el("span", { class: "inv-label__count", text: "Point at a slot to swap" })), gear, note, el("div", { class: "inv-label" }, el("span", { text: "Stats" })), statList),
    );
  }

  async function load(fresh) {
    if (!data) container.replaceChildren(loadingView(ctx, "Reading your loadout…"));
    const result = await read(ctx, "inventory", fresh);
    if (!result?.ok) {
      if (data) return (note.textContent = result?.error ?? "Couldn't refresh.");
      return container.replaceChildren(problemView(ctx, result?.error ?? "Something went wrong.", () => load(true)));
    }
    data = result.data;
    if (!data.characters?.length) return container.replaceChildren(problemView(ctx, "That account has no Destiny 2 characters.", () => load(true)));
    draw();
    if (!container.contains(root)) container.replaceChildren(root);
  }
  load(false);
}
