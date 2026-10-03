// The Rotators tab (was Featured), laid out like seals.report's Featured page and styled like the
// Inventory and Seasonal Hub (title band, darkened backdrop, letterspaced labels over a rule,
// bracketed boxes; the sh-* classes come from seasonal.css):
//
//   [ ROTATORS · week of … ........................... weekly reset in … · Grid | List ]
//   [ views:  All / Raids / Dungeons / This week / Today / Checklist ] [ cards or rows    ]
//
// Grid: cards in sections (Raids, Dungeons, This week, Today, Weekly checklist); a card opens its
// row in the list. List: a row per entry that opens to what's next and any caveat. Everything is
// counted from known weeks (src/shell/d2, copied from seals.report) plus seals.report's saved
// corrections; Bungie doesn't publish these schedules.

import { featuredRotation, dreamingCityWeek, distortionSchedule, distortionImages } from "./d2/rotations.js";
import { ROTATORS, withSaved, rotatorNow } from "./d2/rotators.js";

const VIEW_KEY = "mida-rot-view";
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

// The same views and icons as seals.report's Featured sidebar (Everything, Raids, Dungeons, Other activities).
const VIEWS = [
  ["all", "Everything", ["M12 3l3.6 3.6-3.6 3.6-3.6-3.6z", "M12 13.8l3.6 3.6-3.6 3.6-3.6-3.6z", "M6.6 8.4l3.6 3.6-3.6 3.6L3 12z", "M17.4 8.4L21 12l-3.6 3.6-3.6-3.6z"]],
  ["raids", "Raids", ["M6 21V3", "M6 4.2h12l-3 4.2 3 4.2H6"]],
  ["dungeons", "Dungeons", ["M4.8 21V10.8a7.2 7.2 0 0 1 14.4 0V21", "M9 21v-8.4a3 3 0 0 1 6 0V21", "M3 21h18"]],
  ["other", "Other activities", ["M12 6.6a5.4 5.4 0 1 0 0 10.8 5.4 5.4 0 0 0 0-10.8z", "M2.42 15.49a10.2 3.12 -20 1 0 19.17-6.98a10.2 3.12 -20 1 0-19.17 6.98z"]],
];
// Which sections each view shows (the grid's sections are seals.report's: Raids, Dungeons, This week, Today, checklist).
const VIEW_SECTIONS = { all: null, raids: ["raids"], dungeons: ["dungeons"], other: ["week", "today", "checklist"] };
const PIN = ["M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11z", "M12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z"];
const CLOCK = ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", "M12 7v5l3 2"];

export function rotatorsTab(ctx, { until, saved, art = () => ({}) }) {
  const { el, svg } = ctx;
  const now = Date.now();
  let view = read(VIEW_KEY, "all");
  if (!(view in VIEW_SECTIONS)) view = "other"; // the old This week / Today / Checklist views
  const pictures = art();
  const distortionArt = distortionImages(pictures);
  let mode = read(MODE_KEY, "grid");
  let open = null; // the row opened from a card

  // ---------- The week's entries, as one shape: { id, section, kicker, name, place, detail, ends, always, next[], note, unknown } ----------

  const rotation = featuredRotation(now);
  const reset = rotation.activities.find((a) => a.ends)?.ends;
  const weekStart = reset ? new Date(new Date(reset).getTime() - 7 * 24 * 3600e3).toISOString() : null;
  const localDate = (iso) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const localTime = (iso) => new Date(iso).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
  const entries = [];
  for (const a of rotation.activities) {
    entries.push({
      id: `act-${a.name}`,
      section: a.kind === "raid" ? "raids" : "dungeons",
      kicker: a.kind === "raid" ? "Raid" : "Dungeon",
      name: a.name,
      place: a.destination,
      always: a.always,
      ends: a.ends,
      image: pictures[a.name],
      note: a.always ? "Always featured." : `Next week: ${(a.kind === "raid" ? rotation.next.raids : rotation.next.dungeons).join(" and ")}.`,
    });
  }
  const ascendant = ROTATORS.find((r) => r.id === "ascendant");
  const ascendantAt = ascendant ? rotatorNow(withSaved(ascendant, saved()[ascendant.id] ?? null), now) : null;
  const city = dreamingCityWeek(now, saved()[ascendant?.id] && ascendantAt && !ascendantAt.unknown ? ascendantAt.index : null);
  entries.push({
    id: "dreaming-city",
    section: "week",
    kicker: "Dreaming City",
    name: city.ascendant.name,
    place: city.ascendant.location,
    detail: `Curse: ${city.curse.label}`,
    image: pictures["The Dreaming City"],
    ends: city.weekEnd,
    note: "The Ascendant Challenge moves every week on a six-week loop; the curse grows over three weeks, then starts again.",
  });
  const [distortion, ...laterDistortions] = distortionSchedule(now, 7);
  entries.push({
    id: "distortion",
    section: "today",
    kicker: "Distortion · hourly",
    name: distortion.destination,
    place: distortion.activity,
    ends: distortion.end,
    image: distortionArt[distortion.activity],
    next: laterDistortions.map((d) => ({ when: localTime(d.start), name: `${d.destination} · ${d.activity}` })),
  });
  for (const def of ROTATORS) {
    // The Ascendant Challenge is already on the Dreaming City card (which follows it when it's been set).
    if (def.id === "ascendant") continue;
    const rotator = withSaved(def, saved()[def.id] ?? null);
    const at = rotatorNow(rotator, now, 4);
    entries.push({
      id: `rot-${def.id}`,
      section: def.reminder ? "checklist" : def.period === "daily" ? "today" : "week",
      kicker: def.reminder ? "Weekly" : `${def.title}${def.period === "daily" ? " · daily" : ""}`,
      name: def.reminder ? def.title : at.current.name,
      place: def.place,
      detail: at.current.detail,
      ends: at.ends,
      // Like seals.report: the current entry's own activity (a strike, a mission) or one fixed activity.
      image: pictures[def.art === "current" ? (at.unknown ? "" : at.current.name) : def.art ?? ""],
      unknown: at.unknown,
      next: at.next.map((n) => ({ when: localDate(n.starts), name: `${n.entry.name}${n.entry.detail ? ` · ${n.entry.detail}` : ""}` })),
      note: rotator.confirmed || def.reminder ? null : "Worked out from guide sites; may be off.",
    });
  }
  const SECTIONS = [
    ["raids", "Raids"],
    ["dungeons", "Dungeons"],
    ["week", "This week"],
    ["today", "Today"],
    ["checklist", "Weekly checklist"],
  ];

  // ---------- Pieces ----------

  const label = (title, extra) => el("div", { class: "sh-label" }, el("span", { class: "sh-label__text", text: title }), extra ? el("span", { class: "sh-label__count", text: extra }) : null);
  const timeLeft = (e) => (e.always ? el("span", { text: "Always featured" }) : e.ends ? until(ctx, e.ends) : el("span", { text: "" }));

  // The picture strip: the activity's loading-screen art when seals.report has it, else a letter.
  function strip(e) {
    const node = el("span", { class: "rt-card__strip", "aria-hidden": "true" });
    if (e.image) {
      node.style.backgroundImage = `url("${e.image}")`;
      node.classList.add("has-art");
    } else node.append(el("span", { class: "rt-card__glyph", text: e.name.replace(/^The /, "").slice(0, 1) }));
    return node;
  }

  function cardFor(e) {
    return el(
      "button",
      {
        class: `rt-card rt-card--${e.section}${e.unknown ? " is-unknown" : ""}`,
        type: "button",
        title: "Open in the list",
        onclick: () => {
          open = e.id;
          mode = "list";
          write(MODE_KEY, mode);
          draw();
          requestAnimationFrame(() => root.querySelector(`[data-row="${CSS.escape(e.id)}"]`)?.scrollIntoView({ block: "center" }));
        },
      },
      strip(e),
      el("span", { class: "rt-card__kicker", text: e.kicker }),
      el("span", { class: "rt-card__name", text: e.name }),
      e.place ? el("span", { class: "rt-card__place" }, svg(PIN), el("span", { text: e.place })) : null,
      e.detail ? el("span", { class: "rt-card__detail", text: e.detail }) : null,
      el("span", { class: "rt-card__time" }, svg(CLOCK), timeLeft(e)),
    );
  }

  function rowFor(e) {
    const row = el(
      "details",
      { class: `rt-row${e.unknown ? " is-unknown" : ""}`, "data-row": e.id, open: open === e.id || null },
      el(
        "summary",
        { class: "rt-row__head" },
        el("span", { class: "rt-row__kicker", text: e.kicker }),
        el("span", { class: "rt-row__name", text: e.name }),
        e.place ? el("span", { class: "rt-row__place", text: e.place }) : el("span"),
        el("span", { class: "rt-row__time" }, timeLeft(e)),
      ),
      el(
        "div",
        { class: "rt-row__body" },
        e.detail ? el("p", { text: e.detail }) : null,
        e.next?.length ? el("div", { class: "rt-next" }, el("div", { class: "rt-next__title", text: "Coming up" }), ...e.next.map((n) => el("div", { class: "rt-next__row" }, el("span", { class: "rt-next__when", text: n.when }), el("span", { text: n.name })))) : null,
        e.note ? el("p", { class: "tab__note", text: e.note }) : null,
      ),
    );
    row.addEventListener("toggle", () => (open = row.open ? e.id : open === e.id ? null : open));
    return row;
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

  function draw() {
    const shown = SECTIONS.filter(([id]) => !VIEW_SECTIONS[view] || VIEW_SECTIONS[view].includes(id));
    const body = el("div", { class: "rt-main" });
    for (const [id, title] of shown) {
      const list = entries.filter((e) => e.section === id);
      if (!list.length) continue;
      body.append(
        el(
          "section",
          { class: "rt-section" },
          label(title, id === "raids" || id === "dungeons" ? `Next week: ${(id === "raids" ? rotation.next.raids : rotation.next.dungeons).join(" · ")}` : `${list.length}`),
          mode === "grid" ? el("div", { class: "rt-cards" }, ...list.map(cardFor)) : el("div", { class: "sh-box rt-rows" }, ...list.map(rowFor)),
        ),
      );
    }
    body.append(el("p", { class: "tab__note", text: "Bungie doesn't publish these schedules, so they're counted from known weeks, with any corrections made on seals.report. Times are in your time zone." }));
    const nav = el(
      "nav",
      { class: "rt-nav", "aria-label": "Show" },
      ...VIEWS.map(([id, name, icon]) =>
        el(
          "button",
          { class: "rt-nav__item", type: "button", "aria-current": String(view === id), onclick: () => ((view = id), write(VIEW_KEY, id), draw()) },
          svg(icon),
          el("span", { text: name }),
        ),
      ),
    );
    const top = el(
      "header",
      { class: "sh-top" },
      el(
        "div",
        { class: "sh-top__text" },
        el("span", { class: "sh-top__kicker", text: weekStart ? `Week of ${localDate(weekStart)} to ${localDate(reset)}` : "This week" }),
        el("h1", { class: "sh-top__title", text: "Rotators" }),
      ),
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
