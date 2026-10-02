// The Seasonal Hub tab (Destiny 2), laid out from the owner's mock-up of the game's own hub:
//
//   [ season name ........................................ character · refresh ]
//   [ active orders        ] [ daily objectives ] [ weekly objectives ]
//   [ order upgrade chance ] [ refresh timer    ] [ refresh timer     ]
//                            [ weekly rewards ........................ ]
//   ( rank )  PASS NAME  [past passes ▾]        [ season pass bonuses ]
//   [ season pass rewards: one column per rank, free row over premium row ]
//   then bounties, Bungie's alerts and a data check, folded away.
//
// Data: the shared "activity" read (quests, bounties, artifact, alerts) plus d2_seasonal (the pass
// track, past passes, objectives, other reward tracks) and d2_pass for a past pass. How Bungie lays
// out the 2025-26 hub couldn't be checked from the build workspace, so sections that find nothing
// say so, and the data check lists what was found for tuning.

const DAY = 24 * 3600e3;

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

const percent = (o) => (o.goal > 0 ? Math.min(100, Math.round((o.progress / o.goal) * 100)) : o.complete ? 100 : 0);

export function seasonalHub(ctx, container, { read, loadingView, problemView, until, characterPicker, questCard, lastCharacter }) {
  const { el, svg } = ctx;
  const root = el("div", { class: "tab tab--seasonal sh" });
  let activity = null;
  const hubs = {}; // per character
  const passes = {}; // per character + pass hash
  let shownPass = null; // a past pass picked in the dropdown

  const chosen = () => (activity.characters.some((c) => c.id === lastCharacter.seasonal) ? lastCharacter.seasonal : activity.characters[0]?.id);

  function box(title, extra, ...children) {
    return el("section", { class: "sh-box" }, el("div", { class: "inv-label sh-box__label" }, el("span", { text: title }), extra ? el("span", { class: "inv-label__count" }, ...[].concat(extra)) : null), ...children);
  }

  // ---------- Orders ----------

  function orders(hub) {
    const c = chosen();
    const list = [...(activity.quests[c] ?? []), ...(activity.bounties[c] ?? [])].filter((q) => /\border/i.test(`${q.typeName} ${q.name}`));
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
                el("div", { class: "sh-order__name", text: q.name }),
                ...q.objectives.map((o) =>
                  el(
                    "div",
                    { class: `sh-obj${o.complete ? " is-done" : ""}` },
                    el("span", { class: "sh-obj__box", "aria-hidden": "true" }),
                    el("span", { class: "sh-obj__text", text: o.text || "Progress" }),
                    el("span", { class: "sh-obj__value", text: o.goal > 1 ? `${o.progress.toLocaleString()} / ${o.goal.toLocaleString()}` : `${percent(o)}%` }),
                    meter(percent(o), "sh-obj__fill"),
                  ),
                ),
              ),
            ),
          ),
        )
      : el("p", { class: "tab__note", text: "No orders on this character right now (or Bungie names them differently; see the data check below)." });
    const chance = hub?.orderChance;
    return el(
      "div",
      { class: "sh-col" },
      box("Active orders", list.length ? `${list.length}` : null, body),
      box(
        "Order upgrade chance",
        null,
        chance
          ? el("div", { class: "sh-chance" }, el("strong", { text: chance.name }), meter(chance.next ? Math.round(((chance.progress ?? 0) / chance.next) * 100) : 0, "sh-chance__fill"), el("span", { class: "tab__note", text: `Level ${chance.level ?? 0}${chance.levelCap ? ` of ${chance.levelCap}` : ""}` }))
          : el("p", { class: "tab__note", text: "Not found in Bungie's data yet." }),
      ),
    );
  }

  function meter(pct, cls) {
    const fill = el("span", { class: cls });
    fill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
    return el("span", { class: "sh-meter", role: "progressbar", "aria-valuenow": String(pct), "aria-valuemin": "0", "aria-valuemax": "100" }, fill);
  }

  // ---------- Objectives ----------

  function objectiveCard(r) {
    const main = r.objectives[0];
    const pct = r.objectives.length ? Math.round(r.objectives.reduce((n, o) => n + percent(o), 0) / r.objectives.length) : r.complete ? 100 : 0;
    return el(
      "div",
      { class: `sh-card${r.complete ? " is-done" : ""}`, title: r.description || r.name },
      el("div", { class: "sh-card__head" }, r.icon ? el("img", { class: "sh-card__icon", src: r.icon, alt: "" }) : null, el("span", { class: "sh-card__name", text: r.name }), r.complete ? el("span", { class: "sh-card__done", text: "✓" }) : null),
      el(
        "div",
        { class: "sh-card__body" },
        el("span", { class: "sh-card__desc", text: main?.text || r.description || "" }),
        el("span", { class: "sh-card__rewards" }, ...r.rewards.slice(0, 3).map((w) => el("span", { class: "sh-reward", title: `${w.name}${w.quantity > 1 ? ` ×${w.quantity}` : ""}` }, w.icon ? el("img", { src: w.icon, alt: "" }) : el("span", { text: "◆" })))),
      ),
      meter(pct, "sh-card__fill"),
    );
  }

  function objectives(title, list, reset, hub) {
    return el(
      "div",
      { class: "sh-col" },
      box(title, list?.length ? `${list.filter((r) => r.complete).length} / ${list.length}` : null, list?.length ? el("div", { class: "sh-cards" }, ...list.map(objectiveCard)) : el("p", { class: "tab__note", text: hub ? "Nothing found for this yet (see the data check below)." : "Reading…" })),
      el("div", { class: "sh-timer" }, svg(["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", "M12 7v5l3 2"]), el("span", { text: `${title.split(" ")[0]} refresh in ` }), until(ctx, reset, "")),
    );
  }

  // ---------- Weekly rewards ----------

  function weeklyRewards(hub) {
    const track = hub?.weeklyRewards;
    if (!track) return box("Weekly rewards", null, el("p", { class: "tab__note", text: hub ? "Not found in Bungie's data yet (see the data check below)." : "Reading…" }));
    const level = track.level ?? 0;
    return box(
      "Weekly rewards",
      `${level}${track.levelCap ? ` / ${track.levelCap}` : ""}`,
      el(
        "div",
        { class: "sh-steps" },
        ...track.rewards.map((w, i) =>
          el(
            "div",
            { class: `sh-step${w.earned || level >= (w.step ?? i + 1) ? " is-earned" : ""}${w.claimed ? " is-claimed" : ""}` },
            el("span", { class: "sh-step__n", text: String(w.step ?? i + 1) }),
            el("span", { class: "sh-step__bar" }),
            rewardTile(w),
          ),
        ),
      ),
    );
  }

  function rewardTile(w, extra = "") {
    return el(
      "span",
      { class: `sh-tile sh-tile--t${w.tier ?? 0}${w.claimed ? " is-claimed" : w.earned ? " is-earned" : ""}${extra}`, title: `${w.name}${w.quantity > 1 ? ` ×${Number(w.quantity).toLocaleString()}` : ""}${w.claimed ? " · claimed" : w.earned ? " · earned, not claimed" : ""}` },
      w.icon ? el("img", { src: w.icon, alt: "", loading: "lazy" }) : null,
      w.quantity > 1 ? el("span", { class: "sh-tile__qty", text: Number(w.quantity).toLocaleString() }) : null,
      w.claimed ? el("span", { class: "sh-tile__check", text: "✓" }) : null,
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
    const pct = pass?.next ? Math.round(((pass.progress ?? 0) / pass.next) * 100) : 0;
    const select = el(
      "select",
      {
        class: "select sh-pass__pick",
        "aria-label": "Season pass",
        onchange: (event) => {
          const hash = Number(event.target.value);
          shownPass = options.find((p) => p.current)?.hash === hash ? null : hash;
          draw();
        },
      },
      ...options.map((p) => el("option", { value: String(p.hash), selected: (shownPass ?? options.find((o) => o.current)?.hash) === p.hash || null, text: `${p.number ? `Season ${p.number}: ` : ""}${p.season}${p.current ? " (current)" : ""}` })),
    );
    const bonuses = [];
    if (pass) {
      bonuses.push(bonus(pass.premium === true ? "✓" : pass.premium === false ? "–" : "?", "Rewards pass", pass.premium === true ? "Active" : pass.premium === false ? "Not owned" : "Not known yet"));
      const extra = (pass.rank ?? 0) - (pass.trackRank ?? 0);
      if (extra > 0) bonuses.push(bonus(`+${extra}`, "Ranks past the track", "Bright Engrams as you go"));
    }
    if (!shownPass && activity.artifact) bonuses.push(bonus(`+${activity.artifact.powerBonus ?? 0}`, "Artifact power", `${activity.artifact.points ?? 0} points unlocked`));
    if (!shownPass && hub?.season?.ends) bonuses.push(bonus("⏱", "Season ends in", until(ctx, hub.season.ends, "")));
    return el(
      "div",
      { class: "sh-pass" },
      ring(pass?.tracked === false ? "–" : pass?.rank, pct),
      el(
        "div",
        { class: "sh-pass__name" },
        el("div", { class: "sh-pass__title", text: pass?.name || "Season pass" }),
        pass?.next && pass?.tracked !== false ? el("div", { class: "tab__note", text: `${(pass.progress ?? 0).toLocaleString()} / ${pass.next.toLocaleString()} XP to the next rank` }) : pass?.tracked === false ? el("div", { class: "tab__note", text: "Bungie doesn't list your progress on this pass." }) : null,
        options.length > 1 ? select : null,
      ),
      box("Season pass bonuses", null, bonuses.length ? el("div", { class: "sh-bonuses" }, ...bonuses) : el("p", { class: "tab__note", text: "Reading…" })),
    );
  }

  function bonus(mark, title, detail) {
    return el("div", { class: "sh-bonus" }, el("span", { class: "sh-bonus__mark", text: mark }), el("span", { class: "sh-bonus__text" }, el("strong", { text: title }), el("span", {}, ...[].concat(detail))));
  }

  function track(pass) {
    if (!pass) return box("Season pass rewards", null, el("p", { class: "tab__note", text: "Reading…" }));
    if (!pass.ranks?.length) return box("Season pass rewards", null, el("p", { class: "tab__note", text: "No rewards listed for this pass." }));
    const at = pass.trackRank ?? 0;
    const strip = el(
      "div",
      { class: `sh-track${pass.premium === true ? " has-premium" : ""}`, tabindex: "0", "aria-label": "Season pass rewards (scrolls sideways)" },
      el("div", { class: "sh-track__labels" }, el("span", { text: "" }), el("span", { text: "Free" }), el("span", { text: "Pass" })),
      ...pass.ranks.map((r) =>
        el(
          "div",
          { class: `sh-rank${r.rank <= at ? " is-reached" : ""}${r.rank === at ? " is-current" : ""}`, "data-rank": String(r.rank) },
          el("span", { class: "sh-rank__n", text: String(r.rank) }),
          el("span", { class: "sh-rank__bar" }),
          el("div", { class: "sh-rank__cell" }, ...r.free.map((w) => rewardTile(w))),
          el("div", { class: "sh-rank__cell sh-rank__cell--premium" }, ...r.premium.map((w) => rewardTile(w))),
        ),
      ),
    );
    const page = (dir) => strip.scrollBy({ left: dir * strip.clientWidth * 0.8, behavior: "smooth" });
    // Start at the current rank.
    requestAnimationFrame(() => {
      const here = strip.querySelector(".sh-rank.is-current") ?? strip.querySelector(".sh-rank:not(.is-reached)");
      if (here) strip.scrollLeft = Math.max(0, here.offsetLeft - strip.clientWidth / 2);
    });
    return box(
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

  // ---------- Folded sections ----------

  function folded(hub) {
    const c = chosen();
    const bounties = activity.bounties[c] ?? [];
    const types = [...new Set([...(activity.quests[c] ?? []), ...bounties].map((q) => q.typeName).filter(Boolean))];
    return [
      el("details", { class: "sh-more" }, el("summary", { text: `Bounties (${bounties.length})` }), bounties.length ? el("div", { class: "cards cards--wide" }, ...bounties.map((q) => questCard(ctx, q))) : el("p", { class: "tab__note", text: "No bounties on this character." })),
      activity.alerts?.length ? el("details", { class: "sh-more" }, el("summary", { text: `Alerts from Bungie (${activity.alerts.length})` }), el("div", { class: "alerts" }, ...activity.alerts.map((a) => el("p", { class: "note", text: a.text })))) : null,
      hub?.check
        ? el(
            "details",
            { class: "sh-more sh-check" },
            el("summary", { text: "Data check (for tuning this tab)" }),
            el("p", { class: "tab__note", text: "What Mida found in Bungie's data for this season. If a section above is empty or wrong, a screenshot of this helps fix it." }),
            el("h3", { text: `Season: ${hub.season?.name ?? "?"}${hub.eventCard ? ` · Event card: ${hub.eventCard}` : ""}` }),
            el("h3", { text: "Objective groups (daily / weekly / other)" }),
            el("ul", {}, ...(hub.check.groups.length ? hub.check.groups.map((g) => el("li", { text: `[${g.group}] ${g.path} · ${g.records} records` })) : [el("li", { text: `None. Roots looked at: ${hub.check.roots.map((r) => r.from).join(", ") || "none"}` })])),
            el("h3", { text: "Reward tracks (weekly rewards, order chance)" }),
            el("ul", {}, ...(hub.check.tracks.length ? hub.check.tracks.map((t) => el("li", { text: `${t.name || "(no name)"} · ${t.steps} steps · level ${t.level ?? 0}${t.levelCap ? ` of ${t.levelCap}` : ""}` })) : [el("li", { text: "None found." })])),
            el("h3", { text: "Quest and bounty kinds on this character" }),
            el("ul", {}, ...(types.length ? types.map((t) => el("li", { text: t })) : [el("li", { text: "None." })])),
          )
        : null,
    ];
  }

  // ---------- Drawing ----------

  function draw() {
    const c = chosen();
    const hub = hubs[c];
    if (hub === undefined) {
      hubs[c] = null;
      ctx.hub.d2Seasonal(c).then((result) => {
        hubs[c] = result?.ok ? result.data : { error: result?.error ?? "Couldn't read the Seasonal Hub." };
        if (chosen() === c) draw();
      });
    }
    let pass = hub && !hub.error ? hub.pass : null;
    if (shownPass && hub && !hub.error) {
      const key = `${c}:${shownPass}`;
      if (passes[key] === undefined) {
        passes[key] = null;
        ctx.hub.d2Pass(c, shownPass).then((result) => {
          passes[key] = result?.ok ? result.data : { error: result?.error ?? "Couldn't read that pass." };
          draw();
        });
      }
      pass = passes[key] && !passes[key].error ? passes[key] : null;
    }
    const ready = hub && !hub.error ? hub : null;
    const parts = [
      el(
        "header",
        { class: "sh-head" },
        el("div", {}, el("div", { class: "sh-head__kicker", text: "Seasonal Hub" }), el("h1", { class: "sh-head__title", text: ready?.season?.name || "This season" })),
        el(
          "div",
          { class: "tab__tools" },
          characterPicker(ctx, activity.characters, c, (id) => {
            lastCharacter.seasonal = id;
            draw();
          }),
          el("button", { class: "btn btn--small", type: "button", text: "Refresh", onclick: () => load(true) }),
        ),
      ),
      hub?.error ? el("p", { class: "tab__error", text: hub.error }) : null,
      el("div", { class: "sh-top" }, orders(ready), el("div", { class: "sh-right" }, objectives("Daily objectives", ready?.daily, nextDaily(), ready), objectives("Weekly objectives", ready?.weekly, nextWeekly(), ready), el("div", { class: "sh-wide" }, weeklyRewards(ready)))),
      passHeader(ready, pass),
      shownPass && passes[`${c}:${shownPass}`]?.error ? el("p", { class: "tab__error", text: passes[`${c}:${shownPass}`].error }) : null,
      track(pass),
      ...folded(ready),
    ];
    root.replaceChildren(...parts.filter(Boolean));
  }

  async function load(fresh) {
    if (!activity) container.replaceChildren(loadingView(ctx, "Reading this season from Bungie…"));
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
