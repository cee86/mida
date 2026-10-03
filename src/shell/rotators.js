// The Rotators tab (was Featured): seals.report's Featured page (v0.58) on the Seasonal Hub's look (title band,
// darkened backdrop, letterspaced labels over a rule, bracketed boxes; the sh-* classes come from seasonal.css):
//
//   [ ROTATORS · week of … ........................... weekly reset in … · Grid | List ]
//   [ This week / Everything / a view per section, expansions last ] [ cards or rows   ]
//
// The week comes from src/shell/d2/featured-week.js, an unchanged copy of seals.report's (scripts/sync-d2.sh):
// seals.report sends this week as it works it out with Bungie's live list (`week`), and when that's missing or from
// before the latest daily reset (offline, an old answer) the same code runs here on the saved and built-in schedules.
// Raids, dungeons, the Dreaming City and the hourly Distortion are counted here from known weeks either way.

import { featuredRotation, distortionSchedule, distortionImages } from "./d2/rotations.js";
import { ROTATORS, withSaved, rotatorNow, lastReset } from "./d2/rotators.js";
import { FEATURED_SECTIONS, LANDING_ROWS, LANDING_SECTIONS } from "./d2/featured-sections.js";
import { featuredWeek, artCandidates, DREAMING_CITY_ART } from "./d2/featured-week.js";

const VIEW_KEY = "mida-rot-view2";
const MODE_KEY = "mida-rot-mode";
const SH_BACKDROP = "mida-sh-backdrop";
const INV_BACKDROP = "mida-inv-backdrop";
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

// seals.report's sidebar icons, redrawn on a 24-unit grid (our svg helper draws paths only).
const RING = (r) => `M12 ${12 - r}a${r} ${r} 0 1 0 0 ${2 * r} ${r} ${r} 0 0 0 0-${2 * r}z`;
const ICONS = {
  week: [RING(9), "M12 6.6V12l3.6 2.4"],
  all: ["M12 3l3.6 3.6-3.6 3.6-3.6-3.6z", "M12 13.8l3.6 3.6-3.6 3.6-3.6-3.6z", "M6.6 8.4l3.6 3.6-3.6 3.6L3 12z", "M17.4 8.4L21 12l-3.6 3.6-3.6-3.6z"],
  raids: ["M6 21V3", "M6 4.2h12l-3 4.2 3 4.2H6"],
  dungeons: ["M4.8 21V10.8a7.2 7.2 0 0 1 14.4 0V21", "M9 21v-8.4a3 3 0 0 1 6 0V21", "M3 21h18"],
  pinnacle: ["M12 3l2.16 6.84 6.84 2.16-6.84 2.16L12 21l-2.16-6.84L3 12l6.84-2.16z"],
  "lost-sectors": ["M12 3l7.2 2.64v5.76c0 4.8-3.12 7.92-7.2 9.6-4.08-1.68-7.2-4.8-7.2-9.6V5.64z", "M9 11.4h6M12 8.4v6"],
  distortion: [RING(2.4), RING(6), RING(9.6)],
  crucible: ["M4.8 4.8l14.4 14.4M19.2 4.8L4.8 19.2M3.6 16.2l4.2 4.2M20.4 16.2l-4.2 4.2"],
  vendors: ["M3.6 8.4l8.4-4.8 8.4 4.8v8.4l-8.4 4.8-8.4-4.8z", "M3.6 8.4l8.4 4.8 8.4-4.8M12 13.2v8.4"],
  events: ["M3.6 5.4h16.8v15H3.6z", "M3.6 10.2h16.8M8.4 3v4.8M15.6 3v4.8"],
  expansion: ["M12 3.6l8.4 8.4-8.4 8.4L3.6 12z"],
  misc: [RING(5.4), "M2.42 15.49a10.2 3.12 -20 1 0 19.17-6.98a10.2 3.12 -20 1 0-19.17 6.98z"],
};
const PIN = ["M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11z", "M12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z"];
const CLOCK = [RING(9), "M12 7v5l3 2"];
const SIGHT = [RING(5.4), "M12 2v4.2M12 17.8V22M2 12h4.2M17.8 12H22"];

// The week: seals.report's answer when it's current, else worked out here (same code, without Bungie's live list).
function weekFrom(remote, now) {
  if (remote?.week && Date.parse(remote.week.at) >= lastReset("daily", now)) return { ...remote.week, live: true };
  const saved = remote?.saved ?? {};
  return { ...featuredWeek(ROTATORS.map((def) => withSaved(def, saved[def.id] ?? null)), null, now), live: false };
}

export function rotatorsTab(ctx, { until, remote = () => null }) {
  const { el, svg } = ctx;
  const now = Date.now();
  const data = remote();
  const art = data?.art ?? {};
  const week = weekFrom(data, now);
  let view = read(VIEW_KEY, "week");
  let mode = read(MODE_KEY, "grid");
  let open = null; // the row opened from a card

  // ---------- This week's cards, by section ----------

  const rotation = featuredRotation(now);
  const reset = rotation.activities.find((a) => a.ends)?.ends;
  const weekStart = reset ? new Date(new Date(reset).getTime() - 7 * 24 * 3600e3).toISOString() : null;
  const localDate = (iso) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const localDay = (iso) => new Date(iso).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  const localTime = (iso) => new Date(iso).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });

  // Rotators with where they are now; the Dares loot pool rides on the Dares card (seals.report v0.54).
  const all = [...(week.rotators ?? []), ...(week.events ?? []), ...(week.weekend ?? [])].map((r) => ({ ...r, ...rotatorNow(r, now) }));
  const pool = all.find((r) => r.id === "dares-loot");
  const rotators = all.filter((r) => r.id !== "dares-loot").map((r) => (r.id === "dares" && pool && !pool.unknown ? { ...r, loot: pool.current } : r));
  const ascendantApi = week.ascendant?.source === "bungie";
  const city = week.week;
  const [distortion, ...laterDistortions] = distortionSchedule(now, 7);
  const distortionArt = distortionImages(art);

  // Every card: { id, section, kicker, name, lines[], chip, image, ends, startsAt, always, api, row }.
  const cards = [];
  for (const a of rotation.activities) {
    cards.push({ id: `act-${a.name}`, section: a.kind === "raid" ? "raids" : "dungeons", kicker: a.kind === "raid" ? "Raid" : "Dungeon", name: a.name, lines: a.destination ? [{ kind: "place", text: a.destination }] : [], image: art[a.name], ends: a.ends, always: a.always, api: false, row: `act-${a.name}` });
  }
  if (city) {
    cards.push({
      id: "dreaming-city",
      section: "forsaken",
      kicker: "Forsaken",
      name: "Dreaming City",
      lines: [{ kind: "info", text: `Ascendant Challenge: ${city.ascendant.name}` }, { kind: "info", text: city.curse.label }, { kind: "place", text: `Petra: ${city.petra}` }],
      image: art[DREAMING_CITY_ART],
      ends: city.weekEnd,
      api: ascendantApi,
      row: "dreaming-city",
    });
  }
  cards.push({ id: "distortion", section: "distortion", kicker: "Distortion", name: distortion.destination, lines: [{ kind: "info", text: `${distortion.activity} armor and weapons, hourly` }], image: distortionArt[distortion.activity], ends: distortion.end, api: false, row: "distortion" });
  for (const r of rotators) {
    const row = `rot-${r.id}`;
    if (r.lanes) {
      // Several at once (the Lost Sectors): a card each, all opening the same row.
      for (const l of r.lanes) cards.push({ id: `${row}-${l.label}`, section: r.section, kicker: r.kicker, name: l.name, lines: [{ kind: "place", text: l.label }], image: art[l.name], ends: r.ends, api: r.source === "bungie", row });
      continue;
    }
    // How seals.report's card reads (FeaturedCards.js): the entry as the title, or the activity with the entry under it.
    const kind = r.detailKind ?? (r.detailIsPlace ? "place" : "weapon");
    const entry = r.current.name.startsWith(`${r.title}: `) ? r.current.name.slice(r.title.length + 2) : r.current.name;
    const lines = [];
    let name = r.title;
    if (r.unknown) lines.push({ kind: "info", text: r.period === "daily" ? "Not set today" : "Not set this week" });
    else if (r.titleIsEntry) name = r.current.name;
    else if (!r.reminder && entry !== r.title) lines.push({ kind: "info", text: `${r.namePrefix ?? ""}${entry}` });
    const detail = r.unknown ? null : r.current.detail;
    if (detail && kind === "weapon" && !r.reminder) lines.push({ kind: "weapon", text: detail });
    if (detail && (kind === "text" || r.reminder)) lines.push({ kind: "info", text: detail });
    const place = kind === "place" && detail ? [detail, r.place].filter(Boolean).join(", ") : r.place;
    if (place) lines.push({ kind: "place", text: place });
    cards.push({
      id: row,
      section: r.section ?? "events",
      kicker: r.kicker,
      name,
      lines,
      chip: r.loot ? { label: r.loot.name.replace(/^Pool/, "Loot pool"), detail: r.loot.detail, items: r.loot.items ?? [] } : null,
      image: artCandidates(r).map((n) => art[n]).find(Boolean),
      ends: r.ends,
      startsAt: r.startsAt && Date.parse(r.startsAt) > now ? r.startsAt : null,
      unknown: r.unknown,
      api: r.source === "bungie",
      row,
    });
  }

  // ---------- Views ----------

  const filled = new Set(cards.map((c) => c.section));
  const VIEWS = [
    { id: "week", label: "This week" },
    { id: "all", label: "Everything" },
    ...FEATURED_SECTIONS.filter((s) => filled.has(s.id)).map((s) => ({ id: s.id, label: s.title, expansion: Boolean(s.expansion) })),
  ].sort((a, b) => Number(Boolean(a.expansion)) - Number(Boolean(b.expansion)));
  if (!VIEWS.some((v) => v.id === view)) view = "week";
  const shows = (section) => view === "all" || view === section || (view === "week" && LANDING_SECTIONS.has(section));
  const titles = new Map(FEATURED_SECTIONS.map((s) => [s.id, s.title]));

  // ---------- Pieces ----------

  const label = (title, extra) => el("div", { class: "sh-label" }, el("span", { class: "sh-label__text", text: title }), extra ? el("span", { class: "sh-label__count", text: extra }) : null);
  const tag = (api) => el("span", { class: `rt-tag${api ? " is-api" : ""}`, title: api ? "Confirmed by Bungie's weekly list" : "From the site's own schedule", text: api ? "API" : "Manual" });
  const timeLeft = (c) =>
    c.always ? el("span", { text: "Always featured" }) : c.startsAt ? el("span", {}, document.createTextNode("Starts in "), until(ctx, c.startsAt, "")) : c.ends ? until(ctx, c.ends) : el("span", { text: "" });

  function goTo(rowId) {
    open = rowId;
    mode = "list";
    write(MODE_KEY, mode);
    draw();
    requestAnimationFrame(() => root.querySelector(`[data-row="${CSS.escape(rowId)}"]`)?.scrollIntoView({ block: "center" }));
  }

  function cardFor(c) {
    const strip = el("span", { class: "rt-card__strip", "aria-hidden": "true" });
    if (c.image) {
      strip.style.backgroundImage = `url("${c.image}")`;
      strip.classList.add("has-art");
    } else strip.append(el("span", { class: "rt-card__glyph" }));
    strip.append(el("span", { class: "rt-card__kicker", text: c.kicker }));
    return el(
      "button",
      { class: `rt-card${c.unknown ? " is-unknown" : ""}`, type: "button", title: "Open in the list", onclick: () => goTo(c.row) },
      strip,
      el("span", { class: "rt-card__name", text: c.name }),
      ...c.lines.map((l) =>
        l.kind === "weapon"
          ? el("span", { class: "rt-card__line is-weapon" }, svg(SIGHT), el("span", { text: l.text }))
          : l.kind === "place"
            ? el("span", { class: "rt-card__line" }, svg(PIN), el("span", { text: l.text }))
            : el("span", { class: "rt-card__line is-info", text: l.text }),
      ),
      c.chip
        ? el(
            "span",
            { class: "rt-chip", tabindex: "0" },
            c.chip.label,
            el("span", { class: "rt-chip__pool", "aria-hidden": "true" }, el("strong", { text: c.chip.label }), c.chip.detail ? el("span", { text: c.chip.detail }) : null, el("span", { class: "rt-chip__items" }, ...c.chip.items.map((i) => el("span", { text: i })))),
          )
        : null,
      el("span", { class: "rt-card__foot" }, el("span", { class: `rt-card__time${c.always ? " is-plain" : ""}` }, svg(CLOCK), timeLeft(c)), tag(c.api)),
    );
  }

  // A row in the list: a summary line that opens to what's on now, what's next and any caveat.
  function rowFor(id, { title, badge, api, summary, body }) {
    const row = el(
      "details",
      { class: "rt-row", "data-row": id, open: open === id || null },
      el("summary", { class: "rt-row__head" }, el("span", { class: "rt-row__name", text: title }), el("span", { class: "rt-row__badge", text: badge }), tag(api), el("span", { class: "rt-row__now", text: summary })),
      el("div", { class: "rt-row__body" }, ...body.filter(Boolean)),
    );
    row.addEventListener("toggle", () => (open = row.open ? id : open === id ? null : open));
    return row;
  }
  const fact = (name, value) => (value ? el("div", { class: "rt-fact" }, el("span", { class: "rt-fact__name", text: name }), el("span", { text: value })) : null);
  const nextList = (items) => (items.length ? el("div", { class: "rt-next" }, el("div", { class: "rt-next__title", text: "Coming up" }), ...items.map((n) => el("div", { class: "rt-next__row" }, el("span", { class: "rt-next__when", text: n.when }), el("span", { text: n.name })))) : null);

  function rotatorRow(r) {
    const daily = r.period === "daily";
    const event = r.period === "event";
    const starts = r.startsAt && Date.parse(r.startsAt) > now;
    return rowFor(`rot-${r.id}`, {
      title: r.title,
      badge: event ? r.kicker || "Event" : daily ? "Daily" : "Weekly",
      api: r.source === "bungie",
      summary: starts ? `Starts ${localDay(r.startsAt)}` : r.current.name,
      body: [
        el("p", { class: "rt-now" }, el("span", { class: "rt-now__label", text: starts ? `Starts ${localDay(r.startsAt)}` : event ? `On until ${localDay(r.ends)}` : daily ? "Today" : "This week" }), el("strong", { text: r.current.name }), r.current.detail ? el("span", { text: r.current.detail }) : null, r.place ? el("span", { class: "rt-now__place", text: r.place }) : null),
        r.lanes
          ? el(
              "table",
              { class: "rt-lanes" },
              el("thead", {}, el("tr", {}, el("th", { text: "Destination" }), el("th", { text: daily ? "Today" : "This week" }), el("th", { text: daily ? "Tomorrow" : "Next week" }))),
              el("tbody", {}, ...r.lanes.map((l) => el("tr", {}, el("th", { text: l.label }), el("td", { text: l.name }), el("td", { text: l.next ?? "" })))),
            )
          : null,
        r.loot ? el("p", { class: "rt-items" }, el("span", { class: "rt-now__label", text: r.loot.name.replace(/^Pool/, "Loot pool") }), (r.loot.items ?? []).join(" · ")) : null,
        r.current.items?.length ? el("p", { class: "rt-items" }, el("span", { class: "rt-now__label", text: "Weapons" }), r.current.items.join(" · ")) : null,
        nextList((r.next ?? []).map((n) => ({ when: localDay(n.starts), name: `${n.entry.name}${n.entry.detail ? ` · ${n.entry.detail}` : ""}` }))),
        r.confirmed ? null : el("p", { class: "tab__note", text: "Worked out from guide sites; it may be off until it's checked against the game." }),
      ],
    });
  }

  // ---------- Drawing ----------

  const root = el("div", { class: "tab rt sh" });
  const backdrop = el("div", { class: "inv-backdrop sh-backdrop", "aria-hidden": "true" });
  let picture = null;
  try {
    picture = localStorage.getItem(SH_BACKDROP) || localStorage.getItem(INV_BACKDROP);
  } catch {
    // The built-in backdrop shows.
  }
  if (picture) {
    backdrop.style.backgroundImage = `url("${picture}")`;
    backdrop.classList.add("has-picture");
  }

  function gridView() {
    const bySection = new Map(FEATURED_SECTIONS.map((s) => [s.id, []]));
    for (const c of cards) if (shows(c.section)) (bySection.get(c.section) ?? bySection.get("events")).push(c);
    const layout = view === "week" ? LANDING_ROWS : FEATURED_SECTIONS.map((s) => [s.id]);
    const sectionEl = (id, inRow) => {
      const list = bySection.get(id);
      const extra = id === "raids" || id === "dungeons" ? `Next week: ${(id === "raids" ? rotation.next.raids : rotation.next.dungeons).join(" · ")}` : null;
      const s = el("section", { class: `rt-section${inRow ? " is-inrow" : ""}` }, label(titles.get(id), extra), el("div", { class: "rt-cards" }, ...list.map(cardFor)));
      if (inRow) s.style.setProperty("--n", String(list.length));
      return s;
    };
    return layout.flatMap((row) => {
      const ids = row.filter((id) => bySection.get(id)?.length);
      if (!ids.length) return [];
      return ids.length > 1 ? [el("div", { class: "rt-rowset" }, ...ids.map((id) => sectionEl(id, true)))] : [sectionEl(ids[0], false)];
    });
  }

  function listView() {
    const out = [];
    for (const sec of FEATURED_SECTIONS) {
      if (!shows(sec.id)) continue;
      const rows = [];
      if (sec.id === "raids" || sec.id === "dungeons") {
        for (const a of rotation.activities.filter((x) => (x.kind === "raid") === (sec.id === "raids"))) {
          rows.push(rowFor(`act-${a.name}`, { title: a.name, badge: a.always ? "Always featured" : "This week", api: false, summary: a.destination ?? "", body: [fact("Where", a.destination), a.always ? null : fact("Next week", (a.kind === "raid" ? rotation.next.raids : rotation.next.dungeons).join(" and "))] }));
        }
      }
      if (sec.id === "forsaken" && city) {
        rows.push(
          rowFor("dreaming-city", {
            title: "Dreaming City",
            badge: "Weekly",
            api: ascendantApi,
            summary: `${city.ascendant.name}, ${city.curse.label}`,
            body: [fact("Ascendant Challenge", `${city.ascendant.name}, ${city.ascendant.location}`), fact("Curse", city.curse.label), fact("Petra", city.petra), fact("Blind Well", city.blindWell), fact("Weekly mission", city.mission), el("p", { class: "tab__note", text: "The curse, Petra, the Blind Well and the weekly mission run on a three-week cycle and the Ascendant Challenge on a six-week one." })],
          }),
        );
      }
      if (sec.id === "distortion") {
        rows.push(rowFor("distortion", { title: `Distortion: ${distortion.destination}`, badge: "Hourly", api: false, summary: distortion.activity, body: [fact("Right now", `${distortion.destination} · ${distortion.activity}`), nextList(laterDistortions.map((d) => ({ when: localTime(d.start), name: `${d.destination} · ${d.activity}` })))] }));
      }
      for (const r of rotators.filter((x) => (x.section ?? "events") === sec.id)) rows.push(rotatorRow(r));
      if (rows.length) out.push(el("section", { class: "rt-section" }, label(sec.title, `${rows.length}`), el("div", { class: "sh-box rt-rows" }, ...rows)));
    }
    return out;
  }

  function draw() {
    const body = el("div", { class: "rt-main" }, ...(mode === "grid" ? gridView() : listView()));
    body.append(
      el("p", {
        class: "tab__note",
        text: week.live
          ? "From seals.report, with what Bungie's weekly list confirms tagged API. Raids, dungeons and the Distortion are counted from known weeks. Times are in your time zone."
          : "Counted from known weeks and seals.report's saved schedules (Bungie's weekly list couldn't be read just now). Times are in your time zone.",
      }),
    );
    let lastExpansion = false;
    const nav = el("nav", { class: "rt-nav", "aria-label": "Show" });
    for (const v of VIEWS) {
      if (v.expansion && !lastExpansion) nav.append(el("span", { class: "rt-nav__group", text: "Expansions" }));
      lastExpansion = v.expansion;
      nav.append(
        el(
          "button",
          { class: `rt-nav__item${v.expansion ? " is-minor" : ""}`, type: "button", "aria-current": String(view === v.id), onclick: () => ((view = v.id), write(VIEW_KEY, v.id), draw()) },
          svg(ICONS[v.expansion ? "expansion" : v.id] ?? ICONS.expansion),
          el("span", { text: v.label }),
        ),
      );
    }
    const top = el(
      "header",
      { class: "sh-top" },
      el("div", { class: "sh-top__text" }, el("span", { class: "sh-top__kicker", text: weekStart ? `Week of ${localDate(weekStart)} to ${localDate(reset)}` : "This week" }), el("h1", { class: "sh-top__title", text: "Rotators" })),
      el(
        "div",
        { class: "sh-top__tools" },
        reset ? el("span", { class: "rt-reset" }, svg(CLOCK), el("span", { text: "Weekly reset in " }), until(ctx, reset, "")) : null,
        el(
          "div",
          { class: "segmented", role: "group", "aria-label": "View" },
          ...[["grid", "Grid"], ["list", "List"]].map(([id, text]) => el("button", { type: "button", "aria-pressed": String(mode === id), text, onclick: () => ((mode = id), write(MODE_KEY, id), draw()) })),
        ),
      ),
    );
    const scroll = root.querySelector(".sh-body")?.scrollTop ?? 0;
    const scroller = el("div", { class: "sh-body" }, el("div", { class: "rt-layout" }, nav, body));
    root.replaceChildren(backdrop, top, scroller);
    scroller.scrollTop = scroll;
  }
  draw();
  return root;
}
