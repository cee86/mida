// The News tab (Destiny 2): one feed, newest first, from Bungie.net's news (the API), Bungie Server Status and
// Destiny 2 on Bluesky, and the D2 Community Hub (an RSS feed). All four are fixed in news.rs.
//
//   [ NEWS ................................... All · Bungie · Server status · Destiny 2 · Community · refresh ]
//   [ Bungie article: picture, title, summary, Read ]   (Read opens the whole article inside the tab)
//   [ Bluesky post: avatar, name, @handle, text, pictures or a link card ]
//   [ D2 Community Hub: title, picture, text ]
//
// Text is always shown as text. Pictures from bungie.net load directly; the rest come through the app (news_image),
// which only fetches pictures the feeds listed. Links open in the browser through the app (open_news), which only
// opens links the feeds listed. `articleReader` and `loadPicture` are also used by the Director's news strip.

import { subpages } from "./subpages.js";
import { wallpaper } from "./wallpaper.js";

const FILTERS = [
  ["all", "All"],
  ["bungie", "Bungie"],
  ["status", "Server status"],
  ["d2", "Destiny 2"],
  ["community", "Community"],
];
const when = (iso) => {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 60) return `${Math.max(1, m)}m ago`;
  if (m < 24 * 60) return `${Math.round(m / 60)}h ago`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: new Date(t).getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
};

// Pictures: bungie.net ones straight away; others through the app when they scroll into view.
const pictureCache = new Map();
const watcher = typeof IntersectionObserver === "function"
  ? new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        watcher.unobserve(e.target);
        fill(e.target);
      }
    }, { rootMargin: "300px" })
  : null;
async function fill(img) {
  const url = img.dataset.src;
  if (!url) return;
  let data = pictureCache.get(url);
  if (!data) {
    const r = await window.hub?.newsImage?.(url);
    if (!r?.ok) return img.classList.add("is-missing");
    data = r.data;
    pictureCache.set(url, data);
  }
  img.src = data;
}
export function loadPicture(ctx, url, cls = "", alt = "") {
  const img = ctx.el("img", { class: cls, alt, loading: "lazy" });
  if (!url) return img;
  if (url.startsWith("https://www.bungie.net/")) img.src = url;
  else {
    img.dataset.src = url;
    if (pictureCache.has(url)) img.src = pictureCache.get(url);
    else if (watcher) watcher.observe(img);
    else fill(img);
  }
  return img;
}
const openLink = (ctx, url) => url && ctx.hub.openNews(url);

// A Bungie article, whole: its picture, title, date, then its text and pictures as blocks.
export function articleReader(ctx, host, item, wall) {
  const { el } = ctx;
  const body = [];
  let list = null;
  for (const b of item.blocks ?? []) {
    if (b.type === "li") {
      if (!list) body.push((list = el("ul", { class: "nw-article__list" })));
      list.append(el("li", { text: b.text }));
      continue;
    }
    list = null;
    if (b.type === "h") body.push(el("h3", { text: b.text }));
    else if (b.type === "img") body.push(loadPicture(ctx, b.src, "nw-article__pic", b.alt));
    else body.push(el("p", { text: b.text }));
  }
  host.replaceChildren(
    el(
      "div",
      { class: "tab nw sh" },
      wallpaper(ctx, wall),
      el(
        "div",
        { class: "sh-body" },
        el(
          "article",
          { class: "nw-article" },
          item.image ? loadPicture(ctx, item.image, "nw-article__hero") : null,
          el("div", { class: "nw-article__meta", text: `Bungie.net · ${when(item.at)}` }),
          el("h1", { class: "nw-article__title", text: item.title }),
          ...(body.length ? body : [el("p", { text: item.text || "Bungie didn't include this article's text." })]),
          el("button", { class: "btn", type: "button", text: "Open on bungie.net", onclick: () => openLink(ctx, item.link) }),
        ),
      ),
    ),
  );
}

export function newsTab(ctx, container, deps = {}) {
  const { el, svg } = ctx;
  const { loadingView, problemView } = deps;
  const wall = deps.wallpaper ?? "tab-news";
  const pages = subpages(ctx, container, "News");
  const root = el("div", { class: "tab nw sh" });
  const backdrop = wallpaper(ctx, wall);
  let data = null;
  let filter = "all";
  let shown = 30;

  function bungieCard(it) {
    return el(
      "article",
      { class: "nw-card nw-card--bungie" },
      it.image ? el("button", { class: "nw-card__hero", type: "button", "aria-label": `Read ${it.title}`, onclick: () => read(it) }, loadPicture(ctx, it.image)) : null,
      el(
        "div",
        { class: "nw-card__body" },
        el("div", { class: "nw-card__meta" }, el("span", { class: "nw-source nw-source--bungie", text: "Bungie.net" }), el("span", { text: when(it.at) })),
        el("h2", { class: "nw-card__title", text: it.title }),
        it.text ? el("p", { class: "nw-card__text", text: it.text }) : null,
        el("div", { class: "nw-card__actions" }, el("button", { class: "btn btn--small btn--primary", type: "button", text: "Read", onclick: () => read(it) }), el("button", { class: "btn btn--small", type: "button", text: "Open on bungie.net", onclick: () => openLink(ctx, it.link) })),
      ),
    );
  }

  function blueskyCard(it) {
    const a = it.author ?? {};
    const pics = it.images ?? [];
    return el(
      "article",
      { class: "nw-card nw-card--post" },
      el(
        "div",
        { class: "nw-card__body" },
        it.repostBy ? el("div", { class: "nw-card__repost", text: `↻ Reposted by ${it.repostBy}` }) : null,
        el(
          "div",
          { class: "nw-post__head" },
          el("span", { class: "nw-post__avatar" }, a.avatar ? loadPicture(ctx, a.avatar) : null),
          el("span", { class: "nw-post__who" }, el("strong", { text: a.name || a.handle }), el("small", { text: `@${a.handle} · ${when(it.at)}` })),
          el("span", { class: `nw-source nw-source--${it.source}`, text: it.sourceName }),
        ),
        it.text ? el("p", { class: "nw-post__text", text: it.text }) : null,
        pics.length ? el("div", { class: `nw-post__pics nw-post__pics--${Math.min(4, pics.length)}` }, ...pics.slice(0, 4).map((p) => loadPicture(ctx, p.src, "", p.alt))) : null,
        !pics.length && it.video ? el("div", { class: "nw-post__pics nw-post__pics--1" }, loadPicture(ctx, it.video, "", "Video")) : null,
        it.external?.uri
          ? el(
              "button",
              { class: "nw-link", type: "button", onclick: () => openLink(ctx, it.external.uri) },
              it.external.thumb ? loadPicture(ctx, it.external.thumb, "nw-link__thumb") : null,
              el("span", { class: "nw-link__text" }, el("strong", { text: it.external.title || it.external.uri }), it.external.description ? el("span", { text: it.external.description }) : null, el("small", { text: hostOf(it.external.uri) })),
            )
          : null,
        el("div", { class: "nw-card__actions" }, el("span", { class: "nw-post__counts", text: `♥ ${it.likes ?? 0}  ↻ ${it.reposts ?? 0}` }), el("button", { class: "btn btn--small", type: "button", text: "Open on Bluesky", onclick: () => openLink(ctx, it.link) })),
      ),
    );
  }

  function rssCard(it) {
    return el(
      "article",
      { class: "nw-card nw-card--rss" },
      it.image ? el("button", { class: "nw-card__hero", type: "button", "aria-label": it.title, onclick: () => openLink(ctx, it.link) }, loadPicture(ctx, it.image)) : null,
      el(
        "div",
        { class: "nw-card__body" },
        el("div", { class: "nw-card__meta" }, el("span", { class: "nw-source nw-source--community", text: it.sourceName }), it.author?.name ? el("span", { text: it.author.name }) : null, el("span", { text: when(it.at) })),
        it.title ? el("h2", { class: "nw-card__title", text: it.title }) : null,
        it.text ? el("p", { class: "nw-card__text", text: it.text }) : null,
        el("div", { class: "nw-card__actions" }, el("button", { class: "btn btn--small", type: "button", text: "Open", onclick: () => openLink(ctx, it.link) })),
      ),
    );
  }

  const hostOf = (u) => {
    try {
      return new URL(u).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  };
  const read = (it) => pages.show(`article-${it.id}`, it.title, (host) => articleReader(ctx, host, it, wall));

  function draw() {
    const list = (data?.items ?? []).filter((it) => filter === "all" || it.source === filter);
    const switcher = el(
      "div",
      { class: "segmented nw-filters", role: "group", "aria-label": "Show" },
      ...FILTERS.map(([id, name]) => el("button", { type: "button", "aria-pressed": String(filter === id), text: name, onclick: () => ((filter = id), (shown = 30), draw()) })),
    );
    const top = el(
      "header",
      { class: "sh-top" },
      el("div", { class: "sh-top__text" }, el("span", { class: "sh-top__kicker", text: "Bungie · Bluesky · D2 Community Hub" }), el("h1", { class: "sh-top__title", text: "News" })),
      el("div", { class: "sh-top__tools" }, switcher, el("button", { class: "btn btn--small", type: "button", text: "Refresh", onclick: () => start(true) })),
    );
    const problems = Object.entries(data?.problems ?? {}).filter(([k]) => filter === "all" || filter === k);
    const scroll = root.querySelector(".sh-body")?.scrollTop ?? 0;
    const body = el(
      "div",
      { class: "sh-body" },
      el(
        "div",
        { class: "nw-feed" },
        ...problems.map(([, text]) => el("p", { class: "tab__error nw-problem", text })),
        ...list.slice(0, shown).map((it) => (it.source === "bungie" ? bungieCard(it) : it.source === "community" ? rssCard(it) : blueskyCard(it))),
        list.length > shown ? el("button", { class: "btn nw-more", type: "button", text: `Show more (${list.length - shown})`, onclick: () => ((shown += 30), draw()) }) : null,
        list.length ? null : el("p", { class: "tab__note", text: problems.length ? "Nothing to show from here right now." : "No posts yet." }),
      ),
    );
    root.replaceChildren(backdrop, top, body);
    body.scrollTop = scroll;
  }

  async function start(fresh) {
    if (!data || fresh) container.replaceChildren(loadingView ? loadingView(ctx, "Reading the news…", "news") : el("p", { class: "tab__note", text: "Reading the news…" }));
    const r = await ctx.hub.d2News(fresh);
    if (!r?.ok) return container.replaceChildren(problemView ? problemView(ctx, r?.error ?? "Couldn't read the news.", () => start(true)) : el("p", { class: "tab__error", text: r?.error ?? "Couldn't read the news." }));
    data = r.data;
    draw();
    pages.setHome(root);
  }
  start(false);
}
