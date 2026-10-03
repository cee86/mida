// Wallpapers: a picture of the player's own behind each Destiny 2 tab, darkened and blurred, kept on this computer
// (Settings → Personalization → each tab). Pages opened inside a tab (the Seasonal Hub inside Director, Triumphs inside
// Guardian...) use that tab's picture. Without one, a tab shows MIDA's own dark backdrop; pictures chosen before
// v0.9.1 carry over (the Inventory's own key; the old "Seasonal Hub backdrop", which the other tabs used too).
// shell.js keeps a copy of WALL_TABS and wallKey for Settings (it isn't a module).

export const WALL_TABS = [
  ["tab-guardian", "Guardian"],
  ["tab-director", "Director"],
  ["tab-inventory", "Inventory"],
  ["tab-planner", "Weekly planner"],
  ["tab-featured", "Rotators"],
  ["tab-rad", "RAD Assistant"],
];
export const wallKey = (tab) => (tab === "tab-inventory" ? "mida-inv-backdrop" : `mida-wall:${String(tab).replace(/^tab-/, "")}`);

export function wallpaperOf(tab) {
  try {
    const own = localStorage.getItem(wallKey(tab));
    if (own || tab === "tab-inventory") return own;
    return localStorage.getItem("mida-sh-backdrop") || localStorage.getItem("mida-inv-backdrop");
  } catch {
    return null;
  }
}

// The backdrop layer for a screen (.inv-backdrop from inventory.css), repainted when Settings changes a picture.
// `quiet`: show nothing at all without a picture (the RAD Assistant keeps the theme's own background).
export function wallpaper(ctx, tab, { quiet = false } = {}) {
  const node = ctx.el("div", { class: "inv-backdrop sh-backdrop", "aria-hidden": "true" });
  const paint = () => {
    const picture = wallpaperOf(tab);
    node.style.backgroundImage = picture ? `url("${picture}")` : "";
    node.classList.toggle("has-picture", Boolean(picture));
    node.hidden = quiet && !picture;
  };
  paint();
  window.addEventListener("mida-backdrop", paint);
  return node;
}
