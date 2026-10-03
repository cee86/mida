// The Seasonal Hub tab (Destiny 2), from the owner's mock-up of the game's hub, styled like the
// Inventory (a title band, a darkened blurred backdrop, letterspaced section labels over a rule
// with a diamond and a bright stretch):
//
//   [ SEASONAL HUB · season name ............................... character · refresh ]
//   [ active orders        ] [ weekly rewards ........................ ]  [ bounties  ]
//   [                      ] [ daily / weekly reset countdowns        ]  [ on this   ]
//   [                      ] [ guardian rank    ] [ clan this week    ]  [ character ]
//   [ weekly checklist, across the whole width                        ]  [           ]
//   ( rank ) PASS NAME [past ▾] [ season pass rewards: a column per rank ] [         ]
//   [ rewards to claim: this pass | every pass, with Claim buttons       ]  [           ]
//   then Bungie's alerts and a data check, folded away.
//
// Data: the shared "activity" read (quests, bounties, artifact, alerts) plus d2_seasonal (pass
// track, past passes, claimable rewards, objectives, vendors, other reward tracks), d2_pass for a
// past pass and d2_claim to claim a reward. How Bungie lays out the 2025-26 hub couldn't be checked
// from the build workspace: sections that find nothing say so, and the data check lists what was
// found for tuning.

const DAY = 24 * 3600e3;
const SH_BACKDROP = "mida-sh-backdrop";
const INV_BACKDROP = "mida-inv-backdrop";

// Destiny's resets: daily at 17:00 UTC, weekly on Tuesdays at 17:00 UTC.
function nextDaily(now = Date.now()) {
  const d = new Date(now);
  const reset = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 17);
  return new Date(reset > now ? reset : reset + DAY).toISOString();
}
function nextWeekly(now = Date.now()) {
  let t = new Date(nextDaily(now)).getTime();
  while (new Date(t).getUTCDay() !== 2) t += DAY;
  return new Date(t).toISOString();
}

// Bungie writes icons into text as [Void], [Headshot], [Stasis]...: plain text drops them; rich
// text draws the elements as small coloured diamonds (like the item tiles) and drops the rest.
const clean = (text) => String(text ?? "").replace(/\[[^\]]*\]\s*/g, "").trim();
const ELEMENT_TOKENS = ["arc", "solar", "void", "stasis", "strand", "kinetic"];
const percent = (o) => (o.goal > 0 ? Math.min(100, Math.round((o.progress / o.goal) * 100)) : o.complete ? 100 : 0);
const TIER_NAMES = { 6: "Exotic", 5: "Legendary", 4: "Rare", 3: "Uncommon", 2: "Common" };

export function seasonalHub(ctx, container, { read, loadingView, problemView, progressBar, until, characterPicker, questCard, lastCharacter }) {
  const { el, svg } = ctx;
  const root = el("div", { class: "tab tab--seasonal sh" });
  const backdrop = el("div", { class: "inv-backdrop sh-backdrop", "aria-hidden": "true" });
  const tip = el("div", { class: "sh-tip", role: "tooltip", hidden: true });
  let activity = null;
  const hubs = {}; // per character
  const passes = {}; // per character + pass hash
  let shownPass = null; // a past pass picked in the dropdown
  let claimScope = "current";
  const claiming = new Set();
  let hubBar = null; // the progress bar shown while a character's hub is read

  const chosen = () => (activity.characters.some((c) => c.id === lastCharacter.seasonal) ? lastCharacter.seasonal : activity.characters[0]?.id);

  // ---------- Pieces ----------

  // A section: label (name, count) over the geometric rule, then its content.
  function section(title, extra, ...children) {
    return el("section", { class: "sh-box" }, label(title, extra), ...children);
  }
  function label(title, extra) {
    return el("div", { class: "sh-label" }, el("span", { class: "sh-label__text", text: title }), extra ? el("span", { class: "sh-label__count" }, ...[].concat(extra)) : null);
  }
  function meter(pct, cls = "") {
    const fill = el("span", { class: cls });
    fill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
    return el("span", { class: "sh-meter", role: "progressbar", "aria-valuenow": String(pct), "aria-valuemin": "0", "aria-valuemax": "100" }, fill);
  }
  const note = (text) => el("p", { class: "tab__note", text });
  function rich(text, cls) {
    const node = el("span", { class: cls, title: clean(text) });
    for (const part of String(text ?? "").split(/(\[[^\]]*\])/)) {
      const token = part.match(/^\[([^\]]*)\]$/);
      if (!token) {
        if (part.trim()) node.append(document.createTextNode(part.replace(/^\s+/, node.childNodes.length ? " " : "")));
        continue;
      }
      const word = token[1].trim().toLowerCase();
      if (ELEMENT_TOKENS.includes(word)) node.append(el("i", { class: `sh-el sh-el--${word}`, title: token[1] }));
    }
    return node;
  }

  // A reward tile; hovering (or focusing) shows its card.
  function rewardTile(w, context = "") {
    const node = el(
      "span",
      { class: `sh-tile sh-tile--t${w.tier ?? 0}${w.claimed ? " is-claimed" : w.earned ? " is-earned" : ""}`, tabindex: "0", "aria-label": w.name },
      w.icon ? el("img", { src: w.icon, alt: "", loading: "lazy" }) : null,
      w.quantity > 1 ? el("span", { class: "sh-tile__qty", text: Number(w.quantity).toLocaleString() }) : null,
      w.claimed ? el("span", { class: "sh-tile__check", text: "✓" }) : w.claimable ? el("span", { class: "sh-tile__dot", "aria-hidden": "true" }) : null,
    );
    const show = () => showTip(node, w, context);
    node.addEventListener("pointerenter", show);
    node.addEventListener("focus", show);
    node.addEventListener("pointerleave", hideTip);
    node.addEventListener("blur", hideTip);
    return node;
  }

  function showTip(anchor, w, context) {
    const status = w.claimed ? "Claimed" : w.claimable ? "Earned, ready to claim" : w.earned ? "Earned" : "Not earned yet";
    tip.className = `sh-tip sh-tip--t${w.tier ?? 0}`;
    tip.replaceChildren(
      el("div", { class: "sh-tip__head" }, el("strong", { text: w.name || "Reward" }), el("span", { text: [w.typeName, TIER_NAMES[w.tier]].filter(Boolean).join(" · ") })),
      el(
        "div",
        { class: "sh-tip__body" },
        w.quantity > 1 ? el("div", { class: "sh-tip__qty", text: `×${Number(w.quantity).toLocaleString()}` }) : null,
        w.description ? el("p", { text: w.description }) : null,
        el("div", { class: "sh-tip__meta", text: [context, w.rank ? `Rank ${w.rank}` : w.step ? `Step ${w.step}` : "", w.premium === true ? "Pass reward" : w.premium === false ? "Free reward" : "", status].filter(Boolean).join(" · ") }),
      ),
    );
    tip.hidden = false;
    const box = root.getBoundingClientRect();
    const a = anchor.getBoundingClientRect();
    const w2 = tip.offsetWidth;
    const h = tip.offsetHeight;
    let left = a.right - box.left + 8;
    if (left + w2 > box.width - 8) left = a.left - box.left - w2 - 8;
    let top = a.top - box.top;
    if (top + h > box.height - 8) top = box.height - h - 8;
    tip.style.left = `${Math.max(8, left)}px`;
    tip.style.top = `${Math.max(8, top)}px`;
  }
  function hideTip() {
    tip.hidden = true;
  }

  // ---------- Orders ----------

  function orders(hub) {
    const c = chosen();
    const fromQuests = [...(activity.quests[c] ?? []), ...(activity.bounties[c] ?? [])].filter((q) => /\border/i.test(`${q.typeName} ${q.name}`));
    const list = [...(hub?.orders ?? []), ...fromQuests];
    const body = list.length
      ? el(
          "div",
          { class: "sh-orders" },
          ...list.map((q) =>
            el(
              "div",
              { class: `sh-order${q.complete ? " is-done" : ""}` },
              el("span", { class: "sh-order__icon" }, q.icon ? el("img", { src: q.icon, alt: "", loading: "lazy" }) : null),
              el(
                "div",
                { class: "sh-order__text" },
                el("div", { class: "sh-order__name" }, el("span", { text: q.name }), q.typeName ? el("span", { class: `sh-order__kind sh-order__kind--t${q.tier ?? 0}`, text: q.typeName }) : null),
                ...(q.objectives ?? []).map((o) =>
                  el(
                    "div",
                    { class: `sh-obj${o.complete ? " is-done" : ""}` },
                    el("span", { class: "sh-obj__box", "aria-hidden": "true" }),
                    rich(o.text || "Progress", "sh-obj__text"),
                    // Orders show a percentage, like the game (their raw counts run into the hundreds of thousands).
                    el("span", { class: "sh-obj__value", text: `${percent(o)}%` }),
                    meter(percent(o), "sh-obj__fill"),
                  ),
                ),
              ),
            ),
          ),
        )
      : note(hub ? "No orders found on this character (see the data check below)." : "Reading…");
    return el(
      "div",
      { class: "sh-col" },
      section("Active orders", list.length ? String(list.length) : null, body),
    );
  }

  // When the daily and weekly content turns over.
  function resets() {
    const clock = () => svg(["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", "M12 7v5l3 2"]);
    return el(
      "div",
      { class: "sh-resets" },
      el("div", { class: "sh-timer" }, clock(), el("span", { text: "Daily reset in " }), until(ctx, nextDaily(), "")),
      el("div", { class: "sh-timer" }, clock(), el("span", { text: "Weekly reset in " }), until(ctx, nextWeekly(), "")),
    );
  }

  function weeklyRewards(hub) {
    const track = hub?.weeklyRewards;
    if (!track) return section("Weekly rewards", null, note(hub ? "Not found in Bungie's data yet (see the data check below)." : "Reading…"));
    const level = track.level ?? 0;
    return section(
      "Weekly rewards",
      track.levelCap ? `${level} / ${track.levelCap}` : null,
      track.guess ? note("Taken from the weekly objectives' own reward list; one step per completed objective is a guess.") : null,
      el(
        "div",
        { class: "sh-steps" },
        ...track.rewards.map((w, i) =>
          el("div", { class: `sh-step${w.earned || level >= (w.step ?? i + 1) ? " is-earned" : ""}` }, el("span", { class: "sh-step__n", text: String(w.step ?? i + 1) }), el("span", { class: "sh-step__bar" }), rewardTile(w, "Weekly reward")),
        ),
      ),
    );
  }

  // ---------- Season pass ----------

  function ring(rank, pct) {
    const ns = "http://www.w3.org/2000/svg";
    const s = document.createElementNS(ns, "svg");
    s.setAttribute("viewBox", "0 0 120 120");
    s.setAttribute("class", "sh-ring__art");
    const mk = (r, cls, extra = {}) => {
      const c = document.createElementNS(ns, "circle");
      Object.entries({ cx: 60, cy: 60, r, class: cls, ...extra }).forEach(([k, v]) => c.setAttribute(k, v));
      return c;
    };
    const len = 2 * Math.PI * 52;
    s.append(mk(57, "sh-ring__outer"), mk(52, "sh-ring__track"), mk(52, "sh-ring__fill", { "stroke-dasharray": `${(len * pct) / 100} ${len}`, transform: "rotate(-90 60 60)" }), mk(45, "sh-ring__inner"));
    return el("div", { class: "sh-ring", title: `${pct}% to the next rank` }, s, el("span", { class: "sh-ring__label", text: "Rank" }), el("span", { class: "sh-ring__rank", text: String(rank ?? 0) }));
  }



  function passHeader(hub, pass) {
    const options = hub?.passes ?? [];
    const currentHash = options.find((o) => o.current)?.hash;
    const pct = pass?.next ? Math.round(((pass.progress ?? 0) / pass.next) * 100) : 0;
    const select = el(
      "select",
      {
        class: "select sh-pass__pick",
        "aria-label": "Season pass",
        onchange: (event) => {
          const hash = Number(event.target.value);
          shownPass = currentHash === hash ? null : options.find((p) => p.hash === hash) ?? null;
          draw();
        },
      },
      ...options.map((p) => el("option", { value: String(p.hash), selected: (shownPass?.hash ?? currentHash) === p.hash || null, text: `${p.number ? `Season ${p.number}: ` : ""}${p.season}${p.current ? " (current)" : ""}` })),
    );
    // What the bonuses box used to say, as one line under the pass name.
    const facts = [];
    if (pass) {
      facts.push(pass.premium === true ? "Rewards pass active" : pass.premium === false ? "Rewards pass not owned" : null);
      const extra = (pass.rank ?? 0) - (pass.trackRank ?? 0);
      if (extra > 0) facts.push(`${extra} ranks past the track`);
    }
    const endsSoon = hub?.season?.passEnds && new Date(hub.season.passEnds).getTime() - Date.now() < 400 * DAY;
    const status = el("div", { class: "sh-pass__facts" }, ...facts.filter(Boolean).map((f) => el("span", { text: f })), !shownPass && endsSoon ? el("span", {}, document.createTextNode("Pass ends in "), until(ctx, hub.season.passEnds, "")) : null);
    return el(
      "div",
      { class: "sh-pass" },
      ring(pass?.tracked === false ? "–" : pass?.rank, pct),
      el(
        "div",
        { class: "sh-pass__name" },
        el("div", { class: "sh-pass__title", text: pass?.name || "Season pass" }),
        status.childNodes.length ? status : null,
        pass?.next && pass?.tracked !== false ? note(`${(pass.progress ?? 0).toLocaleString()} / ${pass.next.toLocaleString()} XP to the next rank`) : pass?.tracked === false ? note("Bungie doesn't list your progress on this pass.") : null,
        options.length > 1 ? select : null,
      ),
    );
  }

  // ---------- Weekly checklist, Guardian Rank, clan ----------

  function checklist(hub) {
    const list = hub?.checklist ?? [];
    const done = list.filter((c) => c.done).length;
    return section(
      "Weekly checklist",
      list.length ? `${done} / ${list.length} done` : null,
      list.length
        ? el(
            "div",
            { class: "sh-checks" },
            ...list.map((c) =>
              el(
                "div",
                { class: `sh-check-row${c.done ? " is-done" : ""}`, title: c.description || c.name },
                el("span", { class: "sh-check-row__icon" }, c.icon ? el("img", { src: c.icon, alt: "", loading: "lazy" }) : null),
                el(
                  "span",
                  { class: "sh-check-row__text" },
                  el("strong", { text: c.name }),
                  c.entries?.length > 1 ? el("span", { class: "sh-check-row__entries" }, ...c.entries.map((e) => el("span", { class: `sh-chip${e.earned ? " is-on" : ""}`, text: e.name }))) : null,
                  c.progress?.length && !c.done ? meter(Math.round(c.progress.reduce((n, o) => n + percent(o), 0) / c.progress.length)) : null,
                ),
                el("span", { class: `sh-check-row__state${c.done ? " is-done" : c.known ? "" : " is-unknown"}`, text: c.done ? "Done" : c.known ? "To do" : "–" }),
              ),
            ),
          )
        : note(hub ? "Bungie lists no weekly milestones for this character." : "Reading…"),
    );
  }

  function guardianRank(hub) {
    const g = hub?.guardian;
    if (!g) return section("Guardian Rank", null, note(hub ? "Not found in Bungie's data." : "Reading…"));
    const steps = g.next?.steps ?? [];
    const doneSteps = steps.filter((x) => x.done).length;
    return section(
      "Guardian Rank",
      g.highest > g.rank ? `Highest ${g.highest}` : null,
      el(
        "div",
        { class: "sh-guardian" },
        el("span", { class: "sh-guardian__rank" }, el("span", { text: String(g.rank) })),
        el("span", { class: "sh-guardian__text" }, el("strong", { text: g.name || `Rank ${g.rank}` }), el("span", { class: "tab__note", text: g.max ? `Rank ${g.rank} of ${g.max}` : "" })),
      ),
      g.next
        ? el(
            "div",
            { class: "sh-guardian__next" },
            el("div", { class: "sh-guardian__nexthead" }, el("span", { text: `Next: ${g.next.name || `Rank ${g.next.rank}`}` }), el("span", { text: steps.length ? `${doneSteps} / ${steps.length}` : "" })),
            steps.length ? meter(Math.round((doneSteps / steps.length) * 100)) : null,
            el("ul", { class: "sh-guardian__steps" }, ...steps.filter((x) => !x.done).slice(0, 6).map((x) => el("li", { text: x.name, title: x.description || "" }))),
          )
        : note(g.max && g.rank >= g.max ? "Top rank reached." : ""),
    );
  }

  function clanWeekly(hub) {
    const clan = hub?.clan;
    const xp = clan?.xp ?? [];
    const engrams = clan?.engrams ?? [];
    const ready = engrams.filter((e) => e.earned && !e.redeemed).length;
    return section(
      "Clan this week",
      null,
      xp.length
        ? el("div", { class: "sh-clan__xp" }, ...xp.map((o) => el("div", { class: "sh-bounty__obj" }, el("span", { text: clean(o.text) || "Clan XP" }), el("span", { text: o.goal > 1 ? `${o.progress.toLocaleString()} / ${o.goal.toLocaleString()}` : `${percent(o)}%` }), meter(percent(o)))))
        : note(hub ? "No clan XP objective (not in a clan?)." : "Reading…"),
      engrams.length
        ? el(
            "div",
            { class: "sh-clan__engrams" },
            el("div", { class: `sh-clan__ready${ready ? " is-ready" : ""}`, text: ready ? `${ready} clan engram${ready > 1 ? "s" : ""} ready to collect` : "No clan engrams waiting" }),
            el("div", { class: "sh-check-row__entries" }, ...engrams.map((e) => el("span", { class: `sh-chip${e.redeemed ? " is-on" : e.earned ? " is-ready" : ""}`, title: e.redeemed ? "Collected" : e.earned ? "Ready to collect" : "Not earned yet", text: e.name }))),
          )
        : null,
    );
  }

  function track(pass) {
    if (!pass) return section("Season pass rewards", null, note("Reading…"));
    if (!pass.ranks?.length) return section("Season pass rewards", null, note("No rewards listed for this pass."));
    const at = pass.trackRank ?? 0;
    const strip = el(
      "div",
      { class: `sh-track${pass.premium === true ? " has-premium" : ""}`, tabindex: "0", "aria-label": "Season pass rewards (scrolls sideways)" },
      el("div", { class: "sh-track__labels" }, el("span"), el("span", { text: "Free" }), el("span", { text: "Pass" })),
      ...pass.ranks.map((r) =>
        el(
          "div",
          { class: `sh-rank${r.rank <= at ? " is-reached" : ""}${r.rank === at ? " is-current" : ""}`, "data-rank": String(r.rank) },
          el("span", { class: "sh-rank__n", text: String(r.rank) }),
          el("span", { class: "sh-rank__bar" }),
          el("div", { class: "sh-rank__cell" }, ...r.free.map((w) => rewardTile(w, pass.name))),
          el("div", { class: "sh-rank__cell sh-rank__cell--premium" }, ...r.premium.map((w) => rewardTile(w, pass.name))),
        ),
      ),
    );
    strip.addEventListener("scroll", hideTip);
    const page = (dir) => strip.scrollBy({ left: dir * strip.clientWidth * 0.8, behavior: "smooth" });
    requestAnimationFrame(() => {
      const here = strip.querySelector(".sh-rank.is-current") ?? strip.querySelector(".sh-rank:not(.is-reached)");
      if (here) strip.scrollLeft = Math.max(0, here.offsetLeft - strip.clientWidth / 2);
    });
    return section(
      "Season pass rewards",
      `${at} / ${pass.ranks[pass.ranks.length - 1].rank}`,
      el(
        "div",
        { class: "sh-trackwrap" },
        el("button", { class: "icon-btn sh-trackwrap__arrow", type: "button", "aria-label": "Earlier ranks", onclick: () => page(-1) }, svg(["M15 5l-7 7 7 7"])),
        strip,
        el("button", { class: "icon-btn sh-trackwrap__arrow", type: "button", "aria-label": "Later ranks", onclick: () => page(1) }, svg(["M9 5l7 7-7 7"])),
      ),
    );
  }

  // ---------- Rewards to claim ----------

  async function claim(list) {
    const c = chosen();
    for (const w of list) {
      const key = `${w.seasonHash}:${w.index}`;
      if (claiming.has(key)) continue;
      claiming.add(key);
      draw();
      const result = await ctx.hub.d2Claim(c, w.seasonHash, w.index);
      claiming.delete(key);
      if (!result?.ok) {
        ctx.notify?.({ kind: "error", title: `Couldn't claim ${w.name}`, detail: result?.error ?? "Bungie refused it." });
        break;
      }
      w.claimed = true;
      w.claimable = false;
    }
    delete hubs[c];
    for (const k of Object.keys(passes)) if (k.startsWith(`${c}:`)) delete passes[k];
    draw();
  }

  function claimables(hub) {
    if (!hub) return null;
    const all = (hub.claimable ?? []).filter((w) => !w.claimed);
    const current = all.filter((w) => w.current);
    const list = claimScope === "current" ? current : all;
    const scope = el(
      "div",
      { class: "segmented sh-scope", role: "group", "aria-label": "Which passes" },
      ...[["current", `This pass (${current.length})`], ["all", `Every pass (${all.length})`]].map(([id, text]) => el("button", { type: "button", "aria-pressed": String(claimScope === id), text, onclick: () => ((claimScope = id), draw()) })),
    );
    const busy = claiming.size > 0;
    return section(
      "Rewards to claim",
      [scope],
      list.length
        ? el(
            "div",
            { class: "sh-claims" },
            el(
              "div",
              { class: "sh-claims__grid" },
              ...list.map((w) =>
                el(
                  "div",
                  { class: `sh-claim${claiming.has(`${w.seasonHash}:${w.index}`) ? " is-busy" : ""}` },
                  rewardTile(w, w.pass || w.seasonLabel),
                  el("span", { class: "sh-claim__where", text: claimScope === "all" ? `${w.seasonLabel} · ${w.rank}` : `Rank ${w.rank}` }),
                  el("button", { class: "btn btn--small", type: "button", disabled: busy || null, text: "Claim", onclick: () => claim([w]) }),
                ),
              ),
            ),
            el("div", { class: "sh-claims__foot" }, note("Claimed rewards go to this character (or its postmaster when it's full)."), el("button", { class: "btn btn--primary btn--small", type: "button", disabled: busy || null, text: `Claim all ${list.length}`, onclick: () => claim([...list]) })),
          )
        : note(claimScope === "current" ? "Nothing waiting on this pass." : "Nothing waiting on any pass Bungie lists for you."),
    );
  }

  // ---------- Bounties (right column) ----------

  function bounties() {
    const list = activity.bounties[chosen()] ?? [];
    return el(
      "aside",
      { class: "sh-side" },
      label("Bounties", String(list.length)),
      list.length
        ? el(
            "div",
            { class: "sh-bounties" },
            ...list.map((b) =>
              el(
                "div",
                { class: `sh-bounty${b.complete ? " is-done" : ""}`, title: b.description || b.name },
                el("span", { class: "sh-order__icon sh-bounty__icon" }, b.icon ? el("img", { src: b.icon, alt: "", loading: "lazy" }) : null),
                el(
                  "div",
                  { class: "sh-bounty__text" },
                  el("div", { class: "sh-bounty__name" }, el("span", { text: b.name }), b.complete ? el("span", { class: "sh-card__done", text: "✓" }) : null),
                  ...(b.objectives ?? []).slice(0, 3).map((o) => el("div", { class: "sh-bounty__obj" }, el("span", { text: clean(o.text) || "Progress" }), el("span", { text: o.goal > 1 ? `${o.progress}/${o.goal}` : `${percent(o)}%` }), meter(percent(o)))),
                  b.expires ? el("div", { class: "sh-bounty__ends" }, el("span", { text: "Ends in " }), until(ctx, b.expires, "")) : null,
                ),
              ),
            ),
          )
        : note("No bounties on this character."),
    );
  }

  // ---------- Folded sections ----------

  function folded(hub) {
    const c = chosen();
    const types = [...new Set([...(activity.quests[c] ?? []), ...(activity.bounties[c] ?? [])].map((q) => q.typeName).filter(Boolean))];
    const list = (items, fallback) => el("ul", {}, ...(items.length ? items : [fallback]).map((t) => el("li", { text: t })));
    const k = hub?.check;
    return [
      activity.alerts?.length ? el("details", { class: "sh-more" }, el("summary", { text: `Alerts from Bungie (${activity.alerts.length})` }), el("div", { class: "alerts" }, ...activity.alerts.map((a) => el("p", { class: "note", text: a.text })))) : null,
      k
        ? el(
            "details",
            { class: "sh-more sh-check" },
            el("summary", { text: "Data check (for tuning this tab)" }),
            note("What MIDA found in Bungie's data for this season. If a section above is empty or wrong, a screenshot of this helps fix it."),
            el("h3", { text: `Season: ${hub.season?.name ?? "?"}${hub.eventCard ? ` · Event card: ${hub.eventCard}` : ""}` }),
            el("h3", { text: "Presentation nodes looked at" }),
            list(k.nodes.map((n) => `${n.name || "(no name)"} · ${n.nodes} sub-nodes · ${n.records} records`), `None. Roots: ${k.roots.map((r) => r.from).join(", ") || "none"}`),
            el("h3", { text: "Objective groups (daily / weekly / other)" }),
            list(k.groups.map((g) => `[${g.group}] ${g.path} · ${g.records} records`), "None."),
            el("h3", { text: `Vendors with objectives or bounties (of ${k.vendorsRead} vendors read)` }),
            list(
              k.vendors.flatMap((v) => [`${v.name || "(no name)"}${v.refresh ? ` · refreshes ${new Date(v.refresh).toLocaleString()}` : ""}`, ...v.categories.map((cat) => `   – ${cat.name || "(no name)"}: ${cat.count} items, e.g. ${cat.first ?? "?"}`)]),
              k.vendorsRead ? "None of them." : "Couldn't read vendors.",
            ),
            el("h3", { text: "Reward tracks (weekly rewards)" }),
            list(k.tracks.map((t) => `${t.name || "(no name)"} [${t.hash}] · ${t.steps} steps · level ${t.level ?? 0}${t.levelCap ? ` of ${t.levelCap}` : ""}${t.firstReward ? ` · first reward: ${t.firstReward}` : ""}`), "None found."),
            el("h3", { text: "Milestones on this character" }),
            list(k.milestones ?? [], "None."),
            el("h3", { text: `Orders found in the inventories: ${k.inventoryOrders ?? 0}` }),
            el("h3", { text: "Record trees Bungie's settings name (the hub's objectives may be under one)" }),
            list(k.coreNodes ?? [], "None."),
            el("h3", { text: "Objective holders (daily / weekly objectives)" }),
            list((k.holders ?? []).map((h) => `${h.name} · ${h.done} of ${h.objectives} done${h.value?.length ? ` · rewards: ${h.value.join(", ")}` : ""}`), "None."),
            el("h3", { text: "Pursuits with objectives kept apart (orders may be these)" }),
            list(k.uninstanced ?? [], "None."),
            el("h3", { text: "Kinds of things in this character's inventory and the account's" }),
            list(k.kinds ?? [], "None."),
            el("h3", { text: "Quest and bounty kinds on this character" }),
            list(types, "None."),
            el("h3", { text: "What Bungie gives a season pass / a season" }),
            list([`Pass: ${(k.passKeys ?? []).join(", ")}`, `Season: ${(k.seasonKeys ?? []).join(", ")}`], "?"),
          )
        : null,
    ];
  }

  // ---------- Drawing ----------

  function paintBackdrop() {
    let picture = null;
    try {
      picture = localStorage.getItem(SH_BACKDROP) || localStorage.getItem(INV_BACKDROP);
    } catch {
      // The built-in backdrop shows.
    }
    backdrop.style.backgroundImage = picture ? `url("${picture}")` : "";
    backdrop.classList.toggle("has-picture", Boolean(picture));
  }

  function draw() {
    hideTip();
    const c = chosen();
    const hub = hubs[c];
    if (hub === undefined) {
      hubs[c] = null;
      ctx.hub.d2Seasonal(c).then((result) => {
        hubs[c] = result?.ok ? result.data : { error: result?.error ?? "Couldn't read the Seasonal Hub." };
        if (chosen() === c) draw();
      });
    }
    const ready = hub && !hub.error ? hub : null;
    let pass = ready ? ready.pass : null;
    let passError = null;
    if (shownPass && ready) {
      const key = `${c}:${shownPass.hash}`;
      if (passes[key] === undefined) {
        passes[key] = null;
        ctx.hub.d2Pass(c, shownPass.hash, shownPass.seasonHash).then((result) => {
          passes[key] = result?.ok ? result.data : { error: result?.error ?? "Couldn't read that pass." };
          draw();
        });
      }
      pass = passes[key] && !passes[key].error ? passes[key] : null;
      passError = passes[key]?.error ?? null;
    }
    const body = root.querySelector(".sh-body");
    const scroll = body ? body.scrollTop : 0;
    const top = el(
      "header",
      { class: "sh-top" },
      el("div", { class: "sh-top__text" }, el("span", { class: "sh-top__kicker", text: "Seasonal Hub" }), el("h1", { class: "sh-top__title", text: ready?.season?.name || "This season" })),
      el(
        "div",
        { class: "sh-top__tools" },
        characterPicker(ctx, activity.characters, c, (id) => {
          lastCharacter.seasonal = id;
          shownPass = null;
          draw();
        }),
        el("button", { class: "btn btn--small", type: "button", text: "Refresh", onclick: () => load(true) }),
      ),
    );
    const main = el(
      "div",
      { class: "sh-main" },
      hub?.error ? el("p", { class: "tab__error", text: hub.error }) : null,
      // While this character's hub is being read: one bar, kept across redraws so it doesn't restart.
      hub === null ? (hubBar ??= el("div", { class: "sh-loading" }, progressBar(ctx, "seasonal", "Reading the hub from Bungie…"))) : ((hubBar = null), null),
      // The hub's daily and weekly objectives aren't in Bungie's public data (checked live through
      // every record tree, vendor and hidden item), so the top row is orders and weekly rewards.
      // The owner's layout (3 Oct 2026): Guardian Rank and the clan's week under the weekly rewards, the
      // checklist across the whole width, and the pass's rank and name beside its reward track.
      el(
        "div",
        { class: "sh-grid" },
        orders(ready),
        el("div", { class: "sh-right sh-right--one" }, weeklyRewards(ready), resets(), el("div", { class: "sh-pair" }, guardianRank(ready), clanWeekly(ready))),
      ),
      checklist(ready),
      el("div", { class: "sh-passrow" }, passHeader(ready, pass), track(pass)),
      passError ? el("p", { class: "tab__error", text: passError }) : null,
      claimables(ready),
      ...folded(ready),
    );
    const scroller = el("div", { class: "sh-body" }, el("div", { class: "sh-layout" }, main, bounties()));
    scroller.addEventListener("scroll", hideTip);
    root.replaceChildren(...[backdrop, top, scroller, tip].filter(Boolean));
    scroller.scrollTop = scroll;
  }

  window.addEventListener("mida-backdrop", paintBackdrop);
  paintBackdrop();

  async function load(fresh) {
    if (!activity) container.replaceChildren(loadingView(ctx, "Reading this season from Bungie…", "activity"));
    const result = await read(ctx, "activity", fresh);
    if (!result?.ok) return container.replaceChildren(problemView(ctx, result?.error ?? "Something went wrong.", () => load(true)));
    activity = result.data;
    if (fresh) {
      for (const k of Object.keys(hubs)) delete hubs[k];
      for (const k of Object.keys(passes)) delete passes[k];
    }
    draw();
    if (!container.contains(root)) container.replaceChildren(root);
  }
  load(false);
}
