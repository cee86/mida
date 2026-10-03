// The Director tab (Destiny 2), like the Companion app's Director, on the Seasonal Hub's look (sh-* classes):
//
//   [ DIRECTOR · season ....................................................................... refresh ]
//   [ Seasonal Hub · Vendors · Quests · Friends ]
//   [ the season's banner (its seal, triumphs and Tenets)          ] [ reward pass rank and XP ] [ clan ]
//   [ Vanguard alerts: every activity the Portal lists for the character (featured first) · Ops Categories › ]
// The latest Bungie articles sit across the top (news.js); a character picker in the title band picks whose Portal.
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
import { wallpaper } from "./wallpaper.js";
import { articleReader, loadPicture } from "./news.js";

// The Portal's four groups, in the app's order; Bungie's own trait text and icon are used when it sends them.
const OPS = [
  ["Arena Ops", "Join a large group of Lightbearers executing Vanguard operations around Sol and crushing Earth's deadliest foes."],
  ["Fireteam Ops", "Team up with fellow Guardians to defend the Last City and reclaim Sol from humanity's adversaries."],
  ["Solo Ops", "Protect Earth from Sol's greatest foes as a one-Guardian fireteam and the Vanguard's last line of defense."],
  ["Pinnacle Ops", "Brave the lairs of humanity's greatest foes to secure Sol for the Vanguard and earn sought-after armaments for the battles to come."],
];
const SECTIONS = [
  ["seasonal", "Seasonal Hub", "Orders, challenges and the reward pass", ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", "M12 3a9 9 0 0 0 0 18z"]],
  ["vendors", "Vendors", "What everyone's selling", ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", "M6 15l3-4 2 2 3-5 4 7z"]],
  ["quests", "Quests", "Every quest and bounty you hold", ["M6 3h12v18l-6-4-6 4z", "M9 8l1.5 1.5L12 7l1.5 2.5L15 8l-.5 3h-5z"]],
  ["friends", "Friends", "Your Bungie.net friends, who's online", ["M8.5 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", "M2.5 20a6 6 0 0 1 12 0M13 14.5a5.5 5.5 0 0 1 8.5 5.5"]],
];
const number = (n) => (n == null ? "–" : Number(n).toLocaleString());
const opsOf = (a, name) => (a.traits ?? []).some((t) => t.toLowerCase().includes(name.toLowerCase()));

export function directorTab(ctx, container, deps) {
  const { el, svg } = ctx;
  const { loadingView, problemView, until, characterPicker } = deps;
  const wall = deps.wallpaper ?? "tab-director";
  const pages = subpages(ctx, container, "Director");
  const root = el("div", { class: "tab dr sh" });
  const backdrop = () => wallpaper(ctx, wall);
  const homeBackdrop = backdrop();
  let dir = null; // d2_director
  let portal = null; // d2_portal for `who`
  let who = null; // the character the Portal is read for
  let friends = null; // d2_friends, for the online count
  let articles = null; // the latest Bungie articles (d2_news), for the strip at the top
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
    const withWall = { ...deps, wallpaper: wall };
    if (key === "seasonal") return pages.show("seasonal", "Seasonal Hub", (host) => seasonalHub(ctx, host, withWall));
    if (key === "vendors") return pages.show("vendors", "Vendors", (host) => vendorsTab(ctx, host, withWall));
    if (key === "quests") return pages.show("quests", "Quests", (host) => questsTab(ctx, host, withWall));
    if (key === "friends") return pages.show("friends", "Friends", (host) => friendsPage(host));
    if (key === "clan") return pages.show("clan", "Clan", (host) => clanTab(ctx, host, withWall));
    if (key === "season") return pages.show("season", dir?.season?.name || "Season", (host) => seasonPage(host));
    if (key === "ops") return pages.show(`ops-${who}`, "Ops Categories", (host) => opsCategories(host));
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
        if (seal) recordsTab(ctx, sealHost, { loadingView, problemView, start: { node: seal, title: "Seal" }, wallpaper: wall });
        else sealHost.replaceChildren(el("div", { class: "tab" }, el("p", { class: "tab__note", text: "Bungie doesn't name a seal for this season." })));
      } else {
        vendorsTab(ctx, tenetHost, {
          ...deps,
          wallpaper: wall,
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
      friends = r.data;
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

  // Ops Categories: the four groups with Bungie's description; picking one lists its activities as cards.
  function opsCategories(host) {
    let chosen = null;
    const shell = (kicker, title, tools, ...children) =>
      el(
        "div",
        { class: "tab dr sh" },
        backdrop(),
        el("header", { class: "sh-top" }, el("div", { class: "sh-top__text" }, el("span", { class: "sh-top__kicker", text: kicker }), el("h1", { class: "sh-top__title", text: title })), el("div", { class: "sh-top__tools" }, ...tools)),
        el("div", { class: "sh-body" }, el("div", { class: "sh-main" }, ...children)),
      );
    const paint = () => {
      if (!portal) return host.replaceChildren(shell("Director", "Ops Categories", [], waiting("portal", "Reading the Portal…")));
      if (chosen) {
        const list = sorted(portal.activities.filter((a) => opsOf(a, chosen)));
        return host.replaceChildren(
          shell(
            "Ops Categories",
            chosen,
            [el("button", { class: "btn btn--small", type: "button", text: "All categories", onclick: () => ((chosen = null), paint()) })],
            list.length ? el("section", { class: "sh-box" }, label("Activities", `${list.length} · ${list.filter((a) => a.matchmade).length} matchmade`), el("div", { class: "dr-acts" }, ...list.map(activityCard))) : el("p", { class: "tab__note", text: `Bungie's list didn't mark any activity as ${chosen} for this character.` }),
          ),
        );
      }
      const info = portal.traitInfo ?? {};
      host.replaceChildren(
        shell(
          "Director",
          "Ops Categories",
          [],
          el(
            "div",
            { class: "dr-op-list" },
            ...OPS.map(([name, text]) => {
              const t = Object.entries(info).find(([k]) => k.toLowerCase().includes(name.toLowerCase()))?.[1];
              const n = portal.activities.filter((a) => opsOf(a, name)).length;
              return el(
                "button",
                { class: "gd-short dr-op", type: "button", onclick: () => ((chosen = name), paint()) },
                el("span", { class: `gd-short__icon${t?.icon ? " has-image" : ""}` }, t?.icon ? el("img", { src: t.icon, alt: "" }) : svg(["M5 4h14v8c0 4-3 7-7 8-4-1-7-4-7-8z"])),
                el("span", { class: "gd-short__text" }, el("strong", { text: name }), el("span", { class: "dr-op__desc", text: t?.description || text }), el("small", { text: n ? `${n} ${n === 1 ? "activity" : "activities"}` : "None listed for this character" })),
              );
            }),
          ),
        ),
      );
    };
    paint();
    if (!portal) loadPortal(false).then(paint);
  }

  // ---------- Pieces ----------

  // Featured first, then Pinnacle, Fireteam, Solo, Arena, then by name.
  const opsRank = (a) => {
    const i = OPS.findIndex(([name]) => opsOf(a, name));
    return i < 0 ? OPS.length : [3, 1, 2, 0][i];
  };
  const sorted = (list) => [...list].sort((a, b) => Number(b.featured) - Number(a.featured) || opsRank(a) - opsRank(b) || String(a.name).localeCompare(String(b.name)));

  // The latest Bungie articles as banners across the top; each opens inside the Director.
  function newsStrip() {
    if (!articles?.length) return null;
    return el(
      "div",
      { class: "dr-news", role: "list", "aria-label": "Latest from Bungie" },
      ...articles.slice(0, 6).map((a) =>
        el("button", { class: "dr-news__item", type: "button", role: "listitem", onclick: () => pages.show(`article-${a.id}`, a.title, (host) => articleReader(ctx, host, a, wall)) }, a.image ? loadPicture(ctx, a.image) : null, el("span", { text: a.title })),
      ),
    );
  }

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
        ...(a.traits ?? []).filter((t) => /ops/i.test(t)).map((t) => el("span", { class: "dr-tag", text: t })),
        a.light ? el("span", { class: "dr-tag", text: `✧ ${number(a.light)}` }) : null,
      ),
      weapons.length ? el("div", { class: "dr-act__focus" }, el("small", { text: "Focused weapon" }), ...weapons.map((w) => el("span", { class: "dr-focus" }, reward(w), el("span", { text: w.name })))) : null,
      // Engrams by name (the raid and dungeon's Tier 5 engram reads at a glance), the other drops as icons.
      engrams.length || rest.length
        ? el("div", { class: "dr-act__rewards" }, el("small", { text: "Bonus drops" }), ...engrams.map((r) => el("span", { class: "dr-focus" }, reward(r), el("span", { text: r.name }))), rest.length ? el("div", { class: "dr-rewards" }, ...rest.map(reward)) : null)
        : el("p", { class: "dr-act__none", text: "No bonus drops listed." }),
    );
  }

  function shortcut(key, name, note, icon) {
    if (key === "friends" && friends) note = `${friends.filter((f) => f.online).length} online · ${friends.length} friends`;
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
      label(dir?.pass ? `Rewards Pass: ${dir.pass}` : "Rewards Pass"),
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

  // Every activity the Portal lists for the character, featured ones first; "Ops Categories" groups them.
  function alerts() {
    const list = sorted(portal?.activities ?? []);
    return el(
      "section",
      { class: "sh-box dr-alerts" },
      label("Vanguard alerts", [portal ? `${list.filter((a) => a.featured).length} featured · ${list.length} in all ` : null, el("button", { class: "dr-head-link", type: "button", text: "Ops Categories ›", onclick: () => open("ops") })].filter(Boolean)),
      !portal
        ? waiting("portal", "Reading the Portal from Bungie… (the first time reads every activity, so it takes a little longer)")
        : list.length
          ? el("div", { class: "dr-acts" }, ...list.map(activityCard))
          : el("p", { class: "tab__note", text: "Bungie listed no activities with rewards for this character. The data check below shows what it sent." }),
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
      el(
        "div",
        { class: "sh-top__tools" },
        dir?.characters?.length > 1
          ? characterPicker(ctx, dir.characters, who, (id) => {
              who = id;
              loadPortal(true);
            })
          : null,
        el("button", { class: "btn btn--small", type: "button", text: "Refresh", onclick: () => start(true) }),
      ),
    );
    const scroll = root.querySelector(".sh-body")?.scrollTop ?? 0;
    const body = el(
      "div",
      { class: "sh-body" },
      el("div", { class: "sh-main" }, newsStrip(), el("div", { class: "dr-sections" }, ...SECTIONS.map(([id, name, note, icon]) => shortcut(id, name, note, icon))), banners(), alerts(), check()),
    );
    root.replaceChildren(homeBackdrop, top, body);
    body.scrollTop = scroll;
  }

  function loadPortal(fresh) {
    if (fresh) portal = null;
    delete errors.portal;
    draw();
    const asked = who;
    return ctx.hub.d2Portal(who).then((r) => {
      if (asked !== who) return;
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
      if (r?.ok) {
        dir = r.data;
        if (!who && dir.characters?.length) who = dir.characters[0].id;
        loadPortal(fresh);
      } else {
        errors.director = r?.error ?? "Something went wrong.";
        draw();
      }
    });
    ctx.hub.d2News().then((r) => {
      if (r?.ok) {
        articles = (r.data.items ?? []).filter((it) => it.source === "bungie");
        draw();
      }
    });
    ctx.hub.d2Friends().then((r) => {
      if (r?.ok) {
        friends = r.data;
        draw();
      }
    });
  }
  start(false);
}
