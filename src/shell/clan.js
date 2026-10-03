// The Clan tab (Destiny 2), styled like the Seasonal Hub (sh-* classes from seasonal.css):
//
//   [ CLAN · [TAG] motto ......................................................... search · refresh ]
//   [ about: founded, members, clan level, your rank ] [ online now: name, class, what they're playing ]
//                                                      [ everyone: rank, last online, joined           ]
//
// From d2_clan (bungie.rs `clan`): the signed-in player's own clan only, never anyone else's.

const RANKS = { 1: "Beginner", 2: "Member", 3: "Admin", 4: "Acting founder", 5: "Founder" };
const clean = (text) => String(text ?? "").trim();
const ago = (seconds) => {
  const at = Number(seconds) * 1000;
  if (!at) return "";
  const m = Math.round((Date.now() - at) / 60000);
  if (m < 60) return `${Math.max(1, m)} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d < 60 ? `${d} days ago` : new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};
const dateOf = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "");

export function clanTab(ctx, container, { loadingView, problemView }) {
  const { el, svg } = ctx;
  const root = el("div", { class: "tab cl sh" });
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
  let data = null;
  let search = "";
  const label = (title, extra) => el("div", { class: "sh-label" }, el("span", { class: "sh-label__text", text: title }), extra != null ? el("span", { class: "sh-label__count", text: extra }) : null);

  function member(m) {
    const status = m.online ? (m.activity ? `${m.activityClass ? `${m.activityClass} · ` : ""}${m.activity}` : "Online") : `Last online ${ago(m.lastOnline)}`;
    return el(
      "div",
      { class: `cl-member${m.online ? " is-online" : ""}${m.you ? " is-you" : ""}` },
      el("span", { class: "cl-member__icon" }, m.icon ? el("img", { src: m.icon, alt: "", loading: "lazy" }) : null, m.online ? el("i", { class: "cl-dot", title: "Online" }) : null),
      el("span", { class: "cl-member__text" }, el("span", { class: "cl-member__name" }, el("strong", { text: m.name }), m.code ? el("span", { class: "cl-member__code", text: `#${m.code}` }) : null, m.you ? el("span", { class: "cl-you", text: "You" }) : null), el("span", { class: "cl-member__status", text: status })),
      el("span", { class: "cl-member__rank", text: RANKS[m.rank] ?? "Member" }),
      el("span", { class: "cl-member__joined", text: m.joined ? `Joined ${dateOf(m.joined)}` : "" }),
    );
  }

  function draw() {
    const c = data.clan;
    const members = data.members ?? [];
    const shown = members.filter((m) => !search || `${m.name}#${m.code ?? ""}`.toLowerCase().includes(search));
    const online = shown.filter((m) => m.online);
    const rest = shown.filter((m) => !m.online);
    const lvl = c.level;
    const about = el(
      "section",
      { class: "sh-box cl-about" },
      label("About"),
      c.motto ? el("p", { class: "cl-motto", text: `“${clean(c.motto)}”` }) : null,
      c.about ? el("p", { class: "cl-text", text: clean(c.about) }) : null,
      el(
        "dl",
        { class: "cl-facts" },
        ...[
          ["Members", `${c.memberCount ?? members.length} of 100`],
          ["Online now", String(members.filter((m) => m.online).length)],
          ["Founded", dateOf(c.founded)],
          lvl ? ["Clan level", `${lvl.level}${lvl.cap ? ` of ${lvl.cap}` : ""}`] : null,
          ["Your rank", RANKS[c.yourRank] ?? "Member"],
          ["You joined", dateOf(c.joined)],
        ]
          .filter(Boolean)
          .map(([k, v]) => el("div", {}, el("dt", { text: k }), el("dd", { text: v }))),
      ),
    );
    const search_ = el(
      "label",
      { class: "inv-search cl-search" },
      svg(["M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z", "M20 20l-4-4"]),
      el("input", {
        type: "search",
        placeholder: "Find a member",
        value: search,
        "aria-label": "Find a member",
        oninput: (event) => {
          search = event.target.value.trim().toLowerCase();
          const pos = event.target.selectionStart;
          draw();
          const input = root.querySelector(".cl-search input");
          input?.focus();
          input?.setSelectionRange(pos, pos);
        },
      }),
    );
    const top = el(
      "header",
      { class: "sh-top" },
      el("div", { class: "sh-top__text" }, el("span", { class: "sh-top__kicker", text: c.tag ? `Clan · [${c.tag}]` : "Clan" }), el("h1", { class: "sh-top__title", text: c.name || "Your clan" })),
      el("div", { class: "sh-top__tools" }, search_, el("button", { class: "btn btn--small", type: "button", text: "Refresh", onclick: () => load(true) })),
    );
    const lists = el(
      "div",
      { class: "sh-main" },
      el("section", { class: "sh-box" }, label("Online now", String(online.length)), online.length ? el("div", { class: "cl-members" }, ...online.map(member)) : el("p", { class: "tab__note", text: search ? "No one online matches." : "No one's online right now." })),
      el("section", { class: "sh-box" }, label("Everyone else", String(rest.length)), rest.length ? el("div", { class: "cl-members" }, ...rest.map(member)) : el("p", { class: "tab__note", text: "No one matches." })),
      el("p", { class: "tab__note", text: "What online members are playing is their latest character's current activity, as Bungie shares it (the first 12 online)." }),
    );
    const scroll = root.querySelector(".sh-body")?.scrollTop ?? 0;
    const body = el("div", { class: "sh-body" }, el("div", { class: "cl-layout" }, about, lists));
    root.replaceChildren(backdrop, top, body);
    body.scrollTop = scroll;
  }

  async function load(fresh) {
    if (!data || fresh) container.replaceChildren(loadingView(ctx, "Reading your clan from Bungie…", "clan"));
    const result = await ctx.hub.d2Clan();
    if (!result?.ok) return container.replaceChildren(problemView(ctx, result?.error ?? "Something went wrong.", () => load(true)));
    data = result.data;
    if (!data.clan) return container.replaceChildren(problemView(ctx, "You're not in a clan on this account. Join one in the game, then come back.", () => load(true)));
    draw();
    if (!container.contains(root)) container.replaceChildren(root);
  }
  load(false);
}
