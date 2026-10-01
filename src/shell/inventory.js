// The Inventory tab (Destiny 2): the owner's layout, DIM-like tiles, the game's look.
//
//   [ title band on the current character's emblem ................. search ]
//   [ tabs | filters | size | postmaster | refresh | characters | panel        ]
//   [ character emblems (DIM style) ..................... vault: count / max ]
//   [ currencies under the characters                                        ]
//   [ one row per bucket: each character's equipped item + 3x3, then vault   ] [ side panel ]
//
// Data comes from the app (src-tauri/src/bungie.rs: shape_inventory + decorate_inventory;
// character_details for the side panel). Moves show at once and undo if Bungie refuses.

const TIERS = { 6: "exotic", 5: "legendary", 4: "rare", 3: "common", 2: "basic" };
const ELEMENTS = { 1: "kinetic", 2: "arc", 3: "solar", 4: "void", 6: "stasis", 7: "strand" };
const ELEMENT_NAMES = { arc: "Arc", solar: "Solar", void: "Void", stasis: "Stasis", strand: "Strand", kinetic: "Kinetic" };
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

const LOCK = ["M7 11V8a5 5 0 0 1 10 0v3", "M5 11h14v10H5z"];
const SEARCH = ["M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z", "M20 20l-4-4"];
const PANEL = ["M4 5h16v14H4z", "M15 5v14"];
const MAIL = ["M4 6h16v12H4z", "M4 7l8 6 8-6"];
const FILTER = ["M4 5h16l-6 8v5l-4 2v-7z"];

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

const view = {
  group: remember("group", "weapons"),
  size: remember("size", "m"),
  allCharacters: remember("all", true),
  panel: remember("panel", true),
  filters: new Set(remember("filters", [])),
  current: null,
};

export function inventory(ctx, container, { read, invalidate, loadingView, problemView }) {
  const { el, svg } = ctx;
  let data = null;
  let search = "";
  let resync = null;
  const details = {}; // side panel data per character
  const root = el("div", { class: "tab tab--inventory inv" });
  const toast = el("div", { class: "toast", role: "status", hidden: true });
  const say = (text) => {
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => (toast.hidden = true), 5000);
  };

  const chars = () => data.characters;
  const current = () => chars().find((c) => c.id === view.current) ?? chars()[0];
  const shown = () => (view.allCharacters ? chars() : [current()]);
  const charName = (id) => chars().find((c) => c.id === id)?.className ?? "character";
  const fits = (item, c) => item.classType === 3 || item.classType === c.classType;
  const bucketInfo = (hash) => data.buckets.find((b) => b.hash === hash);
  const isAccount = (item) => item.owner === "account";
  // Account-wide items are moved "from" any character (Bungie needs one), so use the first.
  const refOwner = (item) => (isAccount(item) ? chars()[0].id : item.owner);

  // ---------- Filters and search ----------

  const FILTERS = [
    ["exotic", "Exotic", (i) => i.tier === 6],
    ["legendary", "Legendary", (i) => i.tier === 5],
    ["other", "Rare and below", (i) => i.tier < 5],
    "sep",
    ...["arc", "solar", "void", "stasis", "strand", "kinetic"].map((e) => [e, ELEMENT_NAMES[e], (i) => ELEMENTS[i.damage] === e]),
    "sep",
    ["masterwork", "Masterworked", (i) => i.masterwork],
    ["locked", "Locked", (i) => i.locked],
    ["class", "Usable by this character", (i) => fits(i, current())],
  ];
  // Within a kind of filter (tier, element, other) any match counts; across kinds all must.
  const kinds = [["exotic", "legendary", "other"], ["arc", "solar", "void", "stasis", "strand", "kinetic"], ["masterwork"], ["locked"], ["class"]];
  function passes(item) {
    if (search && !`${item.name} ${item.typeName}`.toLowerCase().includes(search)) return false;
    for (const kind of kinds) {
      const on = kind.filter((k) => view.filters.has(k));
      if (on.length && !on.some((k) => FILTERS.find((f) => f[0] === k)[2](item))) return false;
    }
    return true;
  }

  // ---------- Moves ----------

  async function act(item, to, equip) {
    const before = { owner: item.owner, equipped: item.equipped };
    const displaced = equip ? data.items.find((i) => i.owner === to && i.equipped && i.bucket === item.bucket && i !== item) : null;
    item.moving = true;
    item.owner = to === chars()[0].id && bucketInfo(item.bucket)?.account ? "account" : to;
    item.equipped = Boolean(equip);
    if (displaced) displaced.equipped = false;
    draw();
    const ref = { hash: item.hash, instance: item.instance, owner: before.owner === "account" ? chars()[0].id : before.owner, quantity: item.quantity };
    const result = equip ? await ctx.hub.d2Equip(ref, to) : await ctx.hub.d2Transfer(ref, to);
    item.moving = false;
    if (!result?.ok) {
      item.owner = before.owner;
      item.equipped = before.equipped;
      if (displaced) displaced.equipped = true;
      say(result?.error ?? "That didn't work.");
    } else {
      invalidate();
      delete details[to];
      clearTimeout(resync);
      resync = setTimeout(() => load(true, true), 6000);
    }
    draw();
  }

  function itemMenu(item, anchor) {
    const account = bucketInfo(item.bucket)?.account;
    const items = [{ heading: [item.name, item.typeName, item.power ? `◆ ${item.power}` : item.quantity > 1 ? `×${item.quantity}` : ""].filter(Boolean).join(" · ") }];
    if (account) {
      if (item.owner === "vault") items.push({ label: "Move to your inventory", icon: "up", disabled: !item.transferable, action: () => act(item, chars()[0].id, false) });
      else items.push({ label: "Move to the vault", icon: "down", disabled: !item.transferable, action: () => act(item, "vault", false) });
    } else {
      if (item.equipped) items.push({ label: "Equipped: equip something else first to move it", disabled: true, action: () => {} });
      if (item.instance && item.bucket !== ENGRAMS) {
        for (const c of chars()) {
          if (fits(item, c) && !(item.owner === c.id && item.equipped)) {
            items.push({ label: `Equip on ${c.className}`, icon: "star", disabled: (!item.transferable && item.owner !== c.id) || (item.equipped && item.owner !== c.id), action: () => act(item, c.id, true) });
          }
        }
      }
      for (const c of chars()) {
        if (c.id !== item.owner && fits(item, c)) {
          items.push({ label: `Move to ${c.className}`, icon: "open", disabled: !item.transferable || item.equipped, action: () => act(item, c.id, false) });
        }
      }
      if (item.owner !== "vault") items.push({ label: "Move to the vault", icon: "down", disabled: !item.transferable || item.equipped, action: () => act(item, "vault", false) });
    }
    ctx.openMenu(anchor, items);
  }

  // ---------- Pieces ----------

  function tile(item) {
    const element = ELEMENTS[item.damage];
    const value = item.power ? String(item.power) : item.quantity > 1 ? item.quantity.toLocaleString() : "";
    const node = el(
      "button",
      {
        class: `tile2 tile2--${TIERS[item.tier] ?? "basic"}${item.masterwork ? " is-mw" : ""}${item.moving ? " is-moving" : ""}${passes(item) ? "" : " is-dim"}`,
        type: "button",
        draggable: item.transferable && !item.equipped ? "true" : null,
        title: [item.name, item.typeName, element && element !== "kinetic" ? ELEMENT_NAMES[element] : "", item.power ? `Power ${item.power}` : "", item.masterwork ? "Masterworked" : "", item.crafted ? "Crafted" : "", item.locked ? "Locked" : ""].filter(Boolean).join(" · "),
        "aria-label": item.name,
        "aria-haspopup": "menu",
        onclick: (event) => itemMenu(item, event.currentTarget),
        ondragstart: (event) => {
          event.dataTransfer.setData("text/plain", item.id);
          event.dataTransfer.effectAllowed = "move";
        },
      },
      item.icon ? el("img", { class: "tile2__icon", src: item.icon, alt: "", loading: "lazy", draggable: "false" }) : null,
      item.watermark ? el("img", { class: "tile2__mark", src: item.watermark, alt: "", loading: "lazy", draggable: "false" }) : null,
      value
        ? el(
            "span",
            { class: `tile2__bar${item.power ? "" : " tile2__bar--count"}` },
            element && element !== "kinetic" ? el("i", { class: `tile2__element tile2__element--${element}` }) : null,
            item.locked ? svg(LOCK) : null,
            el("span", { text: value }),
          )
        : null,
    );
    return node;
  }
  const slot = () => el("span", { class: "tile2 tile2--empty", "aria-hidden": "true" });

  // A place items can be dropped: a character's (or the vault's / the account's) part of a row.
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

  function emblem(c) {
    const active = c.id === current().id;
    const card = el(
      "div",
      { class: `inv-emblem${active ? " is-current" : ""}`, title: active ? "The character shown in the side panel" : "Click to make this the current character" },
      el("button", {
        class: "inv-emblem__hit",
        type: "button",
        "aria-label": `${c.className}${active ? " (current)" : ""}`,
        onclick: () => {
          view.current = c.id;
          draw();
        },
      }),
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
            { label: view.allCharacters ? "Show only this character" : "Show every character", icon: "split", action: () => ((view.current = c.id), toggleCharacters()) },
          ]),
      }),
    );
    if (c.banner) card.style.backgroundImage = `url("${c.banner}")`;
    return card;
  }

  function vaultCard() {
    const v = data.vault ?? {};
    return el(
      "div",
      { class: "inv-vault" },
      el("span", { class: "inv-vault__title", text: "Vault" }),
      el("span", { class: "inv-vault__count" }, el("strong", { text: String(v.count ?? data.items.filter((i) => i.owner === "vault").length) }), document.createTextNode(v.max ? ` / ${v.max}` : "")),
    );
  }

  function currencies() {
    return el(
      "div",
      { class: "inv-currencies" },
      ...(data.currencies ?? []).map((c) =>
        el(
          "span",
          { class: "inv-currency", title: c.name },
          c.icon ? el("img", { src: c.icon, alt: "", loading: "lazy" }) : null,
          el("span", { text: Number(c.quantity ?? 0).toLocaleString() }),
        ),
      ),
    );
  }

  function toggleCharacters() {
    view.allCharacters = !view.allCharacters;
    keep("all", view.allCharacters);
    draw();
  }

  // ---------- Toolbar ----------

  function toolbar() {
    const onFilters = view.filters.size;
    const mail = data.postmaster ?? [];
    return el(
      "div",
      { class: "inv-bar" },
      el(
        "div",
        { class: "segmented", role: "group", "aria-label": "Show" },
        ...GROUPS.map(([id, label]) => el("button", { type: "button", "aria-pressed": String(view.group === id), text: label, onclick: () => ((view.group = id), keep("group", id), draw()) })),
      ),
      el(
        "button",
        {
          class: `btn btn--small inv-bar__btn${onFilters ? " is-on" : ""}`,
          type: "button",
          "aria-haspopup": "menu",
          onclick: (event) =>
            ctx.openMenu(event.currentTarget, [
              { heading: "Show only" },
              ...FILTERS.map((f) =>
                f === "sep"
                  ? "sep"
                  : {
                      label: f[1],
                      checked: view.filters.has(f[0]),
                      action: () => {
                        if (view.filters.has(f[0])) view.filters.delete(f[0]);
                        else view.filters.add(f[0]);
                        keep("filters", [...view.filters]);
                        draw();
                      },
                    },
              ),
              "sep",
              { label: "Clear filters", icon: "close", disabled: !onFilters, action: () => (view.filters.clear(), keep("filters", []), draw()) },
            ]),
        },
        svg(FILTER),
        el("span", { text: onFilters ? `Filters (${onFilters})` : "Filters" }),
      ),
      el(
        "div",
        { class: "segmented", role: "group", "aria-label": "Item size" },
        ...[["s", "S"], ["m", "M"], ["l", "L"]].map(([id, label]) =>
          el("button", { type: "button", title: `${{ s: "Small", m: "Medium", l: "Large" }[id]} items`, "aria-pressed": String(view.size === id), text: label, onclick: () => ((view.size = id), keep("size", id), draw()) }),
        ),
      ),
      el(
        "button",
        {
          class: `btn btn--small inv-bar__btn${mail.length ? " is-on" : ""}`,
          type: "button",
          "aria-haspopup": "menu",
          disabled: !mail.length || null,
          onclick: (event) =>
            ctx.openMenu(
              event.currentTarget,
              chars().flatMap((c) => {
                const mine = mail.filter((i) => i.owner === c.id);
                return mine.length
                  ? [
                      { heading: `${c.className}'s postmaster (${mine.length})` },
                      ...mine.map((i) => ({ label: `Pull ${i.name}${i.quantity > 1 ? ` ×${i.quantity}` : ""}`, icon: "down", disabled: !i.transferable, action: () => pull(i) })),
                    ]
                  : [];
              }),
            ),
        },
        svg(MAIL),
        el("span", { text: `Postmaster${mail.length ? ` (${mail.length})` : ""}` }),
      ),
      el("button", { class: "btn btn--small inv-bar__btn", type: "button", title: "Read everything from Bungie again", onclick: () => load(true) }, svg(["M19 12a7 7 0 1 1-2.05-4.95M19 4v4h-4"]), el("span", { text: "Refresh" })),
      el("span", { class: "inv-bar__spacer" }),
      el(
        "div",
        { class: "segmented", role: "group", "aria-label": "Characters" },
        ...[[true, "All characters"], [false, "Current only"]].map(([all, label]) => el("button", { type: "button", "aria-pressed": String(view.allCharacters === all), text: label, onclick: () => view.allCharacters !== all && toggleCharacters() })),
      ),
      el("button", { class: `icon-btn inv-bar__panel${view.panel ? " is-on" : ""}`, type: "button", title: view.panel ? "Hide the side panel" : "Show the side panel", "aria-pressed": String(view.panel), onclick: () => ((view.panel = !view.panel), keep("panel", view.panel), draw()) }, svg(PANEL)),
    );
  }

  async function pull(item) {
    const result = await ctx.hub.d2Pull({ hash: item.hash, instance: item.instance, owner: item.owner, quantity: item.quantity });
    if (!result?.ok) return say(result?.error ?? "Couldn't pull that.");
    say(`${item.name} is on its way to your ${charName(item.owner)}.`);
    invalidate();
    load(true, true);
  }

  // ---------- The grid ----------

  function rows() {
    const list = shown();
    const buckets = data.buckets.filter((b) => b.group === view.group);
    return buckets.map((b) => {
      const inBucket = data.items.filter((i) => i.bucket === b.hash);
      const cells = [];
      if (b.account) {
        // Consumables and mods belong to the account: one wide cell under the characters.
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
              el(
                "div",
                { class: `inv__cell${noEquip ? " inv__cell--engrams" : ""}` },
                noEquip ? null : el("div", { class: "inv__equipped" }, equipped ? tile(equipped) : slot()),
                el("div", { class: "inv__slots" }, ...rest.map(tile), ...empties),
              ),
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
      return el(
        "section",
        { class: "inv__row" },
        el("div", { class: "inv-label" }, el("span", { text: b.name }), el("span", { class: "inv-label__count", text: total !== null ? `${total} / 50` : `${inVault.length} in vault` })),
        grid(cells),
      );
    });
  }

  function grid(children) {
    const g = el("div", { class: "inv__grid" }, ...children);
    g.style.gridTemplateColumns = `${shown().map(() => "var(--cw)").join(" ")} minmax(calc(var(--tile) * 4), 1fr)`;
    return g;
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
      el("div", { class: "inv-side__head" }, el("span", { class: "inv-side__class", text: c.className }), el("span", { class: "inv-side__power" }, el("i", { text: "◆" }), document.createTextNode(String(c.light ?? "")))),
      el("div", { class: "inv-label" }, el("span", { text: "Loadout" })),
      el("div", { class: "inv-side__loadout" }, el("div", { class: "inv-side__col" }, ...equipped("weapons")), el("div", { class: "inv-side__col" }, ...equipped("armor"))),
    );
    if (!d) {
      side.append(el("p", { class: "tab__note", text: "Reading stats…" }));
    } else if (d.error) {
      side.append(el("p", { class: "tab__error", text: d.error }));
    } else {
      side.append(
        el("div", { class: "inv-label" }, el("span", { text: "Stats" })),
        el(
          "div",
          { class: "inv-stats" },
          ...d.stats.map((s) => {
            const fill = el("span", { class: "meter__fill" });
            fill.style.width = `${Math.min(100, (Number(s.value) / 200) * 100)}%`;
            return el(
              "div",
              { class: "inv-stat" },
              s.icon ? el("img", { src: s.icon, alt: "" }) : el("span"),
              el("span", { class: "inv-stat__name", text: s.name }),
              el("span", { class: "inv-stat__value", text: String(s.value) }),
              el("span", { class: "meter inv-stat__bar" }, fill),
            );
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
                  ...set.perks.map((p) =>
                    el(
                      "div",
                      { class: `inv-set__perk${p.active ? " is-active" : ""}` },
                      el("span", { class: "inv-set__need", text: `${p.need}` }),
                      el("span", {}, el("strong", { text: p.name || "Bonus" }), p.description ? el("span", { class: "inv-set__desc", text: p.description }) : null),
                    ),
                  ),
                ),
              ),
            )
          : el("p", { class: "tab__note", text: "No armor set bonuses from the equipped armor." }),
      );
    }
    return side;
  }

  // ---------- Drawing ----------

  function draw() {
    const c = current();
    view.current = c.id;
    root.style.setProperty("--tile", `${SIZES[view.size] ?? 56}px`);
    root.dataset.panel = String(view.panel);

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

    const heads = grid([...shown().map(emblem), vaultCard()]);
    heads.classList.add("inv__heads");
    const money = grid([currencies()]);
    money.firstChild.style.gridColumn = `1 / span ${shown().length}`;

    const main = el("div", { class: "inv-main" }, el("div", { class: "inv-scroll" }, heads, money, ...rows()), view.panel ? panel() : null);
    root.replaceChildren(top, toolbar(), main, toast);
  }

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
    if (fresh) for (const key of Object.keys(details)) delete details[key];
    draw();
    if (!container.contains(root)) container.replaceChildren(root);
  }
  load(false);
}
