// The Weekly planner tab (Destiny 2), styled like the Seasonal Hub (sh-* classes from seasonal.css):
//
//   [ WEEKLY PLANNER · week of … ............................................ reset in … · refresh ]
//   [ this week: raids, dungeons, Grandmaster, exotic mission, Ascendant Challenge, Xûr          ]
//   [ Hunter: milestones ✓, bounties, my list ] [ Titan: … ] [ Warlock: … ]
//
// Milestones come from d2_planner (each character's weekly checklist, the same as the Seasonal Hub's), bounties from
// the shared "activity" read, this week from the Rotators' schedules. "My list" is the player's own to-dos per
// character, kept on this PC (`mida-planner`); ticks clear themselves at the weekly reset.

import { wallpaper } from "./wallpaper.js";
import { featuredRotation } from "./d2/rotations.js";
import { ROTATORS, withSaved, rotatorNow, lastReset, WEEK_MS } from "./d2/rotators.js";

const STORE = "mida-planner";
const load = () => {
  try {
    return JSON.parse(localStorage.getItem(STORE)) ?? {};
  } catch {
    return {};
  }
};
const save = (value) => {
  try {
    localStorage.setItem(STORE, JSON.stringify(value));
  } catch {
    // Only a convenience.
  }
};
const clean = (text) => String(text ?? "").replace(/\[[^\]]*\]\s*/g, "").trim();
const CLOCK = ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", "M12 7v5l3 2"];

export function plannerTab(ctx, container, { read, loadingView, problemView, until, remote = () => null }) {
  const { el, svg } = ctx;
  const root = el("div", { class: "tab pl sh" });
  const backdrop = wallpaper(ctx, "tab-planner");
  let data = null;
  let activity = null;
  let lists = load(); // { characterId: [{ id, text, doneWeek }] }
  const week = () => lastReset("weekly", Date.now());

  const label = (title, extra) => el("div", { class: "sh-label" }, el("span", { class: "sh-label__text", text: title }), extra != null ? el("span", { class: "sh-label__count", text: extra }) : null);

  // ---------- This week (from the Rotators' schedules) ----------

  function thisWeek() {
    const now = Date.now();
    const r = featuredRotation(now);
    const chips = [];
    for (const a of r.activities.filter((x) => !x.always)) chips.push([a.kind === "raid" ? "Raid" : "Dungeon", a.name]);
    const LABELS = { grandmaster: "Grandmaster", exotic: "Exotic mission", ascendant: "Ascendant Challenge", pantheon: "Pantheon" };
    for (const id of Object.keys(LABELS)) {
      // seals.report's week (with Bungie's confirmations) while it's from after the latest daily reset, else the
      // built-in schedule with the site's saved corrections.
      const r2 = remote();
      const live = r2?.week && Date.parse(r2.week.at) >= lastReset("daily", now) ? r2.week : null;
      const base = ROTATORS.find((x) => x.id === id);
      const rot = (live && (id === "ascendant" ? live.ascendant : live.rotators?.find((x) => x.id === id))) || (base ? withSaved(base, r2?.saved?.[id] ?? null) : null);
      if (!rot) continue;
      const at = rotatorNow(rot, now);
      if (!at.unknown) chips.push([LABELS[id], at.current.name]);
    }
    const friday = lastReset("weekly", now) + 3 * 24 * 3600e3;
    chips.push(["Xûr", now >= friday ? "Here until the reset" : `Arrives ${new Date(friday).toLocaleDateString(undefined, { weekday: "long" })}`]);
    return el("section", { class: "sh-box pl-week" }, label("This week", "Rotators has the rest"), el("div", { class: "pl-chips" }, ...chips.map(([k, v]) => el("span", { class: "pl-chip" }, el("span", { class: "pl-chip__k", text: k }), el("strong", { text: v })))));
  }

  // ---------- A character's column ----------

  function myList(c) {
    const items = lists[c.id] ?? [];
    const w = week();
    const set = (next) => {
      lists = { ...lists, [c.id]: next };
      save(lists);
      draw();
    };
    const input = el("input", { class: "pl-add__input", type: "text", maxlength: "120", placeholder: "Add something to do this week…", "aria-label": `Add a to-do for ${c.className}` });
    const add = () => {
      const text = input.value.trim();
      if (!text) return;
      set([...items, { id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, text, doneWeek: null }]);
    };
    input.addEventListener("keydown", (e) => e.key === "Enter" && add());
    return [
      label("My list", items.length ? `${items.filter((i) => i.doneWeek === w).length} / ${items.length} done` : null),
      el(
        "div",
        { class: "pl-list" },
        ...items.map((i) => {
          const done = i.doneWeek === w;
          return el(
            "div",
            { class: `pl-todo${done ? " is-done" : ""}` },
            el("label", { class: "pl-todo__check" }, el("input", { type: "checkbox", checked: done || null, onchange: (e) => set(items.map((x) => (x.id === i.id ? { ...x, doneWeek: e.target.checked ? w : null } : x))) }), el("span", { text: i.text })),
            el("button", { class: "icon-btn pl-todo__remove", type: "button", title: "Remove", "aria-label": `Remove ${i.text}`, onclick: () => set(items.filter((x) => x.id !== i.id)) }, svg(["M6 6l12 12M18 6L6 18"])),
          );
        }),
        el("div", { class: "pl-add" }, input, el("button", { class: "btn btn--small", type: "button", text: "Add", onclick: add })),
        el("p", { class: "tab__note", text: "Ticks clear at the weekly reset; the list stays." }),
      ),
    ];
  }

  function column(c) {
    const checklist = data.checklists?.[c.id] ?? [];
    const done = checklist.filter((x) => x.done).length;
    const bounties = activity?.bounties?.[c.id] ?? [];
    const ready = bounties.filter((b) => b.complete).length;
    const head = el("div", { class: "pl-head" }, el("span", { class: "pl-head__class", text: c.className }), el("span", { class: "pl-head__light" }, el("i", { text: "◆" }), document.createTextNode(String(c.light ?? ""))));
    if (c.banner) head.style.backgroundImage = `linear-gradient(90deg, rgba(0,0,0,0.25), rgba(0,0,0,0.1)), url("${c.banner}")`;
    return el(
      "section",
      { class: "sh-box pl-col" },
      head,
      label("Weekly milestones", checklist.length ? `${done} / ${checklist.length} done` : null),
      checklist.length
        ? el(
            "div",
            { class: "pl-list" },
            ...checklist.map((x) =>
              el(
                "div",
                { class: `pl-ms${x.done ? " is-done" : ""}`, title: clean(x.description) || x.name },
                el("span", { class: "pl-ms__icon" }, x.icon ? el("img", { src: x.icon, alt: "", loading: "lazy" }) : null),
                el("span", { class: "pl-ms__name", text: x.name }),
                el("span", { class: `pl-ms__state${x.done ? " is-done" : x.known ? "" : " is-unknown"}`, text: x.done ? "Done" : x.known ? "To do" : "–" }),
              ),
            ),
          )
        : el("p", { class: "tab__note", text: "Bungie lists no weekly milestones for this character." }),
      label("Bounties", activity ? (bounties.length ? `${ready} ready · ${bounties.length}` : "None") : "Reading…"),
      bounties.length
        ? el("div", { class: "pl-bounties" }, ...bounties.map((b) => el("span", { class: `pl-bounty${b.complete ? " is-done" : ""}`, title: `${b.name}${b.complete ? " (ready to turn in)" : ""}` }, b.icon ? el("img", { src: b.icon, alt: "", loading: "lazy" }) : null, b.complete ? el("i", { text: "✓" }) : null)))
        : null,
      ...myList(c),
    );
  }

  function draw() {
    const reset = new Date(week() + WEEK_MS).toISOString();
    const top = el(
      "header",
      { class: "sh-top" },
      el("div", { class: "sh-top__text" }, el("span", { class: "sh-top__kicker", text: `Week of ${new Date(week()).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` }), el("h1", { class: "sh-top__title", text: "Weekly planner" })),
      el("div", { class: "sh-top__tools" }, el("span", { class: "rt-reset" }, svg(CLOCK), el("span", { text: "Weekly reset in " }), until(ctx, reset, "")), el("button", { class: "btn btn--small", type: "button", text: "Refresh", onclick: () => start(true) })),
    );
    const cols = el("div", { class: "pl-cols" }, ...data.characters.map(column));
    const scroll = root.querySelector(".sh-body")?.scrollTop ?? 0;
    const body = el("div", { class: "sh-body" }, el("div", { class: "sh-main" }, thisWeek(), cols));
    root.replaceChildren(backdrop, top, body);
    body.scrollTop = scroll;
  }

  async function start(fresh) {
    if (!data || fresh) container.replaceChildren(loadingView(ctx, "Reading your week from Bungie…", "planner"));
    const result = await ctx.hub.d2Planner();
    if (!result?.ok) return container.replaceChildren(problemView(ctx, result?.error ?? "Something went wrong.", () => start(true)));
    data = result.data;
    if (!data.characters?.length) return container.replaceChildren(problemView(ctx, "That account has no Destiny 2 characters.", () => start(true)));
    draw();
    if (!container.contains(root)) container.replaceChildren(root);
    // Bounties fill in once the shared read arrives.
    read(ctx, "activity", fresh).then((r) => {
      if (r?.ok) {
        activity = r.data;
        draw();
      }
    });
  }
  start(false);
}
