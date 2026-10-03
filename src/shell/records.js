// The Triumphs tab (Destiny 2): seals, triumphs and collections, laid out like seals.report and the game's own
// screens, on the Seasonal Hub's look (sh-* classes from seasonal.css):
//
//   [ TRIUMPHS · active score / lifetime ..................... TRIUMPHS | SEALS | COLLECTIONS · refresh ]
//   Seals:        shields in a grid (earned glow gold), legacy titles in a smaller grey row
//   Triumphs:     round medallions with a progress ring, legacy categories after
//   Collections:  item category tiles (owned / total) | badges
//   A seal:       the seal panel on the left (art, title, progress), its triumphs as tiles on the right
//   A category:   its sections down the left, its triumphs or items in the middle
//
// Everything comes from d2_records (records.rs): the overview, or one node at a time (kept here once read).

import { wallpaper } from "./wallpaper.js";
const VIEWS = [
  ["seals", "Seals"],
  ["triumphs", "Triumphs"],
  ["collections", "Collections"],
];
const number = (n) => (n == null ? "–" : Number(n).toLocaleString());
const pct = (p, g) => (g > 0 ? Math.min(100, Math.round((p / g) * 100)) : 0);

// `start`: open at a view ({ view: "triumphs" }) or at one node ({ node: hash | "patterns" }); a node start hides the
// Seals | Triumphs | Collections switch and its crumbs begin at that node (the Guardian tab's collection pages).
export function recordsTab(ctx, container, { loadingView, problemView, start: startAt = null, wallpaper: wall = "tab-guardian" }) {
  const { el, svg } = ctx;
  const root = el("div", { class: "tab rc sh" });
  const backdrop = wallpaper(ctx, wall);
  let home = null;
  let view = startAt?.view ?? "seals";
  const base = startAt?.node ? [startAt.node] : [];
  let path = base.slice(); // node hashes opened, outermost first
  let pick = {}; // node hash → the section chosen inside it
  let item = null; // the collectible picked in a collections node
  let showDone = true;
  const nodes = new Map(); // hash → d2_records answer
  const waiting = new Set();
  let toTop = false; // a new screen starts at the top

  const label = (title, extra) => el("div", { class: "sh-label" }, el("span", { class: "sh-label__text", text: title }), extra != null ? el("span", { class: "sh-label__count", text: extra }) : null);
  const bar = (p, g, gold) => {
    const fill = el("span", { class: "rc-bar__fill" });
    fill.style.width = `${pct(p, g)}%`;
    return el("span", { class: `rc-bar${gold ? " is-gold" : ""}`, role: "progressbar", "aria-valuenow": String(pct(p, g)), "aria-valuemin": "0", "aria-valuemax": "100" }, fill);
  };
  const open = (hash) => {
    path = [...path, hash];
    item = null;
    toTop = true;
    draw();
  };
  const back = (depth) => {
    path = depth === 0 ? base.slice() : path.slice(0, depth);
    item = null;
    toTop = true;
    draw();
  };

  async function fetchNode(hash) {
    if (nodes.has(hash) || waiting.has(hash)) return;
    waiting.add(hash);
    const r = await ctx.hub.d2Records(hash);
    waiting.delete(hash);
    nodes.set(hash, r?.ok ? r.data : { error: r?.error ?? "Something went wrong." });
    if (document.body.contains(root)) draw();
  }

  // ---------- Pieces ----------

  function shield(s, legacy) {
    const art = el("span", { class: "rc-shield__art" }, s.icon ? el("img", { src: s.icon, alt: "", loading: "lazy" }) : null);
    return el(
      "button",
      { class: `rc-shield${s.earned ? " is-earned" : ""}${legacy ? " is-legacy" : ""}`, type: "button", title: `${s.name}${s.title ? ` · ${s.title}` : ""}\n${number(s.progress)} of ${number(s.goal)}`, onclick: () => open(s.hash) },
      art,
      legacy ? null : bar(s.progress, s.goal, s.earned),
      el("span", { class: "rc-shield__title", text: s.title || s.name }),
    );
  }

  function medallion(n, legacy) {
    const ring = el("span", { class: `rc-medal__ring${n.complete ? " is-gold" : ""}` }, n.icon ? el("img", { src: n.icon, alt: "", loading: "lazy" }) : null);
    ring.style.setProperty("--p", `${pct(n.progress, n.goal) * 3.6}deg`);
    return el(
      "button",
      { class: `rc-medal${legacy ? " is-legacy" : ""}`, type: "button", onclick: () => open(n.hash) },
      ring,
      el("span", { class: "rc-medal__name", text: n.name }),
      el("span", { class: "rc-medal__count", text: n.goal ? `${number(n.progress)} / ${number(n.goal)}` : "" }),
    );
  }

  function categoryTile(n) {
    return el(
      "button",
      { class: `rc-cat${n.complete ? " is-done" : ""}`, type: "button", onclick: () => open(n.hash) },
      el("span", { class: "rc-cat__icon" }, n.icon ? el("img", { src: n.icon, alt: "", loading: "lazy" }) : null),
      el("span", { class: "rc-cat__name", text: n.name }),
      el("span", { class: "rc-cat__count", text: n.goal ? `${number(n.progress)} / ${number(n.goal)}` : "" }),
    );
  }

  function badgeCard(n) {
    return el(
      "button",
      { class: `rc-badge${n.complete ? " is-done" : ""}`, type: "button", onclick: () => open(n.hash) },
      el("span", { class: "rc-badge__art" }, n.icon ? el("img", { src: n.icon, alt: "", loading: "lazy" }) : null),
      el("span", { class: "rc-badge__name", text: n.name }),
      bar(n.progress, n.goal, n.complete),
    );
  }

  function recordTile(r) {
    const objectives = (r.objectives ?? []).filter((o) => o.goal > 1 || o.text);
    return el(
      "div",
      { class: `rc-tile${r.complete ? " is-done" : ""}` },
      el("span", { class: "rc-tile__icon" }, r.icon ? el("img", { src: r.icon, alt: "", loading: "lazy" }) : null, r.complete ? el("i", { class: "rc-tile__check", text: "✓" }) : null),
      el(
        "div",
        { class: "rc-tile__body" },
        el("div", { class: "rc-tile__name" }, el("strong", { text: r.name }), r.score ? el("span", { class: "rc-tile__score", text: number(r.score) }) : null),
        r.description ? el("p", { class: "rc-tile__desc", text: r.description }) : null,
        ...objectives.map((o) => {
          const fill = el("span", { class: "rc-obj__fill" });
          fill.style.width = `${pct(o.progress, o.goal)}%`;
          return el("div", { class: `rc-obj${o.complete ? " is-done" : ""}` }, fill, el("span", { class: "rc-obj__text", text: o.text || "Progress" }), el("span", { class: "rc-obj__num", text: o.goal > 1 ? `${number(o.progress)} / ${number(o.goal)}` : o.complete ? "Done" : "" }));
        }),
        el(
          "div",
          { class: "rc-tile__tags" },
          r.tier ? el("span", { class: "rc-tag", text: `Tier ${r.tier[0]} of ${r.tier[1]}` }) : null,
          r.secret ? el("span", { class: "rc-tag", text: "Secret" }) : null,
          r.claimable ? el("span", { class: "rc-tag is-claim", text: "Claim in game" }) : null,
        ),
      ),
    );
  }

  function recordGroups(records, { seal } = {}) {
    const main = records.filter((r) => !r.extra);
    const extra = seal ? records.filter((r) => r.extra) : [];
    const todo = main.filter((r) => !r.complete);
    const done = main.filter((r) => r.complete);
    const group = (title, list, note) => (list.length ? el("section", { class: "rc-group" }, el("div", { class: "rc-bar-head" }, el("span", { text: title }), el("span", { class: "rc-bar-head__count", text: note ?? String(list.length) })), el("div", { class: "rc-tiles" }, ...list.map(recordTile))) : null);
    if (!records.length) return [el("p", { class: "tab__note", text: "No triumphs here." })];
    return [
      group("Still to do", todo),
      done.length
        ? el(
            "div",
            {},
            el("button", { class: "linkish rc-toggle", type: "button", text: showDone ? `Hide completed (${done.length})` : `Show completed (${done.length})`, onclick: () => ((showDone = !showDone), draw()) }),
            showDone ? group("Completed", done) : null,
          )
        : null,
      group("For gilding", extra, "Not needed for the title"),
    ];
  }

  // ---------- Overview screens ----------

  function sealsScreen() {
    const { active, legacy } = home.seals;
    const earned = active.filter((s) => s.earned).length;
    return [
      el("section", { class: "sh-box" }, label("Titles", `${earned} of ${active.length} earned`), el("div", { class: "rc-shields" }, ...active.map((s) => shield(s, false)))),
      legacy.length ? el("section", { class: "sh-box" }, label("Legacy titles", `${legacy.filter((s) => s.earned).length} of ${legacy.length} earned`), el("div", { class: "rc-shields rc-shields--legacy" }, ...legacy.map((s) => shield(s, true)))) : null,
    ];
  }

  function triumphsScreen() {
    const { active, legacy } = home.triumphs;
    return [
      el("section", { class: "sh-box" }, label("Triumphs", `Active score ${number(home.scores.active)}`), el("div", { class: "rc-medals" }, ...active.map((n) => medallion(n, false)))),
      legacy.length ? el("section", { class: "sh-box" }, label("Legacy triumphs", `Legacy score ${number(home.scores.legacy)}`), el("div", { class: "rc-medals rc-medals--legacy" }, ...legacy.map((n) => medallion(n, true)))) : null,
    ];
  }

  function collectionsScreen() {
    const { categories, badges } = home.collections;
    const owned = categories.reduce((a, c) => a + (c.progress || 0), 0);
    const total = categories.reduce((a, c) => a + (c.goal || 0), 0);
    return [
      el(
        "div",
        { class: "sh-pair rc-coll" },
        el("section", { class: "sh-box" }, label("Items", total ? `${number(owned)} / ${number(total)}` : null), el("div", { class: "rc-cats" }, ...categories.map(categoryTile))),
        el("section", { class: "sh-box" }, label("Badges", `${badges.filter((b) => b.complete).length} / ${badges.length}`), el("div", { class: "rc-badges" }, ...badges.map(badgeCard))),
      ),
    ];
  }

  // ---------- One node ----------

  function crumbs(data) {
    if (base.length && path.length === 1) return null;
    const parts = base.length ? [] : [el("button", { class: "linkish", type: "button", text: VIEWS.find(([id]) => id === view)[1], onclick: () => back(0) })];
    path.forEach((h, i) => {
      if (i === 0 && base.length) {
        parts.push(el("button", { class: "linkish", type: "button", text: nodes.get(h)?.node?.name ?? "Back", onclick: () => back(0) }));
        return;
      }
      const d = nodes.get(h);
      parts.push(el("span", { class: "rc-crumbs__sep", text: "›" }));
      if (i === path.length - 1) parts.push(el("span", { text: d?.node?.name ?? data?.node?.name ?? "" }));
      else parts.push(el("button", { class: "linkish", type: "button", text: d?.node?.name ?? "…", onclick: () => back(i + 1) }));
    });
    return el("nav", { class: "rc-crumbs", "aria-label": "Where you are" }, ...parts);
  }

  function sealPage(d) {
    const n = d.node;
    const plate = n.earned ? "Earned" : d.legacy ? "No longer available" : "Not yet earned";
    return el(
      "div",
      { class: "rc-seal" },
      el(
        "aside",
        { class: `sh-box rc-seal__panel${n.earned ? " is-earned" : ""}${d.legacy ? " is-legacy" : ""}` },
        el("span", { class: "rc-seal__art" }, n.icon ? el("img", { src: n.icon, alt: "" }) : null),
        el("h2", { class: "rc-seal__name", text: n.name }),
        n.description ? el("p", { class: "rc-seal__desc", text: n.description }) : null,
        el("div", { class: "rc-seal__progress" }, el("span", { text: "Title progress" }), el("strong", { text: `${number(n.progress)} of ${number(n.goal)}` })),
        bar(n.progress, n.goal, n.earned),
        n.title ? el("div", { class: `rc-plate${n.earned ? " is-earned" : ""}` }, el("span", { class: "rc-plate__title", text: n.title }), el("span", { class: "rc-plate__state", text: plate })) : null,
        n.gildable ? el("p", { class: "tab__note", text: "This title can be gilded." }) : null,
        d.legacy ? el("p", { class: "tab__note", text: "A legacy seal: its title can't be earned any more." }) : null,
      ),
      el("div", { class: "rc-seal__tiles" }, ...recordGroups(d.records, { seal: true })),
    );
  }

  function itemDetail(c) {
    if (!c) return el("aside", { class: "sh-box rc-detail is-empty" }, el("p", { class: "tab__note", text: "Pick an item to see where it comes from." }));
    return el(
      "aside",
      { class: `sh-box rc-detail${c.owned ? "" : " is-missing"}` },
      el("div", { class: "rc-detail__head" }, el("span", { class: `rc-item tier-${c.tier}` }, c.icon ? el("img", { src: c.icon, alt: "" }) : null), el("div", {}, el("strong", { text: c.name }), el("span", { class: "rc-detail__type", text: c.type }))),
      el("p", { class: `rc-detail__owned${c.owned ? " is-owned" : ""}`, text: c.owned ? "In your collection" : "Not collected yet" }),
      c.source ? el("div", {}, el("div", { class: "rc-detail__label", text: "How to get it" }), el("p", { class: "rc-detail__source", text: c.source })) : null,
    );
  }

  function itemGrid(list) {
    if (!list.length) return el("p", { class: "tab__note", text: "Nothing here." });
    return el(
      "div",
      { class: "rc-items" },
      ...list.map((c) =>
        el(
          "button",
          { class: `rc-item tier-${c.tier}${c.owned ? "" : " is-missing"}${item?.hash === c.hash ? " is-picked" : ""}`, type: "button", title: `${c.name}${c.owned ? "" : " (not collected)"}`, "aria-label": c.name, onclick: () => ((item = c), draw()) },
          c.icon ? el("img", { src: c.icon, alt: "", loading: "lazy" }) : el("span", { text: c.name.slice(0, 2) }),
        ),
      ),
    );
  }

  // Stat trackers: the number big, like the game's.
  function metricGrid(list) {
    if (!list?.length) return null;
    return el(
      "div",
      { class: "rc-metrics" },
      ...list.map((m) =>
        el(
          "div",
          { class: "rc-metric", title: m.description || m.name },
          el("span", { class: "rc-metric__icon" }, m.icon ? el("img", { src: m.icon, alt: "", loading: "lazy" }) : null),
          el("span", { class: "rc-metric__name", text: m.name }),
          el("strong", { class: "rc-metric__value", text: m.value == null ? "–" : number(m.value) }),
          m.lowerIsBetter ? el("span", { class: "rc-tag", text: "Lower is better" }) : null,
        ),
      ),
    );
  }
  const contents = (d, deeper) => [
    d.collectibles.length ? itemGrid(d.collectibles) : null,
    metricGrid(d.metrics),
    ...(d.records.length || (!d.collectibles.length && !d.metrics?.length && !deeper) ? recordGroups(d.records) : []),
  ];

  // A category (triumphs or collections): sections down the left, the chosen one's contents in the middle.
  function categoryPage(d) {
    const n = d.node;
    const head = el(
      "header",
      { class: "sh-box rc-head" },
      el("span", { class: "rc-head__icon" }, n.icon ? el("img", { src: n.icon, alt: "" }) : null),
      el("div", { class: "rc-head__text" }, el("h2", { text: n.name }), n.description ? el("p", { text: n.description }) : null),
      n.goal ? el("div", { class: "rc-head__count" }, el("strong", { text: `${number(n.progress)} / ${number(n.goal)}` }), bar(n.progress, n.goal, n.complete)) : null,
    );
    const collections = d.section === "collections" || d.section === "badge" || d.collectibles.length > 0;
    let content;
    if (d.groups) {
      // Weapon patterns: one page, a section per weapon group, already read.
      const chosen = d.groups.some((g) => g.hash === pick.patterns) ? pick.patterns : d.groups[0]?.hash;
      const group = d.groups.find((g) => g.hash === chosen);
      const sections = el(
        "nav",
        { class: "sh-box rc-sections", "aria-label": "Sections" },
        ...d.groups.map((g) =>
          el(
            "button",
            { class: `rc-section${g.hash === chosen ? " is-on" : ""}${g.complete ? " is-done" : ""}`, type: "button", "aria-pressed": String(g.hash === chosen), onclick: () => ((pick = { ...pick, patterns: g.hash }), draw()) },
            g.icon ? el("img", { src: g.icon, alt: "" }) : null,
            el("span", { class: "rc-section__name", text: g.name }),
            el("span", { class: "rc-section__count", text: `${number(g.progress)}/${number(g.goal)}` }),
          ),
        ),
      );
      content = el("div", { class: "rc-browse" }, sections, el("section", { class: "sh-box rc-middle" }, ...(group ? recordGroups(group.records) : [el("p", { class: "tab__note", text: "No weapon patterns found." })])));
    } else if (d.children.length) {
      const chosen = d.children.some((c) => c.hash === pick[n.hash]) ? pick[n.hash] : d.children[0].hash;
      const inner = nodes.get(chosen);
      if (!inner) fetchNode(chosen);
      const sections = el(
        "nav",
        { class: "sh-box rc-sections", "aria-label": "Sections" },
        ...d.children.map((c) =>
          el(
            "button",
            { class: `rc-section${c.hash === chosen ? " is-on" : ""}${c.complete ? " is-done" : ""}`, type: "button", "aria-pressed": String(c.hash === chosen), onclick: () => ((pick = { ...pick, [n.hash]: c.hash }), (item = null), draw()) },
            c.icon ? el("img", { src: c.icon, alt: "" }) : null,
            el("span", { class: "rc-section__name", text: c.name }),
            el("span", { class: "rc-section__count", text: c.goal ? `${number(c.progress)}/${number(c.goal)}` : "" }),
          ),
        ),
      );
      let body;
      if (!inner) body = el("p", { class: "tab__note", text: "Reading…" });
      else if (inner.error) body = el("p", { class: "tab__note", text: inner.error });
      else {
        const deeper = inner.children.length
          ? el("div", { class: "rc-deeper" }, ...inner.children.map((c) => el("button", { class: "rc-chip", type: "button", onclick: () => open(c.hash) }, el("span", { text: c.name }), c.goal ? el("small", { text: `${number(c.progress)}/${number(c.goal)}` }) : null)))
          : null;
        body = el("div", { class: "rc-inner" }, deeper, ...contents(inner, deeper));
      }
      content = el("div", { class: `rc-browse${collections ? " has-detail" : ""}` }, sections, el("section", { class: "sh-box rc-middle" }, body), collections ? itemDetail(item) : null);
    } else {
      content = el("div", { class: `rc-browse rc-browse--flat${collections ? " has-detail" : ""}` }, el("section", { class: "sh-box rc-middle" }, ...contents(d, null)), collections ? itemDetail(item) : null);
    }
    return [head, content];
  }

  function nodeScreen() {
    const hash = path[path.length - 1];
    const d = nodes.get(hash);
    if (!d) {
      fetchNode(hash);
      return [crumbs(null), el("div", { class: "rc-wait" }, loadingView(ctx, "Reading that from Bungie…", "records"))];
    }
    if (d.error) return [crumbs(d), el("p", { class: "tab__note", text: d.error })];
    const seal = d.node.title != null && (d.section === "seals" || d.records.length > 0) && !d.children.length;
    return [crumbs(d), ...(seal ? [sealPage(d)] : categoryPage(d))];
  }

  // ---------- The tab ----------

  function draw() {
    const views = el(
      "div",
      { class: "rc-views", role: "tablist", "aria-label": "Section" },
      ...VIEWS.map(([id, name]) =>
        el("button", { class: `rc-view${view === id ? " is-on" : ""}`, type: "button", role: "tab", "aria-selected": String(view === id), text: name, onclick: () => ((view = id), (path = []), (item = null), (toTop = true), draw()) }),
      ),
    );
    const title = base.length ? (nodes.get(base[0])?.node?.name ?? startAt.title ?? "Triumphs") : "Triumphs";
    const top = el(
      "header",
      { class: "sh-top" },
      el("div", { class: "sh-top__text" }, el("span", { class: "sh-top__kicker", text: `Active score ${number(home.scores.active)} · Lifetime ${number(home.scores.lifetime)}` }), el("h1", { class: "sh-top__title", text: title })),
      el("div", { class: "sh-top__tools" }, base.length ? null : views, el("button", { class: "btn btn--small", type: "button", text: "Refresh", onclick: () => start(true) })),
    );
    const screen = path.length ? nodeScreen().filter(Boolean) : view === "seals" ? sealsScreen() : view === "triumphs" ? triumphsScreen() : collectionsScreen();
    const scroll = toTop ? 0 : (root.querySelector(".sh-body")?.scrollTop ?? 0);
    toTop = false;
    const body = el("div", { class: "sh-body" }, el("div", { class: "sh-main" }, ...screen.filter(Boolean)));
    root.replaceChildren(backdrop, top, body);
    body.scrollTop = scroll;
  }

  async function start(fresh) {
    if (!home || fresh) container.replaceChildren(loadingView(ctx, "Reading your triumphs from Bungie…", "records"));
    const r = await ctx.hub.d2Records(null, fresh);
    if (!r?.ok) return container.replaceChildren(problemView(ctx, r?.error ?? "Something went wrong.", () => start(true)));
    home = r.data;
    nodes.clear();
    draw();
    if (!container.contains(root)) container.replaceChildren(root);
  }
  start(false);
}
