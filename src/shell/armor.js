// The Armor optimizer tab (Destiny 2), styled like the Seasonal Hub (sh-* classes from seasonal.css):
//
//   [ ARMOR OPTIMIZER · Hunter ............................................ character picker · refresh ]
//   [ targets: six stat sliders ] [ builds: five pieces, their stats against your targets, set bonuses, Equip ]
//   [ exotic, armor set          ]
//
// Pieces come from the shared inventory read (tabs.js `read`), their six stats from d2_armor (bungie.rs
// `armor_stats`: the numbers Bungie reports now, so mods and masterwork already on a piece are counted). The search
// runs here: per slot, pieces another piece beats on every stat are dropped, then every combination of what's left
// is scored by how close it gets to the targets (each stat counts up to its target), then by its total.

const SLOTS = [
  [3448274439, "Helmet"],
  [3551918588, "Arms"],
  [14239492, "Chest"],
  [20886954, "Legs"],
  [1585787867, "Class item"],
];
const MAX_STAT = 200;
const KEEP = 20; // builds shown
const BUDGET = 2_500_000; // combinations tried at most (a second or less)
const STORE = "mida-armor";
const loadPrefs = () => {
  try {
    return JSON.parse(localStorage.getItem(STORE)) ?? {};
  } catch {
    return {};
  }
};
const savePrefs = (value) => {
  try {
    localStorage.setItem(STORE, JSON.stringify(value));
  } catch {
    // Only a convenience.
  }
};

// Every combination of one piece per slot, best KEEP first. `slots`: five lists of { stats: [6], exotic, set }.
export function bestBuilds(slots, targets, { exotic = "any", set = null, setNeed = 2 } = {}) {
  const fit = (stats) => stats.reduce((sum, v, i) => sum + Math.min(v, targets[i]), 0);
  const total = (stats) => stats.reduce((a, b) => a + b, 0);
  // A piece is dropped when another in its slot (with the same exotic-ness and, with a set chosen, the same in/out of
  // that set) is at least as good on every stat.
  const prune = (list) => {
    const keyOf = (p) => `${p.exotic ? 1 : 0}${set ? (p.set === set ? 1 : 0) : ""}`;
    return list.filter((p, i) => !list.some((q, j) => j !== i && keyOf(q) === keyOf(p) && q.stats.every((v, k) => v >= p.stats[k]) && (q.stats.some((v, k) => v > p.stats[k]) || j < i)));
  };
  let lists = slots.map((list) => {
    let l = list;
    if (exotic === "none") l = l.filter((p) => !p.exotic);
    else if (exotic !== "any") l = l.some((p) => p.hash === exotic) ? l.filter((p) => p.hash === exotic) : l.filter((p) => !p.exotic);
    return prune(l).sort((a, b) => fit(b.stats) - fit(a.stats) || total(b.stats) - total(a.stats));
  });
  if (lists.some((l) => !l.length)) return { builds: [], tried: 0 };
  // Too many to try: trim the longest lists (their weakest pieces) until it fits.
  const size = () => lists.reduce((n, l) => n * l.length, 1);
  while (size() > BUDGET) {
    const longest = lists.reduce((a, l, i) => (l.length > lists[a].length ? i : a), 0);
    lists[longest] = lists[longest].slice(0, Math.max(1, Math.floor(lists[longest].length * 0.85)));
  }
  const builds = [];
  let worst = -Infinity;
  const sums = [0, 0, 0, 0, 0, 0];
  const pick = [];
  const want = exotic !== "any" && exotic !== "none";
  function walk(depth, exotics, inSet) {
    if (depth === 5) {
      if (want && exotics !== 1) return;
      if (set && inSet < setNeed) return;
      let f = 0;
      let t = 0;
      for (let i = 0; i < 6; i++) {
        f += sums[i] < targets[i] ? sums[i] : targets[i];
        t += sums[i];
      }
      const score = f * 10000 + t;
      if (builds.length >= KEEP && score <= worst) return;
      builds.push({ score, fit: f, total: t, stats: sums.slice(), pieces: pick.slice() });
      builds.sort((a, b) => b.score - a.score);
      if (builds.length > KEEP) builds.pop();
      worst = builds[builds.length - 1].score;
      return;
    }
    for (const p of lists[depth]) {
      const e = exotics + (p.exotic ? 1 : 0);
      if (e > 1) continue;
      for (let i = 0; i < 6; i++) sums[i] += p.stats[i];
      pick[depth] = p;
      walk(depth + 1, e, inSet + (set && p.set === set ? 1 : 0));
      for (let i = 0; i < 6; i++) sums[i] -= p.stats[i];
    }
  }
  walk(0, 0, 0);
  return { builds, tried: size() };
}

export function armorTab(ctx, container, { read, loadingView, problemView, characterPicker, lastCharacter }) {
  const { el, svg } = ctx;
  const root = el("div", { class: "tab ao sh" });
  const backdrop = el("div", { class: "inv-backdrop sh-backdrop", "aria-hidden": "true" });
  try {
    const picture = localStorage.getItem("mida-sh-backdrop") || localStorage.getItem("mida-inv-backdrop");
    if (picture) {
      backdrop.style.backgroundImage = `url("${picture}")`;
      backdrop.classList.add("has-picture");
    }
  } catch {
    // The built-in backdrop shows.
  }
  let inv = null;
  let armor = null;
  let prefs = loadPrefs(); // { [classType]: { targets: [6], exotic, set, setNeed } }
  let result = null;
  let busy = null; // { build index, text } while equipping
  let message = null;

  const characters = () => inv?.characters ?? [];
  const chosen = () => (characters().some((c) => c.id === lastCharacter.armor) ? lastCharacter.armor : characters()[0]?.id);
  const character = () => characters().find((c) => c.id === chosen());
  const mine = () => {
    const c = character();
    const saved = prefs[c?.classType] ?? {};
    return { targets: Array.isArray(saved.targets) && saved.targets.length === 6 ? saved.targets.map((v) => Math.max(0, Math.min(MAX_STAT, Number(v) || 0))) : [0, 0, 0, 0, 0, 0], exotic: saved.exotic ?? "any", set: saved.set ?? null, setNeed: saved.setNeed === 4 ? 4 : 2 };
  };
  const setMine = (patch) => {
    const c = character();
    prefs = { ...prefs, [c.classType]: { ...mine(), ...patch } };
    savePrefs(prefs);
  };
  const label = (title, extra) =>
    el("div", { class: "sh-label" }, el("span", { class: "sh-label__text", text: title }), extra == null ? null : extra instanceof Node ? el("span", { class: "sh-label__count" }, extra) : el("span", { class: "sh-label__count", text: extra }));
  const where = (p) => {
    if (p.owner === "vault") return "In the vault";
    const c = characters().find((x) => x.id === p.owner);
    if (p.owner === chosen()) return p.equipped ? "Equipped" : "On this character";
    return c ? `On your ${c.className}` : "";
  };

  // This class's pieces, each with its six stats.
  function pieces() {
    const c = character();
    if (!c || !armor) return SLOTS.map(() => []);
    return SLOTS.map(([bucket]) =>
      (inv.items ?? [])
        .filter((i) => i.bucket === bucket && i.instance && (i.classType === c.classType || i.classType === 3) && armor.pieces[i.instance])
        .map((i) => ({ ...i, stats: armor.pieces[i.instance], exotic: i.tier === 6 })),
    );
  }

  function run() {
    const m = mine();
    const started = performance.now();
    const found = bestBuilds(pieces(), m.targets, m);
    result = { ...found, ms: Math.round(performance.now() - started) };
  }

  function tile(p) {
    const node = el(
      "span",
      { class: `ao-piece tier-${p.tier}${p.masterwork ? " is-mw" : ""}`, title: `${p.name}\n${p.typeName ?? ""}\n${where(p)}` },
      p.icon ? el("img", { src: p.icon, alt: "", loading: "lazy" }) : null,
      p.watermark ? el("img", { class: "ao-piece__mark", src: p.watermark, alt: "", loading: "lazy" }) : null,
      p.owner !== chosen() ? el("i", { class: "ao-piece__away", text: p.owner === "vault" ? "V" : "C", title: where(p) }) : null,
    );
    return node;
  }

  async function equip(build, index) {
    const c = character();
    const todo = build.pieces.filter((p) => !(p.owner === c.id && p.equipped));
    // Exotic last, so the one being replaced comes off first.
    todo.sort((a, b) => Number(a.exotic) - Number(b.exotic));
    message = null;
    for (let i = 0; i < todo.length; i++) {
      const p = todo[i];
      busy = { index, text: `Equipping ${i + 1} of ${todo.length}…` };
      draw();
      const res = await ctx.hub.d2Equip({ hash: p.hash, instance: p.instance, owner: p.owner === "account" ? c.id : p.owner, quantity: 1 }, c.id);
      if (!res?.ok) {
        busy = null;
        message = { error: true, text: `Couldn't equip ${p.name}: ${res?.error ?? "that didn't work."}` };
        return start(true, true);
      }
    }
    busy = null;
    message = { error: false, text: todo.length ? `Equipped on your ${c.className}.` : `Your ${c.className} already wears this.` };
    // Read again first, so the Inventory and the dock pick up the fresh copy.
    await start(true, true);
    window.dispatchEvent(new CustomEvent("mida-inventory-changed", { detail: root }));
  }

  function targetsBox() {
    const m = mine();
    const stats = armor.stats;
    return el(
      "section",
      { class: "sh-box ao-targets" },
      label("Your targets", m.targets.some(Boolean) ? el("button", { class: "linkish", type: "button", text: "Clear", onclick: () => (setMine({ targets: [0, 0, 0, 0, 0, 0] }), run(), draw()) }) : null),
      ...stats.map((s, i) => {
        const value = el("span", { class: "ao-target__value", text: String(m.targets[i]) });
        const slider = el("input", {
          type: "range",
          min: "0",
          max: String(MAX_STAT),
          step: "10",
          value: String(m.targets[i]),
          "aria-label": `${s.name} target`,
          oninput: (e) => (value.textContent = e.target.value),
          onchange: (e) => {
            const t = mine().targets;
            t[i] = Number(e.target.value);
            setMine({ targets: t });
            run();
            draw();
          },
        });
        return el("label", { class: "ao-target" }, el("span", { class: "ao-target__name" }, s.icon ? el("img", { src: s.icon, alt: "" }) : null, el("span", { text: s.name || `Stat ${i + 1}` })), slider, value);
      }),
      el("p", { class: "tab__note", text: "Builds are ranked by how close they get to these (each stat counts up to its target), then by their total. Leave them at 0 for the highest totals." }),
    );
  }

  function choicesBox() {
    const m = mine();
    const all = pieces().flat();
    const exotics = [...new Map(all.filter((p) => p.exotic).map((p) => [p.hash, p.name])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
    const sets = [...new Set(all.map((p) => p.set).filter(Boolean))].map((h) => [h, inv.setNames?.[h] ?? `Set ${h}`]).sort((a, b) => a[1].localeCompare(b[1]));
    const select = (labelText, value, options, onpick) =>
      el(
        "label",
        { class: "ao-choice" },
        el("span", { class: "ao-choice__label", text: labelText }),
        el("select", { class: "select", onchange: (e) => onpick(e.target.value) }, ...options.map(([v, text]) => el("option", { value: String(v), selected: String(v) === String(value) || null, text }))),
      );
    return el(
      "section",
      { class: "sh-box ao-choices" },
      label("Exotic and set"),
      select("Exotic", m.exotic, [["any", "Any (or none)"], ["none", "No exotic"], ...exotics], (v) => (setMine({ exotic: v === "any" || v === "none" ? v : Number(v) }), run(), draw())),
      select("Armor set", m.set ?? "", [["", "Any"], ...sets], (v) => (setMine({ set: v ? Number(v) : null }), run(), draw())),
      m.set ? select("Pieces of that set", m.setNeed, [[2, "At least 2"], [4, "At least 4"]], (v) => (setMine({ setNeed: Number(v) }), run(), draw())) : null,
    );
  }

  function buildRow(b, index) {
    const m = mine();
    const c = character();
    const sets = new Map();
    for (const p of b.pieces) if (p.set) sets.set(p.set, (sets.get(p.set) ?? 0) + 1);
    const setText = [...sets].filter(([, n]) => n >= 2).map(([h, n]) => `${n} × ${inv.setNames?.[h] ?? "set"}`);
    const worn = b.pieces.every((p) => p.owner === c.id && p.equipped);
    const meets = b.stats.every((v, i) => v >= m.targets[i]);
    return el(
      "div",
      { class: `ao-build${worn ? " is-worn" : ""}` },
      el("div", { class: "ao-build__pieces" }, ...b.pieces.map(tile)),
      el(
        "div",
        { class: "ao-build__stats" },
        ...b.stats.map((v, i) => {
          const s = armor.stats[i];
          const short = m.targets[i] > 0 && v < m.targets[i];
          return el("span", { class: `ao-stat${short ? " is-short" : m.targets[i] > 0 ? " is-met" : ""}`, title: `${s.name}: ${v}${m.targets[i] ? ` (target ${m.targets[i]})` : ""}` }, s.icon ? el("img", { src: s.icon, alt: "" }) : el("small", { text: (s.name || "?").slice(0, 3) }), el("strong", { text: String(v) }));
        }),
        el("span", { class: "ao-total", title: "Total of all six" }, el("small", { text: "Total" }), el("strong", { text: String(b.total) })),
      ),
      el(
        "div",
        { class: "ao-build__foot" },
        el("span", { class: "ao-build__note", text: [meets && m.targets.some(Boolean) ? "Meets every target" : null, ...setText].filter(Boolean).join(" · ") }),
        busy?.index === index
          ? el("span", { class: "ao-build__busy", text: busy.text })
          : el("button", { class: `btn btn--small${index === 0 && !worn ? " btn--primary" : ""}`, type: "button", disabled: worn || busy ? true : null, text: worn ? "Wearing it" : `Equip on ${c.className}`, onclick: () => equip(b, index) }),
      ),
    );
  }

  function draw() {
    const c = character();
    const top = el(
      "header",
      { class: "sh-top" },
      el("div", { class: "sh-top__text" }, el("span", { class: "sh-top__kicker", text: c ? `${c.className} · ${c.light ?? ""}` : "" }), el("h1", { class: "sh-top__title", text: "Armor optimizer" })),
      el(
        "div",
        { class: "sh-top__tools" },
        characterPicker(ctx, characters(), chosen(), (id) => {
          lastCharacter.armor = id;
          run();
          draw();
        }),
        el("button", { class: "btn btn--small", type: "button", text: "Refresh", onclick: () => start(true) }),
      ),
    );
    const count = pieces().reduce((n, l) => n + l.length, 0);
    const builds = result?.builds ?? [];
    const results = el(
      "section",
      { class: "sh-box ao-results" },
      label("Best builds", builds.length ? `${builds.length} of ${result.tried.toLocaleString()} tried · ${count} pieces` : null),
      message ? el("p", { class: `ao-message${message.error ? " is-error" : ""}`, role: "status", text: message.text }) : null,
      builds.length
        ? el("div", { class: "ao-builds" }, ...builds.map(buildRow))
        : el("p", { class: "tab__note", text: count ? "No combination fits those choices. Try another exotic or set." : `No ${c?.className ?? ""} armor with stats was found.` }),
      el("p", { class: "tab__note", text: "Stats are what Bungie reports for each piece now, so mods and masterwork already on it are included. V = in the vault, C = on another character; Equip moves them over." }),
    );
    const scroll = root.querySelector(".sh-body")?.scrollTop ?? 0;
    const body = el("div", { class: "sh-body" }, el("div", { class: "ao-layout" }, el("div", { class: "sh-col" }, targetsBox(), choicesBox()), results));
    root.replaceChildren(backdrop, top, body);
    body.scrollTop = scroll;
  }

  async function start(fresh, quiet) {
    if (!quiet && (!inv || fresh)) container.replaceChildren(loadingView(ctx, "Reading your armor from Bungie…", "armor"));
    const [i, a] = await Promise.all([read(ctx, "inventory", fresh), ctx.hub.d2Armor(Boolean(fresh))]);
    if (!i?.ok) return container.replaceChildren(problemView(ctx, i?.error ?? "Something went wrong.", () => start(true)));
    if (!a?.ok) return container.replaceChildren(problemView(ctx, a?.error ?? "Something went wrong.", () => start(true)));
    inv = i.data;
    armor = a.data;
    if (!characters().length) return container.replaceChildren(problemView(ctx, "That account has no Destiny 2 characters.", () => start(true)));
    run();
    draw();
    if (!container.contains(root)) container.replaceChildren(root);
  }
  start(false);
}
