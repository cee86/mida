// The Vendors tab (Destiny 2), styled like the Inventory and Seasonal Hub (title band, darkened backdrop,
// letterspaced labels over a rule, bracketed boxes; the sh-* classes come from seasonal.css):
//
//   [ VENDORS · n you can visit ............................ character · search · refresh ]
//   [ Tower           ] [ vendor art: name, subtitle, location, rank (its icon), reset countdown ]
//   [   Zavala        ] [ each sale category: item tiles with their costs, hover for details      ]
//   [   Ada-1 ...     ]   (claimed rewards ticked and dimmed, ready-to-claim marked, locked ones dimmed with a lock)
//   [ Destinations... ]
//   [ ▸ Kiosks and more (folded) ]
//
// Data: d2_vendors (bungie.rs vendor_screen): every vendor the character can visit, grouped and ordered as Bungie's
// Companion app does (`vendorGroups`), their location, rank, next reset and sale items with costs and state. Vendors
// outside every group (subclass pieces, attunements, Focused Decoding...) come last, folded away. Picking a vendor
// keeps the list where it was scrolled. Characters come from the shared "activity" read.

import { wallpaper } from "./wallpaper.js";
const SEARCH = ["M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z", "M20 20l-4-4"];
const LOCK = ["M7 11V8a5 5 0 0 1 10 0v3", "M5 11h14v10H5z"];
const STORE = ["M4 9l2-5h12l2 5", "M4 9h16v11H4z", "M9 20v-6h6v6"];
const TIER_NAMES = { 6: "Exotic", 5: "Legendary", 4: "Rare", 3: "Uncommon", 2: "Common" };
const CLASS_NAMES = { 0: "Titan", 1: "Hunter", 2: "Warlock" };
const clean = (text) => String(text ?? "").replace(/\[[^\]]*\]\s*/g, "").trim();
const percent = (o) => (o.goal > 0 ? Math.min(100, Math.round((o.progress / o.goal) * 100)) : o.complete ? 100 : 0);

const byCharacter = {}; // character id -> the d2_vendors answer, kept until Refresh
let picked = null; // the chosen vendor's hash
let extrasOpen = false; // the folded "Kiosks and more" group

// `only` (optional): show just the vendors it accepts, under `title` (the Director's season page uses it for the
// Tenets), with `empty` when none match.
export function vendorsTab(ctx, container, { read, loadingView, problemView, until, characterPicker, lastCharacter, only = null, title = "Vendors", empty = null, wallpaper: wall = "tab-director" }) {
  const { el } = ctx;
  const root = el("div", { class: "tab vd sh" });
  const backdrop = wallpaper(ctx, wall);
  const tip = el("div", { class: "sh-tip", role: "tooltip", hidden: true });
  let characters = [];
  let search = "";

  const chosen = () => (characters.some((c) => c.id === lastCharacter.vendors) ? lastCharacter.vendors : characters[0]?.id);
  const label = (title, extra) => el("div", { class: "sh-label" }, el("span", { class: "sh-label__text", text: title }), extra != null ? el("span", { class: "sh-label__count" }, ...[].concat(extra)) : null);
  function meter(pct) {
    const fill = el("span");
    fill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
    return el("span", { class: "sh-meter", role: "progressbar", "aria-valuenow": String(pct), "aria-valuemin": "0", "aria-valuemax": "100" }, fill);
  }
  const matches = (item) => !search || `${item.name} ${item.typeName}`.toLowerCase().includes(search);

  // ---------- Item tiles and their cards ----------

  function showTip(anchor, item) {
    tip.className = `sh-tip sh-tip--t${item.tier ?? 0}`;
    tip.replaceChildren(
      el("div", { class: "sh-tip__head" }, el("strong", { text: item.name }), el("span", { text: [CLASS_NAMES[item.classType], item.typeName, TIER_NAMES[item.tier]].filter(Boolean).join(" · ") })),
      el(
        "div",
        { class: "sh-tip__body" },
        item.quantity > 1 ? el("div", { class: "sh-tip__qty", text: `×${Number(item.quantity).toLocaleString()}` }) : null,
        item.description ? el("p", { text: clean(item.description) }) : null,
        ...(item.objectives ?? []).map((o) => el("div", { class: "vd-tip__obj" }, el("span", { text: clean(o.text) || "Progress" }), el("span", { text: o.goal > 1 ? `${o.progress}/${o.goal}` : `${percent(o)}%` }))),
        item.costs?.length ? el("div", { class: "vd-tip__costs" }, el("span", { text: "Costs" }), ...item.costs.map(cost)) : item.claimed || item.claimable || item.locked ? null : el("div", { class: "sh-tip__meta", text: "Free" }),
        item.status ? el("div", { class: `sh-tip__meta${item.claimed ? " is-claimed" : ""}`, text: item.status }) : null,
      ),
    );
    tip.hidden = false;
    const box = root.getBoundingClientRect();
    const a = anchor.getBoundingClientRect();
    let left = a.right - box.left + 8;
    if (left + tip.offsetWidth > box.width - 8) left = a.left - box.left - tip.offsetWidth - 8;
    let top = a.top - box.top;
    if (top + tip.offsetHeight > box.height - 8) top = box.height - tip.offsetHeight - 8;
    tip.style.left = `${Math.max(8, left)}px`;
    tip.style.top = `${Math.max(8, top)}px`;
  }
  const hideTip = () => (tip.hidden = true);

  function cost(c) {
    return el("span", { class: "vd-cost", title: c.name }, c.icon ? el("img", { src: c.icon, alt: "", loading: "lazy" }) : null, el("span", { text: Number(c.quantity ?? 0).toLocaleString() }));
  }

  function tile(item) {
    const state = item.claimed || item.status === "Owned" ? " is-claimed" : item.claimable ? " is-claimable" : item.locked ? " is-locked" : item.status ? " is-blocked" : "";
    const node = el(
      "div",
      { class: `vd-item${state}`, tabindex: "0", "aria-label": `${item.name}${item.status ? `, ${item.status}` : ""}` },
      el(
        "span",
        { class: `sh-tile sh-tile--t${item.tier ?? 0}` },
        item.icon ? el("img", { src: item.icon, alt: "", loading: "lazy" }) : null,
        item.watermark ? el("img", { class: "vd-item__mark", src: item.watermark, alt: "", loading: "lazy" }) : null,
        item.quantity > 1 ? el("span", { class: "sh-tile__qty", text: Number(item.quantity).toLocaleString() }) : null,
        item.claimed || item.status === "Owned" ? el("span", { class: "sh-tile__check", text: "✓" }) : null,
        item.claimable ? el("span", { class: "sh-tile__dot", "aria-hidden": "true" }) : null,
        item.locked ? el("span", { class: "vd-item__lock", "aria-hidden": "true" }, ctx.svg(LOCK)) : null,
      ),
      el("span", { class: "vd-item__costs" }, ...(item.costs ?? []).slice(0, 3).map(cost)),
    );
    node.addEventListener("pointerenter", () => showTip(node, item));
    node.addEventListener("focus", () => showTip(node, item));
    node.addEventListener("pointerleave", hideTip);
    node.addEventListener("blur", hideTip);
    return node;
  }

  // ---------- The chosen vendor ----------

  function vendorView(v) {
    if (!v) return el("section", { class: "sh-box" }, label("Vendor"), el("p", { class: "tab__note", text: "Pick a vendor on the left." }));
    const hero = el("div", { class: "vd-hero" });
    if (v.art) {
      hero.style.backgroundImage = `linear-gradient(90deg, rgba(0,0,0,0.78), rgba(0,0,0,0.25) 70%), url("${v.art}")`;
      hero.classList.add("has-art");
    }
    const rank = v.rank && v.rank.next > 0 ? v.rank : null;
    hero.append(
      el("span", { class: "vd-hero__icon" }, v.icon ? el("img", { src: v.icon, alt: "", loading: "lazy" }) : ctx.svg(STORE)),
      el(
        "div",
        { class: "vd-hero__text" },
        el("span", { class: "vd-hero__kicker", text: [v.group, v.destination].filter(Boolean).join(" · ") || "Vendor" }),
        el("h2", { class: "vd-hero__name", text: v.name }),
        v.subtitle ? el("span", { class: "vd-hero__subtitle", text: v.subtitle }) : null,
        el(
          "div",
          { class: "vd-hero__facts" },
          rank
            ? el(
                "span",
                { class: "vd-rank" },
                rank.icon ? el("img", { class: "vd-rank__icon", src: rank.icon, alt: "", loading: "lazy" }) : el("span", { class: "vd-rank__icon" }),
                el("span", { text: `Rank ${rank.level}${rank.name ? ` · ${rank.name}` : ""}${rank.resets ? ` · reset ${rank.resets}×` : ""}` }),
                meter(Math.round((rank.progress / rank.next) * 100)),
                el("span", { class: "vd-rank__n", text: `${Number(rank.progress).toLocaleString()} / ${Number(rank.next).toLocaleString()}` }),
              )
            : null,
          v.refresh ? el("span", { class: "vd-reset" }, el("span", { text: "Inventory resets in " }), until(ctx, v.refresh, "")) : null,
        ),
      ),
    );
    const sections = v.categories
      .map((c) => ({ ...c, items: c.items.filter(matches) }))
      .filter((c) => c.items.length)
      .map((c) => el("section", { class: "sh-box vd-cat" }, label(c.name || "For sale", `${c.items.length}`), el("div", { class: "vd-items" }, ...c.items.map(tile))));
    // For tuning the claimed/locked reading on live data: each item's raw state flags (augments · sale status).
    const flags = el(
      "details",
      { class: "sh-more sh-check" },
      el("summary", { text: "Data check (for tuning this tab)" }),
      el("p", { class: "tab__note", text: `Group: ${v.group || "none"}${v.extra ? " (not in Bungie's vendor groups)" : ""} · vendor ${v.hash}` }),
      el("ul", {}, ...v.categories.flatMap((c) => c.items.map((it) => el("li", { text: `${c.name || "For sale"} · ${it.name}: ${it.flags?.[0] ?? "?"} · ${it.flags?.[1] ?? "?"}${it.status ? ` → ${it.status}` : ""}` })))),
    );
    return el(
      "div",
      { class: "vd-main" },
      hero,
      v.description ? el("p", { class: "vd-desc", text: clean(v.description) }) : null,
      ...(sections.length ? sections : [el("p", { class: "tab__note", text: search ? "Nothing here matches your search." : "Nothing for sale right now." })]),
      flags,
    );
  }

  // ---------- Drawing ----------

  function draw() {
    hideTip();
    const data = byCharacter[chosen()];
    const all = (data?.vendors ?? []).filter((v) => !only || only(v));
    const visible = all.filter((v) => !search || v.name.toLowerCase().includes(search) || v.categories.some((c) => c.items.some(matches)));
    if (!visible.some((v) => v.hash === picked)) picked = visible[0]?.hash ?? null;
    // Grouped and ordered like the Companion app (Bungie's vendor groups, in the order the vendors arrive); the kiosks
    // and sub-vendors outside every group fold away at the bottom (open while searching, or when one is picked).
    const groups = new Map();
    const extras = [];
    for (const v of visible) {
      if (v.extra && !only) {
        extras.push(v);
        continue;
      }
      const key = v.group || "Vendors";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(v);
    }
    const row = (v) =>
      el(
        "button",
        { class: "vd-row", type: "button", "aria-current": String(v.hash === picked), onclick: () => pick(v.hash) },
        el("span", { class: "vd-row__icon" }, v.icon ? el("img", { src: v.icon, alt: "", loading: "lazy" }) : ctx.svg(STORE)),
        el("span", { class: "vd-row__text" }, el("span", { class: "vd-row__name", text: v.name }), el("span", { class: "vd-row__where", text: v.subtitle && v.destination ? `${v.subtitle} · ${v.destination}` : v.destination || v.subtitle || "" })),
      );
    const fold = extras.length
      ? el(
          "details",
          { class: "vd-fold", open: extrasOpen || Boolean(search) || extras.some((v) => v.hash === picked) ? true : null, ontoggle: (event) => (extrasOpen = event.target.open) },
          el("summary", {}, label("Kiosks and more", `${extras.length}`)),
          ...extras.map(row),
        )
      : null;
    const list = el(
      "nav",
      { class: "vd-list", "aria-label": "Vendors" },
      ...[...groups].flatMap(([name, vendors]) => [label(name, `${vendors.length}`), ...vendors.map(row)]),
      fold,
      visible.length ? null : el("p", { class: "tab__note", text: search ? "No vendor matches your search." : (empty ?? "Bungie listed no vendors for this character.") }),
    );
    // The Inventory's search box (inv-search in inventory.css).
    const searchBox = el(
      "label",
      { class: "inv-search vd-search" },
      ctx.svg(SEARCH),
      el("input", {
        type: "search",
        placeholder: "Search items",
        value: search,
        "aria-label": "Search vendors and items",
        oninput: (event) => {
          search = event.target.value.trim().toLowerCase();
          const pos = event.target.selectionStart;
          draw();
          const input = root.querySelector(".vd-search input");
          input?.focus();
          input?.setSelectionRange(pos, pos);
        },
      }),
    );
    const top = el(
      "header",
      { class: "sh-top" },
      el("div", { class: "sh-top__text" }, el("span", { class: "sh-top__kicker", text: `${all.length} you can visit · ${ctx.state.account?.name ?? ""}` }), el("h1", { class: "sh-top__title", text: title })),
      el(
        "div",
        { class: "sh-top__tools" },
        characterPicker(ctx, characters, chosen(), (id) => {
          lastCharacter.vendors = id;
          picked = null;
          load(false);
        }),
        searchBox,
        el("button", { class: "btn btn--small", type: "button", text: "Refresh", onclick: () => load(true) }),
      ),
    );
    // The page and the list keep their scroll positions (picking a vendor starts its page at the top: `toTop`).
    const scroll = toTop ? 0 : (root.querySelector(".sh-body")?.scrollTop ?? 0);
    const listScroll = root.querySelector(".vd-list")?.scrollTop ?? 0;
    toTop = false;
    const scroller = el("div", { class: "sh-body" }, el("div", { class: "vd-layout" }, list, vendorView(visible.find((v) => v.hash === picked))));
    root.replaceChildren(backdrop, top, scroller, tip);
    scroller.scrollTop = scroll;
    list.scrollTop = listScroll;
  }
  let toTop = false;
  function pick(hash) {
    picked = hash;
    toTop = true;
    draw();
  }

  async function load(fresh) {
    if (!characters.length || fresh) {
      container.replaceChildren(loadingView(ctx, "Reading your characters from Bungie…", "activity"));
      const activity = await read(ctx, "activity", fresh);
      if (!activity?.ok) return container.replaceChildren(problemView(ctx, activity?.error ?? "Something went wrong.", () => load(true)));
      characters = activity.data.characters ?? [];
    }
    const id = chosen();
    if (!id) return container.replaceChildren(problemView(ctx, "Bungie listed no characters on this account.", () => load(true)));
    if (fresh || !byCharacter[id]) {
      container.replaceChildren(loadingView(ctx, "Reading the vendors from Bungie… (the first time takes a little longer)", "vendors"));
      const result = await ctx.hub.d2Vendors(id);
      if (!result?.ok) return container.replaceChildren(problemView(ctx, result?.error ?? "Something went wrong.", () => load(true)));
      byCharacter[id] = result.data;
    }
    draw();
    container.replaceChildren(root);
  }
  load(false);
}
