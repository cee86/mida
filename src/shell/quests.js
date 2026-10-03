// The Quests tab (Destiny 2), laid out like the game's Quests screen and styled like the Inventory
// and Seasonal Hub (title band, darkened backdrop, letterspaced labels over a rule, bracketed
// boxes; the sh-* classes come from seasonal.css):
//
//   [ QUESTS · n picked up ................................ character · sort · refresh ]
//   [ icons ] [ quest tiles, in step order ] [ chosen quest: line, step, objectives,  ] [ bounties ]
//   [  by   ] [                            ] [ rewards                                ] [          ]
//   [ type  ]
//
// The icons on the left filter by the categories the game uses (exotic, seasonal, campaigns,
// playlists, New Light, past, other), read from each quest's trait ids (enrich_quests in bungie.rs)
// or, failing that, its type name. Bounties sit in the column on the right.

import { wallpaper } from "./wallpaper.js";
const CATEGORY_KEY = "mida-quest-category";
const SORT_KEY = "mida-quest-sort";
const read = (key, fallback) => {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
};
const write = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Only a convenience.
  }
};

const CATEGORIES = [
  ["all", "All quests", ["M12 3l3 3-3 3-3-3zM6 9l3 3-3 3-3-3zM18 9l3 3-3 3-3-3zM12 15l3 3-3 3-3-3z"]],
  ["exotic", "Exotic", ["M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z", "M12 8l3.5 2v4L12 16l-3.5-2v-4z"]],
  ["seasonal", "Seasonal", ["M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z", "M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"]],
  ["expansion", "Campaigns", ["M12 6c-2-1.5-5-2-8-1.5V19c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5V4.5c-3-.5-6 0-8 1.5z", "M12 6v14.5"]],
  ["playlists", "Playlists", ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z", "M12 11.5v1"]],
  ["newlight", "New Light", ["M12 3l2.2 6.8H21l-5.5 4 2.1 6.7L12 16.4 6.4 20.5l2.1-6.7L3 9.8h6.8z"]],
  ["past", "Past", ["M3 12a9 9 0 1 0 3-6.7", "M3 4v4h4", "M12 7v5l3 2"]],
  ["other", "Other", ["M4 12a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0zM10.5 12a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0zM17 12a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0z"]],
];
const SORTS = [
  ["game", "Game order"],
  ["progress", "Most progress"],
  ["ready", "Ready to turn in first"],
  ["expiring", "Ending soonest"],
  ["name", "Name"],
];
const TIER_NAMES = { 6: "Exotic", 5: "Legendary", 4: "Rare", 3: "Uncommon", 2: "Common" };
const clean = (text) => String(text ?? "").replace(/\[[^\]]*\]\s*/g, "").trim();
const percent = (o) => (o.goal > 0 ? Math.min(100, Math.round((o.progress / o.goal) * 100)) : o.complete ? 100 : 0);

// Destiny 2's expansions, newest first, for the DLC buttons under the types. A quest belongs to one when its trait
// ids, quest line, name or text name it (Bungie has no expansion field on quests). Short = the button's letters.
const DLCS = [
  ["renegades", "Renegades", "RG", /renegades/],
  ["edge-of-fate", "The Edge of Fate", "EF", /edge of fate|edge_of_fate|edgeoffate/],
  ["final-shape", "The Final Shape", "FS", /final shape|final_shape|finalshape/],
  ["lightfall", "Lightfall", "LF", /lightfall/],
  ["witch-queen", "The Witch Queen", "WQ", /witch queen|witch_queen|witchqueen/],
  ["beyond-light", "Beyond Light", "BL", /beyond light|beyond_light|beyondlight/],
  ["shadowkeep", "Shadowkeep", "SK", /shadowkeep/],
  ["forsaken", "Forsaken", "FK", /forsaken/],
  ["warmind", "Warmind", "WM", /warmind/],
  ["osiris", "Curse of Osiris", "CO", /curse of osiris|osiris/],
  ["red-war", "The Red War", "RW", /red war|red_war|redwar/],
];
function dlcOf(q) {
  const text = [...(q.traits ?? []), q.questLine, q.name, q.typeName, q.description, q.questLineDescription].filter(Boolean).join(" ").toLowerCase();
  return DLCS.find(([, , , pattern]) => pattern.test(text))?.[0] ?? null;
}

// Bungie's category when the trait ids are missing (an older cache, or a definition that didn't load).
function categoryOf(q) {
  if (q.category) return q.category;
  const kind = `${q.typeName} ${q.name}`.toLowerCase();
  if (q.tier === 6 || kind.includes("exotic")) return "exotic";
  if (/season|episode/.test(kind)) return "seasonal";
  if (/campaign|expansion/.test(kind)) return "expansion";
  if (/vanguard|crucible|gambit|strike|nightfall|trials|iron banner/.test(kind)) return "playlists";
  return "other";
}
// How far along a quest is: its objectives on this step, plus the step itself when known.
function questPercent(q) {
  const objs = q.objectives ?? [];
  const step = objs.length ? objs.reduce((sum, o) => sum + percent(o), 0) / objs.length : q.complete ? 100 : 0;
  return Math.round(step);
}

export function questsTab(ctx, container, { read: readData, loadingView, problemView, until, characterPicker, lastCharacter, wallpaper: wall = "tab-director" }) {
  const { el, svg } = ctx;
  const root = el("div", { class: "tab qs sh" });
  const backdrop = wallpaper(ctx, wall);
  const tip = el("div", { class: "sh-tip", role: "tooltip", hidden: true });
  let data = null;
  let category = read(CATEGORY_KEY, "all");
  let sort = read(SORT_KEY, "game");
  let picked = null; // the chosen quest's id

  const chosen = () => (data.characters.some((c) => c.id === lastCharacter.quests) ? lastCharacter.quests : data.characters[0]?.id);
  const label = (title, extra) => el("div", { class: "sh-label" }, el("span", { class: "sh-label__text", text: title }), extra != null ? el("span", { class: "sh-label__count" }, ...[].concat(extra)) : null);
  function meter(pct) {
    const fill = el("span");
    fill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
    return el("span", { class: "sh-meter", role: "progressbar", "aria-valuenow": String(pct), "aria-valuemin": "0", "aria-valuemax": "100" }, fill);
  }

  // ---------- Reward tiles and their cards ----------

  function rewardTile(w) {
    const node = el(
      "span",
      { class: `sh-tile sh-tile--t${w.tier ?? 0}`, tabindex: "0", "aria-label": w.name },
      w.icon ? el("img", { src: w.icon, alt: "", loading: "lazy" }) : null,
      w.quantity > 1 ? el("span", { class: "sh-tile__qty", text: Number(w.quantity).toLocaleString() }) : null,
    );
    const show = () => {
      tip.className = `sh-tip sh-tip--t${w.tier ?? 0}`;
      tip.replaceChildren(
        el("div", { class: "sh-tip__head" }, el("strong", { text: w.name || "Reward" }), el("span", { text: [w.typeName, TIER_NAMES[w.tier]].filter(Boolean).join(" · ") })),
        el("div", { class: "sh-tip__body" }, w.quantity > 1 ? el("div", { class: "sh-tip__qty", text: `×${Number(w.quantity).toLocaleString()}` }) : null, w.description ? el("p", { text: w.description }) : null),
      );
      tip.hidden = false;
      const box = root.getBoundingClientRect();
      const a = node.getBoundingClientRect();
      let left = a.right - box.left + 8;
      if (left + tip.offsetWidth > box.width - 8) left = a.left - box.left - tip.offsetWidth - 8;
      let top = a.top - box.top;
      if (top + tip.offsetHeight > box.height - 8) top = box.height - tip.offsetHeight - 8;
      tip.style.left = `${Math.max(8, left)}px`;
      tip.style.top = `${Math.max(8, top)}px`;
    };
    const hide = () => (tip.hidden = true);
    node.addEventListener("pointerenter", show);
    node.addEventListener("focus", show);
    node.addEventListener("pointerleave", hide);
    node.addEventListener("blur", hide);
    return node;
  }

  function objectives(list) {
    return el(
      "div",
      { class: "qs-objs" },
      ...list.map((o) =>
        el(
          "div",
          { class: `qs-obj${o.complete ? " is-done" : ""}` },
          el("span", { class: "qs-obj__box", "aria-hidden": "true" }),
          el("span", { class: "qs-obj__text", text: clean(o.text) || "Progress" }),
          el("span", { class: "qs-obj__count", text: o.goal > 1 ? `${Number(o.progress).toLocaleString()} / ${Number(o.goal).toLocaleString()}` : o.complete ? "Done" : "" }),
          o.goal > 1 ? meter(percent(o)) : null,
        ),
      ),
    );
  }

  // ---------- Quest tiles (the game's grid of square icons) ----------

  function tile(q) {
    const pct = questPercent(q);
    const node = el(
      "button",
      {
        class: `qs-tile qs-tile--t${q.tier ?? 0}${q.complete ? " is-done" : ""}${picked === q.id ? " is-picked" : ""}`,
        type: "button",
        "aria-pressed": String(picked === q.id),
        title: q.questLine ? `${q.questLine}: ${q.name}` : q.name,
        onclick: () => ((picked = q.id), draw()),
      },
      el("span", { class: "qs-tile__art" }, q.icon ? el("img", { src: q.icon, alt: "", loading: "lazy" }) : null, q.complete ? el("span", { class: "qs-tile__ready", text: "✓" }) : null),
      el(
        "span",
        { class: "qs-tile__text" },
        el("span", { class: "qs-tile__line", text: q.questLine || q.typeName || "Quest" }),
        el("span", { class: "qs-tile__name", text: q.name }),
        el("span", { class: "qs-tile__meta" }, q.step && q.steps > 1 ? el("span", { text: `Step ${q.step} of ${q.steps}` }) : el("span", { text: q.complete ? "Ready to turn in" : `${pct}%` }), q.expires ? until(ctx, q.expires, " left") : null),
        meter(pct),
      ),
    );
    return node;
  }

  function detail(q) {
    if (!q) return el("section", { class: "sh-box qs-detail is-empty" }, label("Quest"), el("p", { class: "tab__note", text: "Pick a quest to see its steps, objectives and rewards." }));
    const head = el("div", { class: "qs-detail__hero" });
    if (q.screenshot) {
      head.style.backgroundImage = `linear-gradient(180deg, rgba(0,0,0,0.1), rgba(0,0,0,0.75)), url("${q.screenshot}")`;
      head.classList.add("has-art");
    }
    head.append(
      el("span", { class: "qs-detail__icon" }, q.icon ? el("img", { src: q.icon, alt: "", loading: "lazy" }) : null),
      el(
        "div",
        { class: "qs-detail__titles" },
        el("span", { class: "qs-detail__line", text: q.questLine || q.typeName || "Quest" }),
        el("h2", { class: "qs-detail__name", text: q.name }),
        el("span", { class: "qs-detail__type", text: [q.typeName, TIER_NAMES[q.tier]].filter((t, i, a) => t && a.indexOf(t) === i).join(" · ") }),
      ),
    );
    const steps = q.steps > 1 && q.step
      ? el(
          "div",
          { class: "qs-steps", "aria-label": `Step ${q.step} of ${q.steps}` },
          ...Array.from({ length: Math.min(q.steps, 40) }, (_, i) => el("span", { class: i + 1 < q.step ? "is-done" : i + 1 === q.step ? "is-now" : "" })),
          el("span", { class: "qs-steps__text", text: `Step ${q.step} of ${q.steps}` }),
        )
      : null;
    return el(
      "section",
      { class: `sh-box qs-detail qs-detail--t${q.tier ?? 0}` },
      head,
      steps,
      q.description ? el("p", { class: "qs-detail__desc", text: clean(q.description) }) : null,
      ...(q.objectives?.length ? [label("Objectives"), objectives(q.objectives)] : []),
      ...(q.rewards?.length ? [label("Rewards"), el("div", { class: "qs-rewards" }, ...q.rewards.map(rewardTile))] : []),
      q.questLineDescription && q.questLineDescription !== q.description ? el("details", { class: "qs-lore" }, el("summary", { text: "About this quest line" }), el("p", { text: clean(q.questLineDescription) })) : null,
      el(
        "div",
        { class: "qs-detail__foot" },
        q.expires ? el("span", { class: "qs-detail__ends" }, el("span", { text: "Ends in " }), until(ctx, q.expires, "")) : null,
        q.complete ? el("span", { class: "qs-detail__ready", text: "Complete: turn it in in game." }) : null,
      ),
    );
  }

  // ---------- Bounties ----------

  function bounties() {
    const list = data.bounties[chosen()] ?? [];
    const ready = list.filter((b) => b.complete).length;
    return el(
      "aside",
      { class: "sh-side qs-side" },
      label("Bounties", ready ? `${ready} ready · ${list.length}` : `${list.length}`),
      list.length
        ? el(
            "div",
            { class: "sh-bounties" },
            ...[...list]
              .sort((a, b) => Number(b.complete) - Number(a.complete))
              .map((b) =>
                el(
                  "div",
                  { class: `sh-bounty${b.complete ? " is-done" : ""}`, title: clean(b.description) || b.name },
                  el("span", { class: "sh-order__icon sh-bounty__icon" }, b.icon ? el("img", { src: b.icon, alt: "", loading: "lazy" }) : null),
                  el(
                    "div",
                    { class: "sh-bounty__text" },
                    el("div", { class: "sh-bounty__name" }, el("span", { text: b.name }), b.complete ? el("span", { class: "sh-card__done", text: "✓" }) : null),
                    ...(b.objectives ?? []).slice(0, 3).map((o) => el("div", { class: "sh-bounty__obj" }, el("span", { text: clean(o.text) || "Progress" }), el("span", { text: o.goal > 1 ? `${o.progress}/${o.goal}` : `${percent(o)}%` }), meter(percent(o)))),
                    b.expires ? el("div", { class: "sh-bounty__ends" }, el("span", { text: "Ends in " }), until(ctx, b.expires, "")) : null,
                  ),
                ),
              ),
          )
        : el("p", { class: "tab__note", text: "No bounties on this character." }),
    );
  }

  // ---------- Drawing ----------

  function sorted(list) {
    const out = [...list];
    if (sort === "progress") out.sort((a, b) => questPercent(b) - questPercent(a));
    if (sort === "ready") out.sort((a, b) => Number(b.complete) - Number(a.complete));
    if (sort === "expiring") out.sort((a, b) => (a.expires ? Date.parse(a.expires) : Infinity) - (b.expires ? Date.parse(b.expires) : Infinity));
    if (sort === "name") out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }

  function draw() {
    tip.hidden = true;
    const all = data.quests[chosen()] ?? [];
    // `category` is a type id ("exotic") or an expansion ("dlc:lightfall").
    const matches = (id, q) => (id === "all" ? true : id.startsWith("dlc:") ? dlcOf(q) === id.slice(4) : categoryOf(q) === id);
    const counts = {};
    for (const [id] of CATEGORIES) counts[id] = all.filter((q) => matches(id, q)).length;
    for (const [id] of DLCS) counts[`dlc:${id}`] = all.filter((q) => matches(`dlc:${id}`, q)).length;
    if (category !== "all" && !counts[category]) category = "all";
    const shown = sorted(all.filter((q) => matches(category, q)));
    if (!shown.some((q) => q.id === picked)) picked = shown[0]?.id ?? null;
    const button = (id, name, face) =>
      el(
        "button",
        { class: "qs-nav__item", type: "button", "aria-label": `${name} (${counts[id]})`, "aria-current": String(category === id), onclick: () => ((category = id), write(CATEGORY_KEY, id), draw()) },
        face,
        el("span", { class: "qs-nav__name", text: name }),
        el("span", { class: "qs-nav__count", text: String(counts[id]) }),
      );
    const dlcs = DLCS.filter(([id]) => counts[`dlc:${id}`]);
    const nav = el(
      "nav",
      { class: "qs-nav", "aria-label": "Quest types" },
      ...CATEGORIES.filter(([id]) => id === "all" || counts[id]).map(([id, name, icon]) => button(id, name, svg(icon))),
      dlcs.length ? el("span", { class: "qs-nav__rule", "aria-hidden": "true" }) : null,
      ...dlcs.map(([id, name, short]) => button(`dlc:${id}`, name, el("span", { class: "qs-nav__dlc", "aria-hidden": "true", text: short }))),
    );
    const name = category.startsWith("dlc:") ? DLCS.find(([id]) => `dlc:${id}` === category)?.[1] : CATEGORIES.find(([id]) => id === category)?.[1] ?? "All quests";
    const ready = shown.filter((q) => q.complete).length;
    const main = el(
      "div",
      { class: "qs-main" },
      el(
        "section",
        { class: "qs-list" },
        label(name, ready ? `${ready} ready · ${shown.length}` : `${shown.length}`),
        shown.length ? el("div", { class: "qs-tiles" }, ...shown.map(tile)) : el("p", { class: "tab__note", text: "No quests on this character." }),
      ),
      detail(shown.find((q) => q.id === picked)),
    );
    const sortPick = el(
      "select",
      { class: "select qs-sort", "aria-label": "Sort quests", onchange: (event) => ((sort = event.target.value), write(SORT_KEY, sort), draw()) },
      ...SORTS.map(([id, text]) => el("option", { value: id, selected: sort === id || null, text })),
    );
    const top = el(
      "header",
      { class: "sh-top" },
      el("div", { class: "sh-top__text" }, el("span", { class: "sh-top__kicker", text: `${all.length} picked up · ${ctx.state.account?.name ?? ""}` }), el("h1", { class: "sh-top__title", text: "Quests" })),
      el(
        "div",
        { class: "sh-top__tools" },
        characterPicker(ctx, data.characters, chosen(), (id) => {
          lastCharacter.quests = id;
          picked = null;
          draw();
        }),
        sortPick,
        el("button", { class: "btn btn--small", type: "button", text: "Refresh", onclick: () => load(true) }),
      ),
    );
    const scroll = root.querySelector(".sh-body")?.scrollTop ?? 0;
    const scroller = el("div", { class: "sh-body" }, el("div", { class: "qs-layout" }, nav, main, bounties()));
    root.replaceChildren(backdrop, top, scroller, tip);
    scroller.scrollTop = scroll;
  }

  async function load(fresh) {
    container.replaceChildren(loadingView(ctx, "Reading your quests from Bungie…", "activity"));
    const result = await readData(ctx, "activity", fresh);
    if (!result?.ok) return container.replaceChildren(problemView(ctx, result?.error ?? "Something went wrong.", () => load(true)));
    data = result.data;
    draw();
    container.replaceChildren(root);
  }
  load(false);
}
