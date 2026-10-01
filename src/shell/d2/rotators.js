// Daily and weekly rotators Bungie's API doesn't report reliably (Featured's "Rotations"): each is a loop of
// entries (a strike, mission, boss or place, and its `detail`: the weapon it offers, or where it is when
// `detailIsPlace`) that moves one step at every daily or
// weekly reset. Where the loop is on a given day is worked out from an anchor: which entry was current at a
// known reset. The defaults below come from guide sites (Sep 2026) and are only as good as that research, so
// the admin page can set "what's up right now" (and edit a loop's entries) for each one; that's saved in the
// Redis hash `rotators` and wins over the defaults. Pure: no network, safe for any page.

export const DAY_MS = 24 * 60 * 60 * 1000;
export const WEEK_MS = 7 * DAY_MS;
// Destiny resets daily at 17:00 UTC; the weekly reset is Tuesday's. 29 Sep 2026 was a Tuesday.
const RESET = Date.UTC(2026, 8, 29, 17);
export const MAX_ENTRIES = 20;
export const MAX_TEXT = 80;

// `keywords` find related seal triumphs by wording; entry names are matched too. `art` names the activity
// whose loading-screen image the card uses ("current" = the current entry's own name, e.g. a strike).
export const ROTATORS = [
  {
    id: "grandmaster",
    title: "Grandmaster Vanguard Alert",
    kicker: "Grandmaster",
    period: "weekly",
    place: "Vanguard",
    keywords: ["grandmaster"],
    art: "current",
    // Known weeks only (the owner's screenshots: The Sunless Cell 22 Sep, Exodus Crash 29 Sep 2026). Other weeks say
    // it isn't set (`knownOnce`) until Bungie's list names it or the season's list goes in through the admin page.
    knownOnce: true,
    entries: [
      { name: "The Sunless Cell", detail: "Adored (Sniper Rifle)" },
      { name: "Exodus Crash", detail: "The Slammer" },
    ],
    anchor: { index: 1, at: Date.UTC(2026, 8, 29, 17) },
  },
  {
    id: "exotic-mission",
    title: "Exotic mission",
    kicker: "Exotic mission",
    period: "weekly",
    place: "Pinnacle Ops",
    keywords: ["exotic mission"],
    art: "current",
    // The seven-week loop from the owner's rotation screenshot (Presage the week of 22 Sep 2026).
    confirmed: true,
    entries: [
      { name: "Encore", detail: "Choir of One (Auto Rifle)" },
      { name: "Kell's Fall", detail: "Slayer's Fang (Shotgun)" },
      { name: "Presage", detail: "Dead Man's Tale (Scout Rifle)" },
      { name: "Vox Obscura", detail: "Dead Messenger (Grenade Launcher)" },
      { name: "Operation: Seraph's Shield", detail: "Revision Zero (Pulse Rifle)" },
      { name: "//node.ovrd.AVALON//", detail: "Vexcalibur (Glaive)" },
      { name: "Starcrossed", detail: "Wish-Keeper (Combat Bow)" },
    ],
    anchor: { index: 2, at: Date.UTC(2026, 8, 22, 17) },
  },
  {
    id: "pantheon",
    title: "Pantheon",
    kicker: "Pantheon",
    period: "weekly",
    place: "Monument of Triumph",
    keywords: ["pantheon"],
    art: "Pantheon",
    // Each week features one reprise and one encore boss. Bungie's list names them ("Featured Reprise: Gahlran",
    // "Featured Encore: Warpriest"), which is read automatically; this is only the fallback (owner, 29 Sep 2026).
    knownOnce: true,
    entries: [{ name: "Reprise: Gahlran · Encore: Warpriest" }],
    anchor: { index: 0, at: Date.UTC(2026, 8, 29, 17) },
  },
  {
    id: "ascendant",
    title: "Ascendant Challenge",
    kicker: "Ascendant Challenge",
    period: "weekly",
    place: "Dreaming City",
    keywords: ["ascendant challenge"],
    art: "The Dreaming City",
    // Fixed loop (the Dreaming City card and the triumph checks use it); only "right now" can be changed.
    // Confirmed by the owner's rotation screenshot (Ouroborea the week of 22 Sep 2026).
    fixed: true,
    confirmed: true,
    detailIsPlace: true,
    entries: [
      { name: "Ouroborea", detail: "Aphelion's Rest" },
      { name: "Forfeit Shrine", detail: "Gardens of Esila" },
      { name: "Shattered Ruins", detail: "Spine of Keres" },
      { name: "Keep of Honed Edges", detail: "Harbinger's Seclude" },
      { name: "Agonarch Abyss", detail: "Bay of Drowned Wishes" },
      { name: "Cimmerian Garrison", detail: "Chamber of Starlight" },
    ],
    anchor: { index: 0, at: Date.UTC(2026, 8, 22, 17) },
  },
  {
    id: "wellspring",
    title: "The Wellspring",
    kicker: "Wellspring",
    period: "daily",
    place: "Savathûn's Throne World",
    keywords: ["wellspring"],
    art: "The Wellspring",
    // Attack and Defend alternate daily (owner's screenshot: Defend on 28 Sep 2026); which boss and weapon each
    // day brings is from memory, so the admin may need to pick the right one.
    entries: [
      { name: "Attack: Golmag, Warden of the Spring", detail: "Come to Pass (Auto Rifle)" },
      { name: "Defend: Vezuul, Lightflayer", detail: "Tarnation (Grenade Launcher)" },
      { name: "Attack: Bor'gong, Warden of the Spring", detail: "Fel Taradiddle (Combat Bow)" },
      { name: "Defend: Zeerik, Lightflayer", detail: "Father's Sins (Sniper Rifle)" },
    ],
    anchor: { index: 1, at: Date.UTC(2026, 8, 28, 17) },
  },
  {
    id: "lucent",
    title: "Lucent Executioner",
    kicker: "Lucent Executioner",
    period: "daily",
    place: "Savathûn's Throne World",
    keywords: ["lucent executioner", "executioner"],
    art: "Savathûn's Throne World",
    // Which Executioner is out today (for the Ascended Bounty Hunter triumph); owner's screenshot, Alluring
    // Curtain on 28 Sep 2026.
    confirmed: true,
    entries: [{ name: "Witch's Echo Executioner" }, { name: "Queen's Bailey Executioner" }, { name: "Alluring Curtain Executioner" }],
    anchor: { index: 2, at: Date.UTC(2026, 8, 28, 17) },
  },
  {
    id: "altars",
    title: "Altars of Sorrow",
    kicker: "Altars of Sorrow",
    period: "daily",
    place: "The Moon",
    keywords: ["altars of sorrow", "altar of sorrow"],
    art: "Altars of Sorrow",
    // Order from the owner's screenshot (Phogoth on 28 Sep 2026); weapons per boss from guide sites.
    confirmed: true,
    entries: [
      { name: "Nightmare of Taniks, the Scarred", detail: "Apostate (Sniper Rifle)" },
      { name: "Nightmare of Zydron, Gate Lord", detail: "Heretic (Rocket Launcher)" },
      { name: "Nightmare of Phogoth, the Untamed", detail: "Blasphemer (Shotgun)" },
    ],
    anchor: { index: 2, at: Date.UTC(2026, 8, 28, 17) },
  },
  // v0.48, from the owner's list of weekly activities seal triumphs depend on. These loops are from memory and guide
  // sites and where each one is this week isn't known (`unset`), so they read "Not set this week" until Bungie's
  // list names the current one or the admin picks it; after that they count forward by themselves.
  {
    id: "wandering-nightmares",
    title: "Wandering Nightmares",
    kicker: "Wandering Nightmare",
    period: "weekly",
    place: "The Moon",
    keywords: ["wandering nightmare"],
    art: null,
    unset: true,
    entries: [
      { name: "Nightmare of Horkis, Fear of Mithrax" },
      { name: "Nightmare of Jaxx, Claw of Xivu Arath" },
      { name: "Nightmare of Xortal, Sworn of Crota" },
      { name: "Nightmare of Hashladûn, Daughter of Crota" },
    ],
    anchor: { index: 0, at: RESET },
  },
  {
    id: "empire-hunt",
    title: "Empire Hunt",
    kicker: "Empire Hunt",
    period: "weekly",
    place: "Europa",
    keywords: ["empire hunt", "master hunt"],
    art: null,
    unset: true,
    entries: [{ name: "Phylaks, the Warrior" }, { name: "Praksis, the Technocrat" }, { name: "Kridis, the Dark Priestess" }],
    anchor: { index: 0, at: RESET },
  },
  {
    id: "exo-challenge",
    title: "Exo Challenge",
    kicker: "Exo Challenge",
    period: "weekly",
    place: "Europa",
    keywords: ["exo challenge", "exo simulation"],
    art: null,
    unset: true,
    entries: [{ name: "Simulation: Agility" }, { name: "Simulation: Endurance" }, { name: "Simulation: Safeguard" }],
    anchor: { index: 0, at: RESET },
  },
  {
    id: "eclipsed-zone",
    title: "Eclipsed Zone",
    kicker: "Eclipsed Zone",
    period: "weekly",
    place: "Europa",
    keywords: ["eclipsed zone"],
    art: null,
    unset: true,
    detailIsPlace: false,
    entries: [{ name: "Cadmus Ridge" }, { name: "Asterion Abyss" }, { name: "Eventide Ruins" }],
    anchor: { index: 0, at: RESET },
  },
  {
    id: "partition",
    title: "Partition",
    kicker: "Partition",
    period: "weekly",
    place: "Neomuna",
    keywords: ["partition"],
    art: null,
    unset: true,
    entries: [{ name: "Partition: Backdoor" }, { name: "Partition: Ordnance" }, { name: "Partition: Hard Reset" }],
    anchor: { index: 0, at: RESET },
  },
  // Weekly lockouts with nothing to pick (`reminder`): they reset every week, and the seal triumphs tied to them are
  // listed, so they go in Featured's weekly checklist rather than the rotations.
  ...[
    { id: "vex-incursion", title: "Vex Incursion Zone", place: "Neomuna", detail: "The zone moves every week", keywords: ["vex incursion", "incursion zone"] },
    { id: "action-figures", title: "Neomuna action figures", place: "Neomuna", detail: "A new set of puzzles every week", keywords: ["action figure"] },
    { id: "vespers-puzzles", title: "Vesper's Host puzzles", place: "Vesper's Host", detail: "Code declassification and puzzles, weekly", keywords: ["declassif"] },
    { id: "campaign", title: "Campaign replays", place: "Weekly lockout", detail: "Legendary campaign missions reset weekly", keywords: ["legendary campaign", "campaign mission"] },
    { id: "dares", title: "Dares of Eternity", place: "Eternity", detail: "Enemy lineup cycles every three weeks", keywords: ["dares of eternity"] },
  ].map((r) => ({
    id: r.id,
    title: r.title,
    kicker: "Weekly",
    period: "weekly",
    place: r.place,
    keywords: r.keywords,
    art: null,
    reminder: true,
    fixed: true,
    confirmed: true,
    entries: [{ name: r.title, detail: r.detail }],
    anchor: { index: 0, at: RESET },
  })),
];

export const ROTATOR_IDS = ROTATORS.map((r) => r.id);

const mod = (n, m) => ((n % m) + m) % m;
const periodMs = (def) => (def.period === "daily" ? DAY_MS : WEEK_MS);

// The reset that began the current day or week (daily at 17:00 UTC, weekly on Tuesdays).
export function lastReset(period, now = Date.now()) {
  const size = period === "daily" ? DAY_MS : WEEK_MS;
  return RESET + Math.floor((now - RESET) / size) * size;
}

// A rotator with the admin's saved changes applied: { ...def, entries, anchor, custom }.
export function withSaved(def, saved) {
  const entries = !def.fixed && Array.isArray(saved?.entries) && saved.entries.length ? saved.entries : def.entries;
  const valid = saved && Number.isInteger(saved.index) && saved.index >= 0 && saved.index < entries.length && Number.isFinite(saved.at);
  // `confirmed`: the built-in loop was checked against the game (or the admin has set it).
  return { ...def, entries, anchor: valid ? { index: saved.index, at: saved.at } : def.anchor, custom: Boolean(valid), confirmed: Boolean(valid || def.confirmed) };
}

// Where a rotator is now: the current entry, when it changes, and the next few.
export function rotatorNow(rotator, now = Date.now(), upcoming = 3) {
  const size = periodMs(rotator);
  const steps = Math.floor((now - rotator.anchor.at) / size);
  const n = rotator.entries.length;
  const index = mod(rotator.anchor.index + steps, n);
  const start = rotator.anchor.at + steps * size;
  // Never set (v0.48): which entry is up isn't known yet.
  if (rotator.unset && !rotator.custom) {
    return {
      index,
      unknown: true,
      current: { name: "Not set this week", detail: `Rotates through ${n}: ${rotator.entries.map((e) => e.name.split(",")[0]).join(", ")}` },
      ends: new Date(start + size).toISOString(),
      next: [],
    };
  }
  if (rotator.knownOnce && !rotator.custom && steps !== 0) {
    const last = rotator.entries[rotator.anchor.index];
    return {
      index,
      unknown: true,
      current: { name: "Not set this week", detail: `Last known: ${last.name}${last.detail ? `, ${last.detail}` : ""}` },
      ends: new Date(start + size).toISOString(),
      next: [],
    };
  }
  return {
    index,
    current: rotator.entries[index],
    // Events read from Bungie (v0.47) end on their own date, not at a reset.
    ends: rotator.endsAt ?? new Date(start + size).toISOString(),
    next: n > 1
      ? Array.from({ length: Math.min(upcoming, n - 1) }, (_, k) => ({
          entry: rotator.entries[mod(index + k + 1, n)],
          starts: new Date(start + (k + 1) * size).toISOString(),
        }))
      : [],
  };
}

// Cleans an admin save: entries (unless the loop is fixed) as { name, detail? } with plain text only, and the
// index of the one that's current. Returns null when anything's off.
export function cleanRotatorSave(def, body) {
  const text = (v) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f<>]/g, "").trim() : "");
  let entries = def.entries;
  if (!def.fixed && body.entries !== undefined) {
    if (!Array.isArray(body.entries) || body.entries.length < 1 || body.entries.length > MAX_ENTRIES) return null;
    entries = body.entries.map((e) => ({ name: text(e?.name), detail: text(e?.detail) || undefined }));
    if (entries.some((e) => !e.name || e.name.length > MAX_TEXT || (e.detail && e.detail.length > MAX_TEXT))) return null;
  }
  if (!Number.isInteger(body.index) || body.index < 0 || body.index >= entries.length) return null;
  return { entries: def.fixed ? undefined : entries, index: body.index, at: lastReset(def.period) };
}

// When entry `index` is next up (now if it's current), as an ISO date.
export function nextStart(rotator, state, index) {
  const size = periodMs(rotator);
  const n = rotator.entries.length;
  const start = new Date(state.ends).getTime() - size;
  return new Date(start + mod(index - state.index, n) * size).toISOString();
}
