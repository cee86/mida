// Modules: the companion sites the app can show, and the checks every saved or added
// module goes through. Pure (no Electron), so the rules are easy to read in one place.

// Sites offered in the first-run picker and in "Add a module". `starter` ones are ticked
// by default. Addresses are the sites' own home pages.
const CATALOGUE = [
  {
    id: "seals-report",
    name: "seals.report",
    url: "https://d2-seals-report.vercel.app/",
    blurb: "Seals and titles: what to do next and how far you are.",
    starter: true,
  },
  {
    id: "light-gg",
    name: "light.gg",
    url: "https://www.light.gg/",
    blurb: "Weapon and armor database, god rolls and popularity.",
    starter: true,
  },
  {
    id: "dim",
    name: "DIM",
    url: "https://app.destinyitemmanager.com/",
    blurb: "Destiny Item Manager: move gear, build loadouts, sort your vault.",
    starter: true,
  },
  {
    id: "raid-report",
    name: "raid.report",
    url: "https://raid.report/",
    blurb: "Raid clears, fastest times and flawless runs.",
  },
  {
    id: "dungeon-report",
    name: "dungeon.report",
    url: "https://dungeon.report/",
    blurb: "Dungeon clears, solos and flawless runs.",
  },
  {
    id: "d2-foundry",
    name: "D2 Foundry",
    url: "https://d2foundry.gg/",
    blurb: "Weapon perks and stats, roll by roll.",
  },
  {
    id: "braytech",
    name: "Braytech",
    url: "https://bray.tech/",
    blurb: "Triumphs, collections and checklists.",
  },
  {
    id: "today-in-destiny",
    name: "Today in Destiny",
    url: "https://www.todayindestiny.com/",
    blurb: "Daily and weekly rotations, vendors and resets.",
  },
];

const MAX_MODULES = 40;
const MAX_NAME = 40;
const MAX_URL = 2048;

// Only real web pages over https. No passwords in the address, no local files, no
// other programs' links (steam://, file:// ...): those could reach outside the app.
function cleanUrl(value) {
  if (typeof value !== "string" || value.length > MAX_URL) return null;
  let raw = value.trim();
  if (!raw) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) raw = `https://${raw}`;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (!url.hostname || !url.hostname.includes(".")) return null;
  return url.toString();
}

function cleanName(value, url) {
  const name = typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, MAX_NAME) : "";
  if (name) return name;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Module";
  }
}

// A saved favicon: only small images kept as data URLs, so the sidebar never loads
// anything from the web by itself.
function cleanIcon(value) {
  if (typeof value !== "string") return null;
  if (value.length > 300_000) return null;
  return /^data:image\/(png|x-icon|vnd\.microsoft\.icon|jpeg|gif|webp|svg\+xml);base64,[a-z0-9+/=]+$/i.test(value)
    ? value
    : null;
}

function cleanModule(value) {
  if (!value || typeof value !== "object") return null;
  const url = cleanUrl(value.url);
  if (!url) return null;
  const id = typeof value.id === "string" && /^[a-z0-9-]{1,48}$/.test(value.id) ? value.id : null;
  if (!id) return null;
  return { id, name: cleanName(value.name, url), url, icon: cleanIcon(value.icon) };
}

function cleanModules(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const mod = cleanModule(item);
    if (!mod || seen.has(mod.id)) continue;
    seen.add(mod.id);
    out.push(mod);
    if (out.length >= MAX_MODULES) break;
  }
  return out;
}

function fromCatalogue(id) {
  const entry = CATALOGUE.find((c) => c.id === id);
  return entry ? { id: entry.id, name: entry.name, url: entry.url, icon: null } : null;
}

// Hosts where one address can't stand for one site (anyone can have name.vercel.app),
// so the site is the last three parts of the name instead of the last two.
const SHARED_SUFFIXES = new Set([
  "vercel.app", "netlify.app", "github.io", "pages.dev", "web.app", "firebaseapp.com",
  "herokuapp.com", "co.uk", "com.au", "co.jp", "com.br",
]);

function siteOf(hostname) {
  const parts = hostname.toLowerCase().split(".").filter(Boolean);
  const two = parts.slice(-2).join(".");
  return SHARED_SUFFIXES.has(two) ? parts.slice(-3).join(".") : two;
}

function sameSite(a, b) {
  try {
    return siteOf(new URL(a).hostname) === siteOf(new URL(b).hostname);
  } catch {
    return false;
  }
}

// Sign-in pages companion sites send you to (Bungie and the platforms Bungie accepts).
// Pop-ups to these open inside the app so the sign-in can hand back to the site.
const SIGN_IN_SITES = new Set([
  "bungie.net", "steamcommunity.com", "steampowered.com", "live.com", "microsoftonline.com",
  "xbox.com", "microsoft.com", "playstation.com", "sonyentertainmentnetwork.com",
  "epicgames.com", "twitch.tv", "discord.com", "google.com",
]);

function isSignInUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && SIGN_IN_SITES.has(siteOf(url.hostname));
  } catch {
    return false;
  }
}

function isWebUrl(value) {
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

module.exports = {
  CATALOGUE,
  MAX_MODULES,
  cleanUrl,
  cleanName,
  cleanIcon,
  cleanModule,
  cleanModules,
  fromCatalogue,
  sameSite,
  isSignInUrl,
  isWebUrl,
};
