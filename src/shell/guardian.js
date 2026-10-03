// The Guardian tab (Destiny 2), laid out like the Companion app's Guardian screen (owner's screenshots, 3 Oct 2026):
//
//   currencies (Glimmer, Bright Dust, Silver...)
//   [ each character as its emblem's nameplate: class, race, power; the emblem's stat tracker ]
//   [ Vault ] [ Postmaster ] [ Armor optimizer ]
//   JOURNEY      [ Guardian Rank badge, name, highest ] [ commendations: score + one bar split by category; titles;
//                                                        Triumphs score ]
//   COLLECTIONS  two tiles across: Items, Shaping Progress, Lore, Stat Trackers, Medals, Patterns & Catalysts
//   RECENT GAMES the chosen character's latest activities, two cards across
//
// d2_guardian (hubs.rs `guardian`), d2_records (the overview: seals, scores, collection pages' names and icons) and
// d2_recent (activity history per character) are read together; each part fills in as its answer arrives. Triumphs,
// the collection pages and the Armor optimizer open as pages inside this tab (subpages.js); Vault and Postmaster
// switch to the Inventory tab.

import { subpages } from "./subpages.js";
import { recordsTab } from "./records.js";
import { armorTab } from "./armor.js";
import { wallpaper } from "./wallpaper.js";

const number = (n) => (n == null ? "–" : Number(n).toLocaleString());
const when = (iso) => {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const h = ms / 3600e3;
  if (h < 1) return `${Math.max(1, Math.round(ms / 60000))}m ago`;
  if (h < 24) return `${Math.round(h)}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};
// Line icons (ours) for the buttons and the collection tiles Bungie gives no icon for.
const ICONS = {
  vault: ["M3 12c3-5 15-5 18 0-3 5-15 5-18 0z", "M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z"],
  postmaster: ["M4 5h16v14H4z", "M8 9h3v3H8zM13 9h3v3h-3zM8 14h3v3H8zM13 14h3v3h-3z"],
  armor: ["M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6z", "M8.5 13h2l1-3 2 6 1-3h1"],
  items: ["M4 5h4v4H4zM10 5h4v4h-4zM16 5h4v4h-4zM4 11h4v4H4zM10 11h4v4h-4zM16 11h4v4h-4z"],
  patterns: ["M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z", "M10 7h4M7 10v4M17 10v4M10 17h4"],
  lore: ["M4 5h16v14H4z", "M12 8l2 4-2 4-2-4z", "M4 5l8 4 8-4"],
  metrics: ["M12 3l7 3v6c0 4-3 7.5-7 9-4-1.5-7-5-7-9V6z", "M8 9l8 8M10 8l6 6M8 12l4 4"],
  medals: ["M6 4h12v5l-6 4-6-4z", "M9 15l3 5 3-5", "M9 7l6 3M15 7l-6 3"],
  catalysts: ["M9 3h6v3l2 2v9a4 4 0 0 1-4 4h-2a4 4 0 0 1-4-4V8l2-2z", "M12 10v7"],
  triumphs: ["M7 4h10v4l-5 3-5-3z", "M12 11v5M8 20h8M10 16h4"],
  commend: ["M12 3l2.4 5 5.6.8-4 3.9 1 5.5L12 15.6 7 18.2l1-5.5-4-3.9 5.6-.8z"],
};
const COLLECTIONS = [
  ["items", "Items"],
  ["patterns", "Shaping Progress"],
  ["lore", "Lore"],
  ["metrics", "Stat Trackers"],
  ["medals", "Medals"],
  ["catalysts", "Patterns & Catalysts"],
];

export function guardianTab(ctx, container, deps) {
  const { el, svg } = ctx;
  const { loadingView, problemView } = deps;
  const pages = subpages(ctx, container, "Guardian");
  const root = el("div", { class: "tab gd sh" });
  const backdrop = wallpaper(ctx, deps.wallpaper ?? "tab-guardian");
  let g = null; // d2_guardian
  let rec = null; // d2_records overview
  let games = null; // d2_recent
  let gamesOf = null; // the character whose recent games show
  const errors = {};
  const waiting = (key, text) => (errors[key] ? el("p", { class: "tab__error", text: errors[key] }) : el("p", { class: "tab__note", text }));
  const heading = (text, extra) => el("h2", { class: "gd-head" }, el("span", { text }), extra ?? null);

  // ---------- Opening pages ----------

  const openRecords = (key, title, start) => pages.show(key, title, (host) => recordsTab(ctx, host, { loadingView, problemView, start, wallpaper: deps.wallpaper }));
  const openArmor = () => pages.show("armor", "Armor optimizer", (host) => armorTab(ctx, host, deps));
  const openInventory = (postmaster) => {
    if (postmaster) {
      window.midaOpenPostmaster = true;
      window.dispatchEvent(new CustomEvent("mida-open-postmaster"));
    }
    ctx.hub.select("tab-inventory");
  };

  // ---------- Sections ----------

  function currencies() {
    const list = (g?.currencies ?? []).filter((c) => c.quantity != null).slice(0, 4);
    if (!list.length) return null;
    return el("div", { class: "gd-wallet" }, ...list.map((c) => el("span", { class: "gd-wallet__item", title: c.name }, c.icon ? el("img", { src: c.icon, alt: "" }) : null, el("span", { text: number(c.quantity) }))));
  }

  function nameplate(c) {
    const card = el(
      "div",
      { class: "gd-plate" },
      el("span", { class: "gd-plate__emblem" }, c.emblem ? el("img", { src: c.emblem, alt: "" }) : null),
      el("span", { class: "gd-plate__text" }, el("strong", { class: "gd-plate__class", text: c.className }), el("span", { class: "gd-plate__race", text: c.race || "" })),
      el("span", { class: "gd-plate__light" }, el("i", { text: "✧" }), document.createTextNode(number(c.light))),
      c.tracker ? el("span", { class: "gd-plate__tracker", title: c.tracker.name ?? "" }, el("span", { class: "gd-plate__tracker-name", text: c.tracker.name ?? "" }), el("strong", { text: number(c.tracker.value) })) : null,
    );
    if (c.banner) card.style.backgroundImage = `url("${c.banner}")`;
    return card;
  }

  function characters() {
    return el(
      "div",
      { class: "gd-chars" },
      g ? el("div", { class: "gd-plates" }, ...g.characters.map(nameplate)) : waiting("guardian", "Reading your Guardians…"),
      el(
        "div",
        { class: "gd-buttons" },
        button("vault", "Vault", () => openInventory(false)),
        button("postmaster", "Postmaster", () => openInventory(true)),
        button("armor", "Armor optimizer", openArmor),
      ),
    );
  }

  function button(icon, text, onclick) {
    return el("button", { class: "gd-btn", type: "button", onclick }, el("span", { class: "gd-btn__icon" }, svg(ICONS[icon])), el("span", { text }));
  }

  // Any three of your titles: the ones your characters wear first, then the rest you've earned.
  function titles() {
    const earned = (rec?.seals?.active ?? []).concat(rec?.seals?.legacy ?? []).filter((s) => s.earned);
    const worn = new Set((g?.characters ?? []).map((c) => c.title).filter(Boolean));
    earned.sort((a, b) => Number(worn.has(b.title)) - Number(worn.has(a.title)));
    return earned.slice(0, 3);
  }

  function journey() {
    const rank = g?.rank;
    const com = g?.commendations;
    const badge = el(
      "div",
      { class: "gd-rank" },
      el("div", { class: "gd-label", text: "Guardian Rank" }),
      rank
        ? el(
            "div",
            { class: "gd-rank__badge" },
            rank.icon ? el("img", { class: "gd-rank__art", src: rank.icon, alt: "" }) : null,
            el("span", { class: "gd-rank__num", text: String(rank.rank ?? "–") }),
          )
        : waiting("guardian", "Reading…"),
      rank ? el("strong", { class: "gd-rank__name", text: (rank.name || `Rank ${rank.rank}`).toUpperCase() }) : null,
      rank?.next ? el("small", { class: "gd-rank__next", title: rank.next.steps.filter((s) => !s.done).map((s) => s.name).join("\n"), text: `${rank.next.steps.filter((s) => !s.done).length} of ${rank.next.steps.length} steps to rank ${rank.next.rank}` }) : null,
      rank ? el("div", { class: "gd-rank__foot" }, el("span", { text: "Highest Rank" }), el("strong", { text: String(rank.highest ?? rank.rank) })) : null,
    );
    // Commendations: the score, then one bar split by category in each one's colour.
    const segments = el("div", { class: "gd-com__bar", role: "img", "aria-label": (com?.nodes ?? []).map((n) => `${n.name} ${n.percent ?? 0}%`).join(", ") });
    for (const n of com?.nodes ?? []) {
      const seg = el("span", { class: "gd-com__seg", title: `${n.name}: ${number(n.score)}${n.percent != null ? ` (${n.percent}%)` : ""}` });
      seg.style.flexGrow = String(Math.max(1, Number(n.percent) || Number(n.score) || 1));
      if (n.color) seg.style.background = n.color;
      segments.append(seg);
    }
    const shown = rec ? titles() : [];
    const right = el(
      "div",
      { class: "gd-journey__right" },
      el("div", { class: "gd-label", text: "Commendations" }),
      com
        ? el("div", { class: "gd-com" }, el("div", { class: "gd-com__total" }, svg(ICONS.commend), el("strong", { text: number(com.total) })), segments, el("div", { class: "gd-com__legend" }, ...com.nodes.map((n) => el("span", {}, el("i", { class: "gd-com__dot" }), document.createTextNode(` ${n.name} ${number(n.score)}`)))))
        : g
          ? el("p", { class: "tab__note", text: "Bungie isn't sharing commendations for this account." })
          : waiting("guardian", "Reading…"),
      el("div", { class: "gd-label", text: "Titles" }),
      !rec
        ? waiting("records", "Reading…")
        : shown.length
          ? el(
              "div",
              { class: "gd-titles" },
              ...shown.map((s) =>
                el(
                  "button",
                  { class: "gd-title", type: "button", title: `${s.title || s.name} · ${s.name}`, onclick: () => openRecords(`seal-${s.hash}`, s.name, { node: s.hash }) },
                  s.icon ? el("img", { src: s.icon, alt: s.title || s.name }) : el("span", { text: s.title || s.name }),
                ),
              ),
            )
          : el("p", { class: "tab__note", text: "No titles earned yet." }),
    );
    // Colour the legend dots to match the bar.
    right.querySelectorAll(".gd-com__dot").forEach((dot, i) => {
      const c = com?.nodes?.[i]?.color;
      if (c) dot.style.background = c;
    });
    return el(
      "section",
      { class: "gd-journey" },
      el("div", { class: "gd-journey__grid" }, badge, right),
      el(
        "button",
        { class: "gd-journey__triumphs", type: "button", onclick: () => openRecords("triumphs", "Triumphs", { view: "triumphs" }) },
        el("span", { text: "Triumphs" }),
        svg(ICONS.triumphs),
        el("strong", { text: rec ? number(rec.scores.active) : "…" }),
        el("span", { class: "gd-journey__go", text: "›" }),
      ),
    );
  }

  function collections() {
    const roots = rec?.roots ?? {};
    const info = rec?.rootInfo ?? {};
    const target = (key) => (key === "items" ? { view: "collections" } : key === "patterns" ? { node: "patterns" } : roots[key] ? { node: roots[key] } : null);
    return el(
      "div",
      { class: "gd-colls" },
      ...COLLECTIONS.map(([key, name]) => {
        const start = rec ? target(key) : null;
        const icon = info[key]?.icon;
        return el(
          "button",
          { class: `gd-coll${rec && !start ? " is-off" : ""}`, type: "button", disabled: rec && !start ? true : null, title: rec && !start ? "Not in Bungie's data" : name, onclick: () => start && openRecords(key, name, { ...start, title: name }) },
          el("span", { class: "gd-coll__icon" }, icon ? el("img", { src: icon, alt: "" }) : svg(ICONS[key])),
          el("span", { class: "gd-coll__name", text: name }),
        );
      }),
    );
  }

  function recentGames() {
    const chars = g?.characters ?? [];
    if (!gamesOf || !chars.some((c) => c.id === gamesOf)) gamesOf = chars[0]?.id ?? null;
    const c = chars.find((x) => x.id === gamesOf);
    const list = (games ?? []).filter((a) => a.character === gamesOf).slice(0, 10);
    const picker = c
      ? el(
          "label",
          { class: "gd-picker" },
          el("span", { class: "gd-picker__emblem" }, c.emblem ? el("img", { src: c.emblem, alt: "" }) : null),
          el("strong", { text: c.className }),
          el("span", { class: "gd-picker__light", text: `✧${number(c.light)}` }),
          chars.length > 1 ? el("span", { class: "gd-picker__caret", "aria-hidden": "true", text: "▾" }) : null,
          chars.length > 1
            ? el(
                "select",
                { class: "gd-picker__select", "aria-label": "Character", onchange: (e) => ((gamesOf = e.target.value), draw()) },
                ...chars.map((x) => el("option", { value: x.id, selected: x.id === gamesOf || null, text: `${x.className} · ${number(x.light)}` })),
              )
            : null,
        )
      : null;
    return el(
      "div",
      { class: "gd-games" },
      picker,
      !games
        ? waiting("recent", "Reading your activity history…")
        : list.length
          ? el(
              "div",
              { class: "gd-game-grid" },
              ...list.map((a) => {
                const result = a.pvp ? a.standing : a.completed ? "" : "Not completed";
                const card = el(
                  "div",
                  { class: "gd-game", title: `${a.name}${a.playlist ? ` · ${a.playlist}` : ""}\n${number(a.kills)} kills · ${number(a.deaths)} deaths · ${number(a.assists)} assists${a.duration ? ` · ${a.duration}` : ""}` },
                  el("span", { class: "gd-game__icon" }, a.icon ? el("img", { src: a.icon, alt: "" }) : null),
                  el("span", { class: "gd-game__text" }, el("strong", { text: a.name || "Activity" }), a.playlist ? el("span", { class: "gd-game__sub", text: a.playlist }) : null),
                  el("span", { class: "gd-game__foot" }, result ? el("span", { class: `gd-game__result${/victory/i.test(result) ? " is-good" : ""}`, text: result }) : el("span"), el("span", { text: when(a.at) })),
                );
                if (a.image) card.style.backgroundImage = `linear-gradient(90deg, rgba(10,12,16,0.92), rgba(10,12,16,0.6)), url("${a.image}")`;
                return card;
              }),
            )
          : el("p", { class: "tab__note", text: "No recent games on record for this character." }),
    );
  }

  // ---------- The tab ----------

  function draw() {
    const top = el(
      "header",
      { class: "sh-top" },
      el("div", { class: "sh-top__text" }, el("span", { class: "sh-top__kicker", text: ctx.state.account?.name ?? "" }), el("h1", { class: "sh-top__title", text: "Guardian" })),
      el("div", { class: "sh-top__tools" }, currencies(), el("button", { class: "btn btn--small", type: "button", text: "Refresh", onclick: () => start(true) })),
    );
    const scroll = root.querySelector(".sh-body")?.scrollTop ?? 0;
    const body = el(
      "div",
      { class: "sh-body" },
      el("div", { class: "sh-main gd-main" }, characters(), heading("Journey"), journey(), heading("Collections"), collections(), heading("Recent games"), recentGames()),
    );
    root.replaceChildren(backdrop, top, body);
    body.scrollTop = scroll;
  }

  function start(fresh) {
    if (fresh) {
      g = rec = games = null;
      for (const k of Object.keys(errors)) delete errors[k];
    }
    draw();
    pages.setHome(root);
    const done = (key, set) => (r) => {
      if (r?.ok) set(r.data);
      else errors[key] = r?.error ?? "Something went wrong.";
      draw();
    };
    ctx.hub.d2Guardian().then(done("guardian", (d) => (g = d)));
    ctx.hub.d2Records(null, fresh).then(done("records", (d) => (rec = d)));
    ctx.hub.d2Recent().then(done("recent", (d) => (games = d)));
  }
  start(false);
}
