// The Director tab (Destiny 2), like the Companion app's Director, on the Seasonal Hub's look (sh-* classes):
//
//   [ DIRECTOR · season ....................................................................... refresh ]
//   [ Seasonal Hub · Vendors · Quests · Friends ]
//   [ the season's banner (its seal, triumphs and Tenets)          ] [ reward pass rank and XP ] [ clan ]
//   [ Vanguard alerts: the Portal's featured activities with their bonus drops ]
//   [ Arena Ops · Fireteam Ops · Solo Ops · Pinnacle Ops → every activity of that kind ]
//
// d2_director (hubs.rs `director`: season and pass) and d2_portal (hubs.rs `portal`: the character's available
// activities with Bungie's visible rewards, featured flag, traits and matchmaking) fill in as they arrive. The Seasonal
// Hub, Vendors, Quests and Clan screens open as pages inside this tab (subpages.js).

import { subpages } from "./subpages.js";
import { seasonalHub } from "./seasonal.js";
import { questsTab } from "./quests.js";
import { vendorsTab } from "./vendors.js";
import { clanTab } from "./clan.js";
import { recordsTab } from "./records.js";

const OPS = [
  ["arena", "Arena Ops", "Crucible playlists and modes", ["M6 4l12 16M18 4L6 20", "M4 8l4-4M20 8l-4-4"]],
  ["fireteam", "Fireteam Ops", "Matchmade fireteam activities", ["M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", "M3 20a5 5 0 0 1 10 0M11 20a5 5 0 0 1 10 0"]],
  ["solo", "Solo Ops", "Activities to play on your own", ["M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", "M4 21a8 8 0 0 1 16 0"]],
  ["pinnacle", "Pinnacle Ops", "The hardest activities and the best rewards", ["M3 20l6-10 4 6 3-4 5 8z", "M15 6l2-3 2 3"]],
];
const SECTIONS = [
  ["seasonal", "Seasonal Hub", "Orders, challenges and the reward pass", ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", "M12 7v5l3 2"]],
  ["vendors", "Vendors", "What everyone's selling", ["M4 9l1.5-5h13L20 9", "M4 9h16v2a2.7 2.7 0 0 1-5.3 0 2.7 2.7 0 0 1-5.4 0A2.7 2.7 0 0 1 4 11z", "M5.5 13v7h13v-7"]],
  ["quests", "Quests", "Every quest and bounty you hold", ["M6 3h9l3 3v15H6z", "M9 9h6M9 13h6M9 17h4"]],
  ["friends", "Friends", "Your Bungie.net friends, who's online", ["M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", "M3 20a6 6 0 0 1 12 0", "M17 8v6M14 11h6"]],
];
const number = (n) => (n == null ? "–" : Number(n).toLocaleString());
const opsOf = (a, name) => (a.traits ?? []).some((t) => t.toLowerCase() === name.toLowerCase() || t.toLowerCase().includes(name.toLowerCase()));

export function directorTab(ctx, container, deps) {
  const { el, svg } = ctx;
  const { loadingView, problemView, until } = deps;
  const pages = subpages(ctx, container, "Director");
  const root = el("div", { class: "tab dr sh" });
  const backdrop = () => {
    const node = el("div", { class: "inv-backdrop sh-backdrop", "aria-hidden": "true" });
    try {
      const picture = localStorage.getItem("mida-sh-backdrop") || localStorage.getItem("mida-inv-backdrop");
      if (picture) {
        node.style.backgroundImage = `url("${picture}")`;
        node.classList.add("has-picture");
      }
    } catch {
      // The built-in backdrop shows.
    }
    return node;
  };
  let dir = null; // d2_director
  let portal = null; // d2_portal
  const errors = {};
  const label = (title, extra) => el("div", { class: "sh-label" }, el("span", { class: "sh-label__text", text: title }), extra == null ? null : el("span", { class: "sh-label__count" }, ...[].concat(extra).map((x) => (x instanceof Node ? x : document.createTextNode(String(x))))));
  const waiting = (key, text) => (errors[key] ? el("p", { class: "tab__error", text: errors[key] }) : el("p", { class: "tab__note", text }));
  const meter = (p, g) => {
    const fill = el("span");
    fill.style.width = `${g > 0 ? Math.min(100, Math.round((p / g) * 100)) : 0}%`;
    return el("span", { class: "sh-meter dr-meter" }, fill);
  };

  // ---------- Pages ----------

  function open(key) {
    if (key === "seasonal") return pages.show("seasonal", "Seasonal Hub", (host) => seasonalHub(ctx, host, deps));
    if (key === "vendors") return pages.show("vendors", "Vendors", (host) => vendorsTab(ctx, host, deps));
    if (key === "quests") return pages.show("quests", "Quests", (host) => questsTab(ctx, host, deps));
    if (key === "friends") return pages.show("friends", "Friends", (host) => friendsPage(host));
    if (key === "clan") return pages.show("clan", "Clan", (host) => clanTab(ctx, host, deps));
    if (key === "season") return pages.show("season", dir?.season?.name || "Season", (host) => seasonPage(host));
    const ops = OPS.find(([id]) => id === key);
    if (ops) return pages.show(`ops-${key}`, ops[1], (host) => opsPage(host, ops));
  }

  // The season: its seal and triumphs (the Triumphs screen at the seal) and the Tenets (vendors named Tenet).
  function seasonPage(host) {
    const seal = dir?.season?.seal;
    const sealHost = el("div", { class: "sub__host" });
    const tenetHost = el("div", { class: "sub__host" });
    let shown = null;
    const built = new Set();
    const switcher = el("div", { class: "segmented dr-season-switch", role: "group", "aria-label": "Season page" });
    const show = (which) => {
      shown = which;
      for (const b of switcher.children) b.setAttribute("aria-pressed", String(b.dataset.which === which));
      body.replaceChildren(which === "seal" ? sealHost : tenetHost);
      if (built.has(which)) return;
      built.add(which);
      if (which === "seal") {
        if (seal) recordsTab(ctx, sealHost, { loadingView, problemView, start: { node: seal, title: "Seal" } });
        else sealHost.replaceChildren(el("div", { class: "tab" }, el("p", { class: "tab__note", text: "Bungie doesn't name a seal for this season." })));
      } else {
        vendorsTab(ctx, tenetHost, {
          ...deps,
          title: "Tenets",
          only: (v) => /tenet/i.test(`${v.name} ${v.subtitle ?? ""} ${v.group ?? ""} ${v.description ?? ""}`),
          empty: "No vendor named a Tenet for this character. If the Tenets go by another name, tell us which vendors they are.",
        });
      }
    };
    for (const [which, text] of [["seal", "Seal and triumphs"], ["tenets", "Tenets and their rewards"]]) switcher.append(el("button", { type: "button", "data-which": which, text, onclick: () => show(which) }));
    const body = el("div", { class: "dr-season-body" });
    host.replaceChildren(el("div", { class: "dr-season" }, el("div", { class: "dr-season-bar" }, switcher), body));
    show(shown ?? "seal");
  }

  // Friends: Bungie.net friends, online first.
  function friendsPage(host) {
    const page = el("div", { class: "tab dr sh" });
    async function load() {
      host.replaceChildren(loadingView(ctx, "Reading your friends from Bungie…", "friends"));
      const r = await ctx.hub.d2Friends();
      if (!r?.ok) return host.replaceChildren(problemView(ctx, r?.error ?? "Something went wrong.", load));
      const online = r.data.filter((f) => f.online);
      const offline = r.data.filter((f) => !f.online);
      const row = (f) =>
        el(
          "div",
          { class: `dr-friend${f.online ? " is-online" : ""}` },
          el("span", { class: "dr-friend__icon" }, f.icon ? el("img", { src: f.icon, alt: "", loading: "lazy" }) : null, f.online ? el("i", { class: "cl-dot" }) : null),
          el("span", { class: "dr-friend__name" }, el("strong", { text: f.name }), f.code ? el("small", { text: `#${f.code}` }) : null),
          el("span", { class: "dr-friend__state", text: f.online ? (f.inDestiny ? "Playing Destiny 2" : "Online") : "Offline" }),
        );
      page.replaceChildren(
        backdrop(),
        el("header", { class: "sh-top" }, el("div", { class: "sh-top__text" }, el("span", { class: "sh-top__kicker", text: `${online.length} online · ${r.data.length} friends` }), el("h1", { class: "sh-top__title", text: "Friends" })), el("div", { class: "sh-top__tools" }, el("button", { class: "btn btn--small", type: "button", text: "Refresh", onclick: load }))),
        el(
          "div",
          { class: "sh-body" },
          el(
            "div",
            { class: "sh-main" },
            el("section", { class: "sh-box" }, label("Online", String(online.length)), online.length ? el("div", { class: "dr-friends" }, ...online.map(row)) : el("p", { class: "tab__note", text: "None of your friends are online." })),
            el("section", { class: "sh-box" }, label("Offline", String(offline.length)), offline.length ? el("div", { class: "dr-friends" }, ...offline.map(row)) : el("p", { class: "tab__note", text: "No one." })),
            el("p", { class: "tab__note", text: "Bungie.net friends only (not Steam, PlayStation or Xbox friends)." }),
          ),
        ),
      );
      host.replaceChildren(page);
    }
    load();
  }

  // Every activity of one Ops kind, as cards.
  function opsPage(host, [, name, blurb]) {
    const page = el("div", { class: "tab dr sh" });
    const paint = () => {
      const list = (portal?.activities ?? []).filter((a) => opsOf(a, name));
      page.replaceChildren(
        backdrop(),
        el("header", { class: "sh-top" }, el("div", { class: "sh-top__text" }, el("span", { class: "sh-top__kicker", text: blurb }), el("h1", { class: "sh-top__title", text: name })), el("div", { class: "sh-top__tools" }, el("button", { class: "btn btn--small", type: "button", text: "Refresh", onclick: () => loadPortal(true).then(paint) }))),
        el(
          "div",
          { class: "sh-body" },
          el(
            "div",
            { class: "sh-main" },
            !portal
              ? waiting("portal", "Reading the Portal…")
              : list.length
                ? el("section", { class: "sh-box" }, label("Activities", `${list.length} · ${list.filter((a) => a.matchmade).length} matchmade`), el("div", { class: "dr-acts" }, ...list.map(activityCard)))
                : el("p", { class: "tab__note", text: `Bungie's list didn't mark any activity as ${name}. The data check on the Director lists the kinds it did name.` }),
          ),
        ),
      );
    };
    host.replaceChildren(page);
    paint();
    if (!portal) loadPortal(false).then(paint);
  }

  // ---------- Pieces ----------

  function activityCard(a) {
    const engrams = a.rewards.filter((r) => /engram/i.test(`${r.name} ${r.typeName}`));
    const weapons = a.rewards.filter((r) => r.kind === 3);
    const rest = a.rewards.filter((r) => !engrams.includes(r) && !weapons.includes(r));
    const art = el("span", { class: "dr-act__art" });
    if (a.image) art.style.backgroundImage = `linear-gradient(180deg, rgba(0,0,0,0) 30%, rgba(0,0,0,0.75)), url("${a.image}")`;
    const kicker = (a.traits ?? []).find((t) => /ops/i.test(t)) || a.type || (a.pvp ? "Crucible" : "Activity");
    const reward = (r) => el("span", { class: `dr-reward tier-${r.tier}`, title: `${r.name}${r.typeName ? ` · ${r.typeName}` : ""}${r.quantity > 1 ? ` ×${r.quantity}` : ""}` }, r.icon ? el("img", { src: r.icon, alt: "", loading: "lazy" }) : el("span", { text: r.name.slice(0, 2) }));
    return el(
      "div",
      { class: `dr-act${a.featured ? " is-featured" : ""}` },
      art,
      el("span", { class: "dr-act__kicker", text: kicker }),
      el("div", { class: "dr-act__body" }, el("strong", { class: "dr-act__name", text: a.name }), a.fullName && a.fullName !== a.name ? el("small", { class: "dr-act__full", text: a.fullName }) : null),
      el(
        "div",
        { class: "dr-act__tags" },
        a.featured ? el("span", { class: "dr-tag is-accent", text: "Featured" }) : null,
        el("span", { class: `dr-tag${a.matchmade ? " is-on" : ""}`, text: a.matchmade ? "Matchmade" : "No matchmaking" }),
        a.light ? el("span", { class: "dr-tag", text: `◆ ${number(a.light)}` }) : null,
      ),
      weapons.length ? el("div", { class: "dr-act__focus" }, el("small", { text: "Focused weapon" }), ...weapons.map((w) => el("span", { class: "dr-focus" }, reward(w), el("span", { text: w.name })))) : null,
      // Engrams by name (the raid and dungeon's Tier 5 engram reads at a glance), the other drops as icons.
      engrams.length || rest.length
        ? el("div", { class: "dr-act__rewards" }, el("small", { text: "Bonus drops" }), ...engrams.map((r) => el("span", { class: "dr-focus" }, reward(r), el("span", { text: r.name }))), rest.length ? el("div", { class: "dr-rewards" }, ...rest.map(reward)) : null)
        : el("p", { class: "dr-act__none", text: "No bonus drops listed." }),
    );
  }

  function shortcut(key, name, note, icon) {
    return el("button", { class: "gd-short", type: "button", onclick: () => open(key) }, el("span", { class: "gd-short__icon" }, svg(icon)), el("span", { class: "gd-short__text" }, el("strong", { text: name }), el("small", { text: note })));
  }

  function banners() {
    const s = dir?.season;
    const seasonBanner = el(
      "button",
      { class: "dr-season-banner", type: "button", onclick: () => s && open("season"), disabled: s ? null : true },
      el("span", { class: "dr-season-banner__kicker", text: s?.number ? `Season ${s.number}` : "This season" }),
      el("strong", { class: "dr-season-banner__name", text: s?.name ?? (errors.director ? "Couldn't read the season" : "Reading…") }),
      s?.description ? el("span", { class: "dr-season-banner__desc", text: s.description }) : null,
      s?.ends ? el("span", { class: "dr-season-banner__ends" }, until(ctx, s.ends, " left")) : null,
      el("span", { class: "dr-season-banner__go", text: "Seal, triumphs and Tenets ›" }),
    );
    if (s?.image) seasonBanner.style.backgroundImage = `linear-gradient(90deg, rgba(0,0,0,0.75), rgba(0,0,0,0.15)), url("${s.image}")`;
    const r = s?.rank;
    const pass = el(
      "button",
      { class: "sh-box dr-pass", type: "button", onclick: () => open("seasonal") },
      label("Reward pass"),
      r ? el("div", { class: "dr-pass__rank" }, el("span", { class: "dr-pass__num", text: number(r.level) }), el("span", { class: "dr-pass__xp", text: r.next ? `${number(r.progress)} / ${number(r.next)} XP to rank ${number((r.level ?? 0) + 1)}` : "" })) : waiting("director", "Reading…"),
      r?.next ? meter(r.progress ?? 0, r.next) : null,
      el("small", { class: "dr-more", text: "Rewards in the Seasonal Hub ›" }),
    );
    const clan = el(
      "button",
      { class: "sh-box dr-clan", type: "button", onclick: () => open("clan") },
      label("Clan"),
      el("span", { class: "dr-clan__icon" }, svg(["M5 3v18", "M5 4h12l-2.5 4L17 12H5"])),
      el("span", { class: "dr-clan__text", text: "Who's online, what they're playing and the member list" }),
      el("small", { class: "dr-more", text: "Open your clan ›" }),
    );
    return el("div", { class: "dr-banners" }, seasonBanner, el("div", { class: "dr-side" }, pass, clan));
  }

  function alerts() {
    const featured = (portal?.activities ?? []).filter((a) => a.featured);
    return el(
      "section",
      { class: "sh-box dr-alerts" },
      label("Vanguard alerts", portal ? `${featured.length} featured this week` : null),
      !portal
        ? waiting("portal", "Reading the Portal from Bungie… (the first time reads every activity, so it takes a little longer)")
        : featured.length
          ? el("div", { class: "dr-acts" }, ...featured.map(activityCard))
          : el("p", { class: "tab__note", text: "Bungie didn't mark any activity as featured for this character. The data check below shows what it listed." }),
      el(
        "div",
        { class: "dr-ops" },
        ...OPS.map(([id, name, blurb, icon]) => {
          const n = (portal?.activities ?? []).filter((a) => opsOf(a, name)).length;
          return shortcut(id, name, portal ? (n ? `${n} ${n === 1 ? "activity" : "activities"} · ${blurb.toLowerCase()}` : "None listed this week") : blurb, icon);
        }),
      ),
    );
  }

  function check() {
    if (!portal) return null;
    return el(
      "details",
      { class: "sh-more sh-check" },
      el("summary", { text: "Data check (for tuning this tab)" }),
      el("p", { class: "tab__note", text: `Bungie listed ${portal.available} activities this character can launch; ${portal.activities.length} have something to show, ${portal.activities.filter((a) => a.featured).length} are featured.` }),
      el("h3", { text: "Kinds (traits) Bungie gave them" }),
      el("ul", {}, ...(portal.traits.length ? portal.traits.map((t) => el("li", { text: `${t.name} · ${t.count}` })) : [el("li", { text: "None." })])),
      el("h3", { text: "Featured" }),
      el("ul", {}, ...(portal.activities.filter((a) => a.featured).map((a) => el("li", { text: `${a.fullName || a.name} · ${a.rewards.length} rewards · ${a.traits.join(", ") || "no traits"}` })) || [])),
    );
  }

  // ---------- The tab ----------

  function draw() {
    const top = el(
      "header",
      { class: "sh-top" },
      el("div", { class: "sh-top__text" }, el("span", { class: "sh-top__kicker", text: dir?.season?.name ?? "Destiny 2" }), el("h1", { class: "sh-top__title", text: "Director" })),
      el("div", { class: "sh-top__tools" }, el("button", { class: "btn btn--small", type: "button", text: "Refresh", onclick: () => start(true) })),
    );
    const scroll = root.querySelector(".sh-body")?.scrollTop ?? 0;
    const body = el(
      "div",
      { class: "sh-body" },
      el("div", { class: "sh-main" }, el("div", { class: "dr-sections" }, ...SECTIONS.map(([id, name, note, icon]) => shortcut(id, name, note, icon))), banners(), alerts(), check()),
    );
    root.replaceChildren(backdrop(), top, body);
    body.scrollTop = scroll;
  }

  function loadPortal(fresh) {
    if (fresh) portal = null;
    return ctx.hub.d2Portal(null).then((r) => {
      if (r?.ok) portal = r.data;
      else errors.portal = r?.error ?? "Something went wrong.";
      draw();
    });
  }

  function start(fresh) {
    if (fresh) {
      dir = portal = null;
      for (const k of Object.keys(errors)) delete errors[k];
    }
    draw();
    pages.setHome(root);
    ctx.hub.d2Director().then((r) => {
      if (r?.ok) dir = r.data;
      else errors.director = r?.error ?? "Something went wrong.";
      draw();
    });
    loadPortal(false);
  }
  start(false);
}
