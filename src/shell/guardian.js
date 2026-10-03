// The Guardian tab (Destiny 2), like the Companion app's Guardian screen, on the Seasonal Hub's look (sh-* classes):
//
//   [ GUARDIAN · name ..................................................................... refresh ]
//   [ three characters: emblem, class, race, title, power, the emblem's stat tracker ] [ Inventory / Postmaster /
//                                                                                        Armor optimizer        ]
//   [ Journey: Guardian Rank and what's left for the next | commendations | recent seals | Triumphs + score ]
//   [ Collections: Items · Weapon patterns · Lore · Stat trackers · Medals · Exotic catalysts ]
//   [ Recent games ]
//
// d2_guardian (hubs.rs `guardian`), d2_records (the overview: seals, scores, collection roots) and d2_recent (activity
// history) are read together and each part fills in when its answer arrives. Triumphs, the collection pages and the
// armor optimizer open as pages inside this tab (subpages.js); Inventory and Postmaster switch to the Inventory tab.
// "Recently earned seals": Bungie keeps no dates, so MIDA notes when it first sees each title earned (`mida-seals-seen`).

import { subpages } from "./subpages.js";
import { recordsTab } from "./records.js";
import { armorTab } from "./armor.js";
import { wallpaper } from "./wallpaper.js";

const number = (n) => (n == null ? "–" : Number(n).toLocaleString());
const ago = (iso) => {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const m = Math.round(ms / 60000);
  if (m < 60) return `${Math.max(1, m)} min ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d < 30 ? `${d} days ago` : new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};
// Line icons after the Companion app's (where Bungie sends a section's own icon, that's used instead).
const ICONS = {
  inventory: ["M3 12c3-5 15-5 18 0-3 5-15 5-18 0z", "M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z"],
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

export function guardianTab(ctx, container, deps) {
  const { el, svg } = ctx;
  const { loadingView, problemView } = deps;
  const pages = subpages(ctx, container, "Guardian");
  const root = el("div", { class: "tab gd sh" });
  const backdrop = wallpaper(ctx, deps.wallpaper ?? "tab-guardian");
  let g = null; // d2_guardian
  let rec = null; // d2_records overview
  let games = null; // d2_recent
  const errors = {};

  const label = (title, extra) => el("div", { class: "sh-label" }, el("span", { class: "sh-label__text", text: title }), extra == null ? null : el("span", { class: "sh-label__count" }, ...[].concat(extra).map((x) => (x instanceof Node ? x : document.createTextNode(String(x))))));
  const waiting = (key, text) => (errors[key] ? el("p", { class: "tab__error", text: errors[key] }) : el("p", { class: "tab__note", text }));

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

  // Any three of your titles: the ones your characters wear first, then the rest you've earned.
  function titles() {
    const earned = (rec?.seals?.active ?? []).concat(rec?.seals?.legacy ?? []).filter((s) => s.earned);
    const worn = new Set((g?.characters ?? []).map((c) => c.title).filter(Boolean));
    earned.sort((a, b) => Number(worn.has(b.title)) - Number(worn.has(a.title)));
    return earned.slice(0, 3);
  }

  // ---------- Sections ----------

  function characterCard(c) {
    const card = el(
      "div",
      { class: "gd-char" },
      el("span", { class: "gd-char__emblem" }, c.emblem ? el("img", { src: c.emblem, alt: "" }) : null),
      el(
        "div",
        { class: "gd-char__text" },
        el("strong", { class: "gd-char__class", text: c.className }),
        el("span", { class: "gd-char__sub", text: [c.race, c.title].filter(Boolean).join(" · ") }),
      ),
      el("span", { class: "gd-char__light" }, el("i", { text: "✧" }), document.createTextNode(number(c.light))),
      c.tracker
        ? el(
            "div",
            { class: "gd-char__tracker", title: c.tracker.name ?? "Stat tracker" },
            c.tracker.icon ? el("img", { src: c.tracker.icon, alt: "" }) : null,
            el("span", { text: c.tracker.name ?? "Tracker" }),
            el("strong", { text: number(c.tracker.value) }),
          )
        : null,
    );
    if (c.banner) card.style.backgroundImage = `linear-gradient(90deg, rgba(0,0,0,0.15), rgba(0,0,0,0.55)), url("${c.banner}")`;
    return card;
  }

  function shortcut(icon, name, note, onclick, extra = "", image = null) {
    return el(
      "button",
      { class: `gd-short${extra}`, type: "button", onclick },
      el("span", { class: `gd-short__icon${image ? " has-image" : ""}` }, image ? el("img", { src: image, alt: "" }) : svg(ICONS[icon])),
      el("span", { class: "gd-short__text" }, el("strong", { text: name }), note ? el("small", { text: note }) : null),
    );
  }

  function characters() {
    return el(
      "div",
      { class: "gd-top" },
      el("section", { class: "sh-box gd-chars" }, label("Characters", g ? String(g.characters.length) : null), g ? el("div", { class: "gd-char-list" }, ...g.characters.map(characterCard)) : waiting("guardian", "Reading your Guardians…")),
      el(
        "section",
        { class: "sh-box gd-shorts" },
        label("Gear"),
        shortcut("inventory", "Inventory", "Your characters and vault", () => openInventory(false)),
        shortcut("postmaster", "Postmaster", "Lost items waiting", () => openInventory(true)),
        shortcut("armor", "Armor optimizer", "Best builds for your stats", openArmor),
      ),
    );
  }

  // One bar split by commendation category, each in its colour (the app's look).
  function splitBar(nodes) {
    const bar = el("div", { class: "gd-com__split", role: "img", "aria-label": nodes.map((n) => `${n.name} ${n.percent ?? 0}%`).join(", ") });
    for (const n of nodes) {
      const seg = el("span", { title: `${n.name}: ${number(n.score)}` });
      seg.style.flexGrow = String(Math.max(1, Number(n.percent) || Number(n.score) || 1));
      if (n.color) seg.style.background = n.color;
      bar.append(seg);
    }
    return bar;
  }

  function journey() {
    const rank = g?.rank;
    const next = rank?.next;
    const left = next ? next.steps.filter((s) => !s.done) : [];
    const rankBox = el(
      "div",
      { class: "gd-rank" },
      el("div", { class: "gd-sub", text: "Guardian Rank" }),
      rank
        ? el(
            "div",
            { class: "gd-rank__head" },
            // Bungie's own art for the rank when it has one (like the Companion app's badge), else our numbered diamond.
            rank.icon ? el("span", { class: "gd-rank__art" }, el("img", { src: rank.icon, alt: "" }), el("span", { text: String(rank.rank ?? "") })) : el("span", { class: "gd-rank__num", text: String(rank.rank ?? "–") }),
            el("div", {}, el("strong", { text: rank.name || `Rank ${rank.rank}` }), el("small", { text: rank.highest > rank.rank ? `Highest: ${rank.highest}` : "" })),
          )
        : waiting("guardian", "Reading…"),
      next
        ? el(
            "div",
            { class: "gd-rank__next" },
            el("small", { text: `${left.length} of ${next.steps.length} steps left for rank ${next.rank}${next.name ? ` (${next.name})` : ""}` }),
            el("ul", {}, ...left.slice(0, 5).map((s) => el("li", { title: s.description || s.name, text: s.name }))),
            left.length > 5 ? el("small", { text: `and ${left.length - 5} more` }) : null,
          )
        : rank
          ? el("small", { class: "gd-rank__next", text: "Bungie didn't list the next rank's steps." })
          : null,
    );
    const com = g?.commendations;
    const comBox = el(
      "div",
      { class: "gd-com" },
      el("div", { class: "gd-sub", text: "Commendations" }),
      com
        ? el(
            "div",
            {},
            el("div", { class: "gd-com__total" }, svg(ICONS.commend), el("strong", { text: number(com.total) }), el("small", { text: "score" })),
            splitBar(com.nodes),
            ...com.nodes.map((n) => {
              const fill = el("span", { class: "gd-com__fill" });
              fill.style.width = `${Math.max(2, Math.min(100, Number(n.percent) || 0))}%`;
              if (n.color) fill.style.background = n.color;
              return el("div", { class: "gd-com__row" }, el("span", { class: "gd-com__name", text: n.name }), el("span", { class: "gd-com__bar" }, fill), el("span", { class: "gd-com__num", text: `${number(n.score)}${n.percent != null ? ` · ${n.percent}%` : ""}` }));
            }),
          )
        : g
          ? el("p", { class: "tab__note", text: "Bungie isn't sharing commendations for this account." })
          : waiting("guardian", "Reading…"),
    );
    const shown = rec ? titles() : [];
    const sealsBox = el(
      "div",
      { class: "gd-seals" },
      el("div", { class: "gd-sub", text: "Titles" }),
      !rec
        ? waiting("records", "Reading…")
        : shown.length
          ? el(
              "div",
              { class: "gd-seal-list" },
              ...shown.map((s) =>
                el(
                  "button",
                  { class: "gd-seal", type: "button", title: s.name, onclick: () => openRecords(`seal-${s.hash}`, s.name, { node: s.hash }) },
                  el("span", { class: "gd-seal__art" }, s.icon ? el("img", { src: s.icon, alt: "" }) : null),
                  el("strong", { text: s.title || s.name }),
                ),
              ),
            )
          : el("p", { class: "tab__note", text: "No titles earned yet." }),
    );
    return el(
      "section",
      { class: "sh-box gd-journey" },
      label("Journey"),
      el("div", { class: "gd-journey__grid" }, rankBox, comBox, sealsBox),
      shortcut("triumphs", "Triumphs", rec ? `Active score ${number(rec.scores.active)} · Lifetime ${number(rec.scores.lifetime)}` : "Reading…", () => openRecords("triumphs", "Triumphs", { view: "triumphs" }), " gd-short--wide"),
    );
  }

  function collections() {
    const roots = rec?.roots ?? {};
    const cats = rec?.collections?.categories ?? [];
    const owned = cats.reduce((a, c) => a + (c.progress || 0), 0);
    const total = cats.reduce((a, c) => a + (c.goal || 0), 0);
    const info = rec?.rootInfo ?? {};
    const node = (key, name, hash, icon, note) => shortcut(icon, name, hash || key === "patterns" ? note : "Not in Bungie's data", () => (hash || key === "patterns") && openRecords(key, name, key === "items" ? { view: "collections" } : { node: key === "patterns" ? "patterns" : hash, title: name }), hash || key === "patterns" ? "" : " is-off", info[key]?.icon ?? null);
    return el(
      "section",
      { class: "sh-box gd-colls" },
      label("Collections"),
      rec
        ? el(
            "div",
            { class: "gd-coll-grid" },
            node("items", "Items", 1, "items", total ? `${number(owned)} of ${number(total)} collected` : "Weapons, armor, ghosts, ships…"),
            node("patterns", "Shaping Progress", 0, "patterns", "Weapon patterns unlocked"),
            node("lore", "Lore", roots.lore, "lore", "Books and their pages"),
            node("metrics", "Stat Trackers", roots.metrics, "metrics", "Your numbers across the game"),
            node("medals", "Medals", roots.medals, "medals", "Medals you've earned"),
            node("catalysts", "Patterns & Catalysts", roots.catalysts, "catalysts", "Exotic catalysts found and completed"),
          )
        : waiting("records", "Reading…"),
    );
  }

  function recentGames() {
    const classOf = (id) => g?.characters.find((c) => c.id === id)?.className ?? "";
    return el(
      "section",
      { class: "sh-box gd-games" },
      label("Recent games", games ? String(Math.min(12, games.length)) : null),
      !games
        ? waiting("recent", "Reading your activity history…")
        : games.length
          ? el(
              "div",
              { class: "gd-game-list" },
              ...games.slice(0, 12).map((a) => {
                const result = a.pvp ? a.standing || (a.completed ? "Completed" : "Left early") : a.completed ? "Completed" : "Not completed";
                const good = a.pvp ? /victory/i.test(a.standing) : a.completed;
                const row = el(
                  "div",
                  { class: "gd-game" },
                  el("span", { class: "gd-game__art" }, !a.image && a.icon ? el("img", { src: a.icon, alt: "" }) : null),
                  el("div", { class: "gd-game__text" }, el("strong", { text: a.name || "Activity" }), el("small", { text: [a.playlist, classOf(a.character), ago(a.at)].filter(Boolean).join(" · ") })),
                  el("span", { class: `gd-game__result${good ? " is-good" : ""}`, text: result }),
                  el("span", { class: "gd-game__stats", text: `${number(a.kills)} K · ${number(a.deaths)} D · ${number(a.assists)} A` }),
                  el("span", { class: "gd-game__time", text: a.duration }),
                );
                if (a.image) row.querySelector(".gd-game__art").style.backgroundImage = `url("${a.image}")`;
                return row;
              }),
            )
          : el("p", { class: "tab__note", text: "No recent games on record." }),
    );
  }

  // Your currencies (Glimmer, Bright Dust, Silver...) in the title band, as the app shows them.
  function currencies() {
    const list = (g?.currencies ?? []).filter((c) => c.quantity != null).slice(0, 4);
    if (!list.length) return null;
    return el("div", { class: "gd-wallet" }, ...list.map((c) => el("span", { class: "gd-wallet__item", title: c.name }, c.icon ? el("img", { src: c.icon, alt: "" }) : null, el("span", { text: number(c.quantity) }))));
  }

  // ---------- The tab ----------

  function draw() {
    const top = el(
      "header",
      { class: "sh-top" },
      el("div", { class: "sh-top__text" }, el("span", { class: "sh-top__kicker", text: "Guardian" }), el("h1", { class: "sh-top__title", text: ctx.state.account?.name?.replace(/#\d+$/, "") || "Guardian" })),
      el("div", { class: "sh-top__tools" }, currencies(), el("button", { class: "btn btn--small", type: "button", text: "Refresh", onclick: () => start(true) })),
    );
    const scroll = root.querySelector(".sh-body")?.scrollTop ?? 0;
    const body = el("div", { class: "sh-body" }, el("div", { class: "sh-main" }, characters(), journey(), collections(), recentGames()));
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
