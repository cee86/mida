// Pages inside a tab (the Guardian and Director tabs): a page opens over the tab's home with a back bar on top
// ("‹ Director · Vendors") and the screen underneath. Each page is built once and kept, so going back and forth is
// instant; the tab's home stays built too.

export function subpages(ctx, container, homeName) {
  const { el, svg } = ctx;
  const pages = new Map(); // key -> host element
  let home = null;
  let current = null;

  function show(key, title, build) {
    let host = pages.get(key);
    const fresh = !host;
    if (fresh) {
      host = el("div", { class: "sub__host" });
      pages.set(key, host);
    }
    current = key;
    const bar = el(
      "div",
      { class: "sub__bar" },
      el("button", { class: "sub__back", type: "button", "aria-label": `Back to ${homeName}`, onclick: back }, svg(["M15 5l-7 7 7 7"]), el("span", { text: homeName })),
      el("span", { class: "sub__sep", text: "·" }),
      el("span", { class: "sub__title", text: title }),
    );
    container.replaceChildren(el("div", { class: "sub" }, bar, host));
    if (fresh) build(host);
    else host.midaShown?.();
  }
  function back() {
    current = null;
    if (home) container.replaceChildren(home);
  }
  return {
    show,
    back,
    setHome(node) {
      home = node;
      if (!current) container.replaceChildren(node);
    },
    get open() {
      return current;
    },
  };
}
