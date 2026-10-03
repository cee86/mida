// The Director tab (Destiny 2), like the Companion app's Director, on the Seasonal Hub's look (sh-* classes):
//
//   [ DIRECTOR · season ....................................................................... refresh ]
//   [ Seasonal Hub · Vendors · Quests · Friends ]
//   [ the season's banner (its seal, triumphs and Tenets)          ] [ reward pass rank and XP ] [ clan ]
//   [ Vanguard alerts: Grandmaster, weekly dungeon, weekly raid, Equilibrium, The Desert Perpetual ]
//   [ Ops Categories: Arena · Fireteam · Solo · Pinnacle · Crucible & Gambit, each opening its activities ]
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
import { glyph } from "./glyphs.js";
import { ROTATORS, withSaved, rotatorNow } from "./d2/rotators.js";
import { featuredRotation, RAID_NAMES, DUNGEON_NAMES } from "./d2/rotations.js";

// The Ops boxes, in the app's order (its text; Bungie's own trait text when it sends it), then Crucible & Gambit.
const OPS = [
  { id: "arena", name: "Arena Ops", text: "Join a large group of Lightbearers executing Vanguard operations around Sol and crushing Earth's deadliest foes." },
  { id: "fireteam", name: "Fireteam Ops", text: "Team up with fellow Guardians to defend the Last City and reclaim Sol from humanity's adversaries." },
  { id: "solo", name: "Solo Ops", text: "Protect Earth from Sol's greatest foes as a one-Guardian fireteam and the Vanguard's last line of defense." },
  { id: "pinnacle", name: "Pinnacle Ops", text: "Brave the lairs of humanity's greatest foes to secure Sol for the Vanguard and earn sought-after armaments for the battles to come." },
  { id: "crucible", name: "Crucible & Gambit", text: "Test yourself against other Guardians in the Crucible, or race another fireteam to summon and defeat a Primeval in Gambit." },
];
const SECTIONS = [
  ["seasonal", "Seasonal Hub", "Orders, challenges and the reward pass"],
  ["vendors", "Vendors", "What everyone's selling"],
  ["quests", "Quests", "Every quest and bounty you hold"],
  ["friends", "Friends", "Your Bungie.net friends, who's online"],
];
const number = (n) => (n == null ? "–" : Number(n).toLocaleString());
const plain = (s) => String(s ?? "").toLowerCase().replace(/[‘’]/g, "'").replace(/^the\s+/, "").trim();
// Bungie names the Portal's launch entries like "Exodus Crash: Customize" or "The Disgraced: Matchmade"; the part before
// the colon is the activity (the card's tags already say whether it's matchmade).
const titleOf = (a) => String(a.fullName || a.name || "Activity").replace(/\s*:\s*(customize|matchmade)\s*$/i, "").trim() || "Activity";
const hasTrait = (a, name) => (a.traits ?? []).some((t) => t.toLowerCase().includes(name));
// Exotic missions by the rotator's names, compared without "Operation:" and punctuation ("//node.ovrd.AVALON//").
const missionKey = (s) => plain(s).replace(/^operation:\s*/, "").replace(/[^a-z0-9' ]/g, "");
const EXOTIC_MISSIONS = (ROTATORS.find((r) => r.id === "exotic-mission")?.entries ?? []).map((e) => missionKey(e.name)).filter(Boolean);

// Which Ops box an activity goes in, by the owner's rules (3 Oct 2026). Bungie sends no traits on these activities, so
// the activity type does most of the work: PvP is Crucible & Gambit; Onslaught, Prison of Elders and exotic missions are
// Pinnacle; type "Solo Ops" is Solo; Crawls (The Coil, Contest of Elders), Seasonal Arenas and Dares of Eternity are
// Arena; Missions (the Vanguard strikes and the like), strikes and battlegrounds are Fireteam. Bungie's Ops trait last.
function opsOf(a) {
  const type = String(a.type ?? "").toLowerCase();
  const title = plain(titleOf(a));
  const text = `${title} ${type} ${(a.traits ?? []).join(" ")}`.toLowerCase();
  if (a.pvp || /crucible|gambit|trials of osiris|iron banner/.test(text)) return "crucible";
  const mission = missionKey(titleOf(a));
  if (/onslaught|prison of elders|exotic mission/.test(text) || EXOTIC_MISSIONS.some((n) => mission.startsWith(n))) return "pinnacle";
  if (type.includes("solo ops") || hasTrait(a, "solo ops")) return "solo";
  if (/crawl|seasonal arena/.test(type) || /^(dares of eternity|contest of elders|coil)\b/.test(title)) return "arena";
  if (/\bmission\b/.test(type) || /strike|battleground/.test(text)) return "fireteam";
  for (const op of ["arena", "fireteam", "pinnacle"]) if (hasTrait(a, `${op} ops`)) return op;
  return null;
}

// One card per activity: Bungie lists some twice ("Exodus Crash" and "Exodus Crash: Customize"); the featured one, or
// the one with more rewards, is kept.
function unique(list) {
  const seen = new Map();
  for (const a of list) {
    const key = plain(titleOf(a));
    const had = seen.get(key);
    if (!had || (a.featured && !had.featured) || (a.featured === had.featured && a.rewards.length > had.rewards.length)) seen.set(key, a);
  }
  return [...seen.values()];
}
const sorted = (list) => [...list].sort((a, b) => Number(b.featured) - Number(a.featured) || titleOf(a).localeCompare(titleOf(b)));

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
    const op = OPS.find((o) => `ops-${o.id}` === key);
    if (op) return pages.show(`ops-${op.id}-${who}`, op.name, (host) => opsPage(host, op));
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

  // One Ops box's activities as cards (featured first).
  function opsPage(host, op) {
    const paint = () => {
      const list = portal ? sorted(unique(portal.activities.filter((a) => opsOf(a) === op.id))) : [];
      host.replaceChildren(
        el(
          "div",
          { class: "tab dr sh" },
          backdrop(),
          el("header", { class: "sh-top" }, el("div", { class: "sh-top__text" }, el("span", { class: "sh-top__kicker", text: "Ops Categories" }), el("h1", { class: "sh-top__title", text: op.name }))),
          el(
            "div",
            { class: "sh-body" },
            el(
              "div",
              { class: "sh-main" },
              !portal
                ? waiting("portal", "Reading the Portal…")
                : list.length
                  ? el("section", { class: "sh-box" }, label("Activities", `${list.length} · ${list.filter((a) => a.matchmade).length} matchmade`), el("div", { class: "dr-acts" }, ...list.map((a) => activityCard(a, a.type || op.name))))
                  : el("p", { class: "tab__note", text: `Bungie's list has nothing for ${op.name} on this character.` }),
            ),
          ),
        ),
      );
    };
    paint();
    if (!portal) loadPortal(false).then(paint);
  }

  // ---------- Pieces ----------

  // This week's Grandmaster strike from the rotators (seals.report's week, its saved schedule, or the built-in one).
  function grandmasterName() {
    const data = deps.remote?.();
    const def = data?.week?.rotators?.find((r) => r.id === "grandmaster") ?? withSaved(ROTATORS.find((r) => r.id === "grandmaster"), data?.saved?.grandmaster ?? null);
    if (!def) return null;
    const now = rotatorNow(def);
    return now.unknown ? null : now.current?.name ?? null;
  }

  // The five Vanguard alerts, in the owner's order: the Grandmaster alert, this week's dungeon and raid, then Equilibrium
  // and The Desert Perpetual (always featured). Bungie's featured flag wins; the schedules fill in when it's silent.
  function alertPicks() {
    const list = portal?.activities ?? [];
    const weekly = (kind) => featuredRotation().activities.filter((x) => x.kind === kind && !x.always).map((x) => plain(x.name));
    const named = (a, names) => names.some((n) => plain(titleOf(a)).startsWith(n));
    const variant = (a) => (/master|epic|contest|grandmaster|legend/i.test(titleOf(a)) ? 1 : 0);
    // A raid or dungeon of `names`: one Bungie features, else one of this week's (`week`), the normal version first.
    const find = (names, week = null) =>
      list
        .filter((a) => named(a, names) && (!week || a.featured || named(a, week)))
        .sort((x, y) => Number(y.featured) - Number(x.featured) || (week ? Number(named(y, week)) - Number(named(x, week)) : 0) || variant(x) - variant(y))[0] ?? null;
    const gmName = grandmasterName();
    const isGM = (a) => /grandmaster/i.test(`${titleOf(a)} ${a.type ?? ""} ${(a.traits ?? []).join(" ")}`) && !/excision/i.test(titleOf(a));
    const gmScore = (a) => (isGM(a) ? 0 : 4) + (gmName && named(a, [plain(gmName)]) ? 0 : 2) + (a.featured ? 0 : 1);
    const gm = list.filter((a) => isGM(a) || (gmName && named(a, [plain(gmName)]))).sort((x, y) => gmScore(x) - gmScore(y))[0] ?? null;
    const dungeons = weekly("dungeon");
    const raids = weekly("raid");
    return [
      { kicker: "Grandmaster alert", a: gm, expect: gmName ?? "Grandmaster" },
      { kicker: "Weekly dungeon", a: find(DUNGEON_NAMES.map(plain).filter((n) => n !== "equilibrium"), dungeons), expect: DUNGEON_NAMES.find((n) => plain(n) === dungeons[0]) ?? "This week's dungeon" },
      { kicker: "Weekly raid", a: find(RAID_NAMES.map(plain).filter((n) => n !== "desert perpetual"), raids), expect: RAID_NAMES.find((n) => plain(n) === raids[0]) ?? "This week's raid" },
      { kicker: "Dungeon", a: find(["equilibrium"]), expect: "Equilibrium" },
      { kicker: "Raid", a: find(["desert perpetual"]), expect: "The Desert Perpetual" },
    ];
  }

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

  function activityCard(a, kickerText = null) {
    const engrams = a.rewards.filter((r) => /engram/i.test(`${r.name} ${r.typeName}`));
    const weapons = a.rewards.filter((r) => r.kind === 3);
    const rest = a.rewards.filter((r) => !engrams.includes(r) && !weapons.includes(r));
    const art = el("span", { class: "dr-act__art" });
    if (a.image) art.style.backgroundImage = `linear-gradient(180deg, rgba(0,0,0,0) 30%, rgba(0,0,0,0.75)), url("${a.image}")`;
    const kicker = kickerText || (a.traits ?? []).find((t) => /ops/i.test(t)) || a.type || (a.pvp ? "Crucible" : "Activity");
    const reward = (r) => el("span", { class: `dr-reward tier-${r.tier}`, title: `${r.name}${r.typeName ? ` · ${r.typeName}` : ""}${r.quantity > 1 ? ` ×${r.quantity}` : ""}` }, r.icon ? el("img", { src: r.icon, alt: "", loading: "lazy" }) : el("span", { text: r.name.slice(0, 2) }));
    return el(
      "div",
      { class: `dr-act${a.featured ? " is-featured" : ""}` },
      art,
      el("span", { class: "dr-act__kicker", text: kicker }),
      el("div", { class: "dr-act__body" }, el("strong", { class: "dr-act__name", text: titleOf(a) })),
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

  function shortcut(key, name, note) {
    if (key === "friends" && friends) note = `${friends.filter((f) => f.online).length} online · ${friends.length} friends`;
    return el("button", { class: "gd-short", type: "button", onclick: () => open(key) }, el("span", { class: "gd-short__icon" }, glyph(key)), el("span", { class: "gd-short__text" }, el("strong", { text: name }), el("small", { text: note })));
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

  // The five alerts; a slot Bungie's list doesn't have says so (in its place, so the order stays).
  function alerts() {
    const picks = portal ? alertPicks() : [];
    const missing = (p) =>
      el(
        "div",
        { class: "dr-act is-missing" },
        el("span", { class: "dr-act__art" }),
        el("span", { class: "dr-act__kicker", text: p.kicker }),
        el("div", { class: "dr-act__body" }, el("strong", { class: "dr-act__name", text: p.expect })),
        el("p", { class: "dr-act__none", text: "Not in Bungie's list for this character right now." }),
      );
    return el(
      "section",
      { class: "sh-box dr-alerts" },
      label("Vanguard alerts", portal ? `${picks.filter((p) => p.a).length} of ${picks.length}` : null),
      !portal ? waiting("portal", "Reading the Portal from Bungie… (the first time reads every activity, so it takes a little longer)") : el("div", { class: "dr-acts dr-acts--alerts" }, ...picks.map((p) => (p.a ? activityCard(p.a, p.kicker) : missing(p)))),
    );
  }

  // The Ops boxes (the app's look: crest, name, description), each opening its activities.
  function opsBoxes() {
    const info = portal?.traitInfo ?? {};
    const counts = {};
    if (portal) for (const a of unique(portal.activities)) counts[opsOf(a) ?? "none"] = (counts[opsOf(a) ?? "none"] ?? 0) + 1;
    return el(
      "section",
      { class: "sh-box dr-ops-box" },
      label("Ops Categories"),
      el(
        "div",
        { class: "dr-op-list" },
        ...OPS.map((op) => {
          const bungie = Object.entries(info).find(([k]) => k.toLowerCase() === op.name.toLowerCase())?.[1];
          const n = counts[op.id] ?? 0;
          return el(
            "button",
            { class: "gd-short dr-op", type: "button", onclick: () => open(`ops-${op.id}`) },
            el("span", { class: "gd-short__icon has-image" }, glyph(op.id)),
            el("span", { class: "gd-short__text" }, el("strong", { text: op.name }), el("span", { class: "dr-op__desc", text: bungie?.description || op.text }), el("small", { text: !portal ? "Reading…" : n ? `${n} ${n === 1 ? "activity" : "activities"}` : "None listed for this character" })),
          );
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
      el("ul", {}, ...portal.activities.filter((a) => a.featured).map((a) => el("li", { text: `${a.fullName || a.name} · ${a.type ?? "no type"} · ${a.rewards.length} rewards · ${a.traits.join(", ") || "no traits"}` }))),
      el("h3", { text: "Vanguard alerts picked" }),
      el("ul", {}, ...alertPicks().map((p) => el("li", { text: `${p.kicker}: ${p.a ? `${p.a.fullName || p.a.name}${p.a.featured ? " (featured)" : ""}` : `nothing found (expected ${p.expect})`}` }))),
      el("h3", { text: "In no Ops box" }),
      el("ul", {}, ...unique(portal.activities).filter((a) => !opsOf(a)).map((a) => el("li", { text: `${titleOf(a)} · ${a.type ?? "no type"} · ${a.traits.join(", ") || "no traits"}` }))),
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
      el("div", { class: "sh-main" }, newsStrip(), el("div", { class: "dr-sections" }, ...SECTIONS.map(([id, name, note]) => shortcut(id, name, note))), banners(), alerts(), opsBoxes(), check()),
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
