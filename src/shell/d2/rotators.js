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
// whose loading-screen image the card uses ("current" = the current entry's own name, e.g. a strike); since v0.58 it
// can be a list of names tried in order (the activity, then its destination), so every card gets a picture.
export const ROTATORS = [
  {
    id: "grandmaster",
    title: "Grandmaster Vanguard Alert",
    kicker: "Grandmaster",
    section: "pinnacle",
    titleIsEntry: true,
    period: "weekly",
    place: "Vanguard",
    keywords: ["grandmaster"],
    art: "current",
    // Known weeks only (the owner's screenshots: The Sunless Cell 22 Sep, Exodus Crash 29 Sep 2026). Other weeks say
    // it isn't set (`knownOnce`) until Bungie's list names it or the season's list goes in through the admin page.
    knownOnce: true,
    entries: [
      { name: "The Sunless Cell", detail: "Adored (Sniper Rifle)" },
      { name: "Exodus Crash", detail: "The Slammer (Sword)" },
    ],
    anchor: { index: 1, at: Date.UTC(2026, 8, 29, 17) },
  },
  {
    id: "exotic-mission",
    title: "Exotic Mission",
    kicker: "Exotic Mission",
    section: "pinnacle",
    titleIsEntry: true,
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
    // Labelled and grouped as a raid (owner, v0.55).
    kicker: "Raid",
    section: "raids",
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
    kicker: "Forsaken",
    section: "forsaken",
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
    kicker: "Witch Queen",
    section: "witch-queen",
    period: "daily",
    place: "Savathûn's Throne World",
    keywords: ["wellspring"],
    art: ["The Wellspring", "Savathûn's Throne World"],
    // Owner's rotation doc (v0.51): Vezuul and Tarnation on 30 Sep 2026, then Bor'gong, Zeerik, Golmag.
    confirmed: true,
    entries: [
      { name: "Attack: Golmag, Hive Ogre", detail: "Come to Pass (Auto Rifle)" },
      { name: "Defend: Vezuul, Solar Scorn Chieftain", detail: "Tarnation (Grenade Launcher)" },
      { name: "Attack: Bor'gong, Hive Knight", detail: "Fel Taradiddle (Combat Bow)" },
      { name: "Defend: Zeerik, Scorn Raider", detail: "Father's Sins (Sniper Rifle)" },
    ],
    anchor: { index: 1, at: Date.UTC(2026, 8, 30, 17) },
  },
  {
    id: "lucent",
    title: "Lucent Executioner",
    kicker: "Witch Queen",
    section: "witch-queen",
    period: "daily",
    place: "Savathûn's Throne World",
    keywords: ["lucent executioner", "executioner"],
    art: ["Savathûn's Throne World"],
    // Which Executioner is out today (for the Ascended Bounty Hunter triumph); owner's screenshot, Alluring
    // Curtain on 28 Sep 2026.
    confirmed: true,
    entries: [{ name: "Witch's Echo Executioner" }, { name: "Queen's Bailey Executioner" }, { name: "Alluring Curtain Executioner" }],
    anchor: { index: 2, at: Date.UTC(2026, 8, 28, 17) },
  },
  {
    id: "altars",
    title: "Altars of Sorrow",
    kicker: "Shadowkeep",
    section: "shadowkeep",
    period: "daily",
    place: "The Moon",
    keywords: ["altars of sorrow", "altar of sorrow"],
    art: ["Altars of Sorrow", "Altar of Sorrow", "The Moon"],
    // Order from the owner's screenshot (Phogoth on 28 Sep 2026); weapons per boss from guide sites.
    confirmed: true,
    entries: [
      { name: "Nightmare of Taniks, the Scarred", detail: "Apostate (Sniper Rifle)" },
      { name: "Nightmare of Zydron, Gate Lord", detail: "Heretic (Rocket Launcher)" },
      { name: "Nightmare of Phogoth, the Untamed", detail: "Blasphemer (Shotgun)" },
    ],
    anchor: { index: 2, at: Date.UTC(2026, 8, 28, 17) },
  },
  // v0.48 (owner's list of weekly activities seal triumphs depend on), with loops and this week's positions from the
  // owner's rotation doc (v0.51): every loop below starts with the entry that was up the week of 29 Sep 2026.
  {
    id: "wandering-nightmares",
    title: "Wandering Nightmare",
    kicker: "Shadowkeep",
    section: "shadowkeep",
    period: "weekly",
    place: "The Moon",
    keywords: ["wandering nightmare"],
    art: ["The Moon"],
    confirmed: true,
    detailKind: "place",
    entries: [
      { name: "Nightmare of Horkis, Fear of Mithrax", detail: "Anchor of Light" },
      { name: "Nightmare of Jaxx, Claw of Xivu Arath", detail: "Hellmouth" },
      { name: "Fallen Council", detail: "Archer's Line" },
      { name: "Nightmare of Xortal, Sworn of Crota", detail: "Sorrow's Harbor" },
    ],
    anchor: { index: 0, at: RESET },
  },
  {
    id: "empire-hunt",
    title: "Empire Hunt",
    kicker: "Beyond Light",
    section: "beyond-light",
    period: "weekly",
    place: "Europa",
    keywords: ["empire hunt", "master hunt"],
    art: ["Europa"],
    confirmed: true,
    entries: [{ name: "Kridis, the Dark Priestess" }, { name: "Praksis, the Technocrat" }, { name: "Phylaks, the Warrior" }],
    anchor: { index: 0, at: RESET },
  },
  {
    id: "exo-challenge",
    title: "Exo Challenge",
    kicker: "Beyond Light",
    section: "beyond-light",
    period: "weekly",
    place: "Europa",
    keywords: ["exo challenge", "exo simulation"],
    art: ["current", "Europa"],
    confirmed: true,
    entries: [{ name: "Simulation: Survival" }, { name: "Simulation: Safeguard" }, { name: "Simulation: Agility" }],
    anchor: { index: 0, at: RESET },
  },
  {
    id: "eclipsed-zone",
    title: "Eclipsed Zone",
    kicker: "Beyond Light",
    section: "beyond-light",
    period: "weekly",
    place: "Europa",
    keywords: ["eclipsed zone"],
    art: ["Europa"],
    confirmed: true,
    entries: [{ name: "Eventide Ruins" }, { name: "Cadmus Ridge" }, { name: "Asterion Abyss" }],
    anchor: { index: 0, at: RESET },
  },
  {
    id: "vex-incursion",
    title: "Vex Incursion Zone",
    kicker: "Lightfall",
    section: "lightfall",
    period: "weekly",
    place: "Neomuna",
    keywords: ["vex incursion", "incursion zone"],
    art: ["Neomuna"],
    confirmed: true,
    entries: [{ name: "Zephyr Concourse" }, { name: "Ahimsa Park" }, { name: "Límíng Harbor" }],
    anchor: { index: 0, at: RESET },
  },
  {
    id: "partition",
    title: "Partition",
    kicker: "Lightfall",
    section: "lightfall",
    period: "weekly",
    place: "Neomuna",
    keywords: ["partition"],
    art: ["current", "Neomuna"],
    confirmed: true,
    entries: [{ name: "Partition: Backdoor" }, { name: "Partition: Ordnance" }, { name: "Partition: Hard Reset" }],
    anchor: { index: 0, at: RESET },
  },
  // Neomuna's weekly story mission: a five-week loop (owner, 1 Oct 2026). Bungie's list also gives this week's away
  // (the only campaign mission with Advanced/Expert/Master).
  {
    id: "neomuna-mission",
    title: "Weekly Story Mission",
    kicker: "Lightfall",
    section: "lightfall",
    period: "weekly",
    place: "Neomuna",
    keywords: ["breakneck", "no time left", "desperate measures", "first contact", "downfall", "on the verge", "headlong", "under siege"],
    art: ["current", "Neomuna"],
    confirmed: true,
    entries: [{ name: "Breakneck" }, { name: "No Time Left" }, { name: "Desperate Measures" }, { name: "First Contact" }, { name: "Downfall" }],
    anchor: { index: 0, at: RESET },
  },
  // Kepler's weekly Fabled and Legendary missions (The Edge of Fate): both loop through these three (owner, 1 Oct 2026).
  {
    id: "kepler",
    title: "Weekly Missions",
    // Shown as "Fabled: The Invitation" on the card; the detail is already "Legendary: ...".
    namePrefix: "Fabled: ",
    kicker: "Edge of Fate",
    section: "edge-of-fate",
    period: "weekly",
    place: "Kepler",
    keywords: ["kepler", "fabled mission"],
    art: ["current", "Kepler"],
    confirmed: true,
    detailKind: "text",
    entries: [
      { name: "The Invitation", detail: "Legendary: The Gouge" },
      { name: "Commencement", detail: "Legendary: Charge" },
      { name: "Quarantine", detail: "Legendary: The Message" },
    ],
    anchor: { index: 0, at: RESET },
  },
  // Dares of Eternity: the Expert encounter (two rounds and a boss; a six-week loop, owner 1 Oct 2026) and the Legendary loot pool
  // (Pool 1 to Pool 4 and back to Pool 1, Pool 4 the week of 29 Sep; order confirmed by the owner, 1 Oct 2026).
  {
    id: "dares",
    title: "Dares of Eternity",
    kicker: "30th Anniversary",
    section: "anniversary",
    period: "weekly",
    place: "Eternity",
    keywords: ["dares of eternity"],
    art: "Dares of Eternity",
    matchEntries: false,
    confirmed: true,
    detailKind: "text",
    entries: [
      { name: "Boss: Crota (Hive)", detail: "Rounds: Vex, then Cabal" },
      { name: "Boss: Zydron (Vex)", detail: "Rounds: Fallen, then Hive" },
      { name: "Boss: Valus Ta'aurc (Cabal)", detail: "Rounds: Hive, then Vex" },
      { name: "Boss: Crota (Hive)", detail: "Rounds: Cabal, then Taken" },
      { name: "Boss: Zydron (Vex)", detail: "Rounds: Taken, then Cabal" },
      { name: "Boss: Valus Ta'aurc (Cabal)", detail: "Rounds: Hive, then Fallen" },
    ],
    anchor: { index: 0, at: RESET },
  },
  {
    id: "dares-loot",
    title: "Dares Loot Pool",
    kicker: "30th Anniversary",
    section: "anniversary",
    period: "weekly",
    place: "Eternity",
    keywords: [],
    art: "Dares of Eternity",
    matchEntries: false,
    confirmed: true,
    detailKind: "text",
    entries: [
      {
        name: "Pool 1",
        detail: "Wild Hunt and Scatterhorn armor",
        items: ["Enigma's Draw", "Dire Promise", "True Prophecy", "Arsenic Bite-4b", "Royal Chase", "Jian 7 Rifle", "Friction Fire", "Escape Velocity", "Corsair's Wrath", "Deafening Whisper", "Blast Battue"],
      },
      {
        name: "Pool 2",
        detail: "Praefectus and Scatterhorn armor",
        items: ["Far Future", "Extraordinary Rendition", "Brass Attacks", "Threaded Needle", "Code Duello", "Annual Skate", "Imperial Needle", "Shepherd's Watch", "Scathelocke", "Interference VI", "Distant Tumulus", "Honor's Edge"],
      },
      {
        name: "Pool 3",
        detail: "Lightkin and Scatterhorn armor",
        items: ["Chroma Rush", "Sojourner's Tale", "Wishbringer", "Farewell", "The Last Dance", "Gridskipper", "Last Perdition", "Main Ingredient", "Long Shadow", "Toil and Trouble", "Shattered Cipher", "Ignition Code"],
      },
      {
        name: "Pool 4",
        detail: "Pathfinder's and Scatterhorn armor",
        items: ["Fractethyst", "Vulpecula", "Contingency Plan", "Legal Action II", "Spoiler Alert", "Iota Draconis", "Wolftone Draw", "Steel Sybil Z-14", "Canis Major", "Chrysura Melo", "Outrageous Fortune"],
      },
    ],
    anchor: { index: 3, at: RESET },
  },
  // Daily: the Pale Heart's Overthrow area (The Landing on 30 Sep 2026) and Neomuna's Terminal Overload. Terminal
  // Overload's order isn't known (only 30 Sep: Límíng Harbor), but Bungie's list names today's zone ("Terminal
  // Overload: LH"), which lib/live-rotations.js reads.
  {
    id: "overthrow",
    title: "Overthrow",
    kicker: "Final Shape",
    section: "final-shape",
    period: "daily",
    place: "The Pale Heart",
    keywords: ["overthrow"],
    art: ["Overthrow", "The Pale Heart"],
    confirmed: true,
    entries: [{ name: "The Landing" }, { name: "The Impasse" }, { name: "The Blooming" }],
    anchor: { index: 0, at: Date.UTC(2026, 8, 30, 17) },
  },
  {
    id: "terminal-overload",
    title: "Terminal Overload",
    kicker: "Lightfall",
    section: "lightfall",
    period: "daily",
    place: "Neomuna",
    keywords: ["terminal overload"],
    art: ["Terminal Overload", "Neomuna"],
    confirmed: true,
    knownSpan: 1,
    entries: [{ name: "Límíng Harbor", detail: "Synchronic Roulette (Submachine Gun)" }, { name: "Ahimsa Park" }, { name: "Zephyr Concourse" }],
    anchor: { index: 0, at: Date.UTC(2026, 8, 30, 17) },
  },
  // Weekly lockouts with nothing to pick (`reminder`): they reset every week and carry the seal triumphs tied to them.
  // v0.57: the Weekly checklist section is gone; the action figures sit with Lightfall, the rest under Other.
  ...[
    { id: "action-figures", label: "Lightfall", section: "lightfall", art: ["Neomuna"], title: "Neomuna Action Figures", place: "Neomuna", detail: "A new set of puzzles every week", keywords: ["action figure"] },
    { id: "vespers-puzzles", label: "Dungeon", section: "misc", art: ["Vesper's Host"], title: "Vesper's Host Puzzles", place: "Vesper's Host", detail: "Code declassification and puzzles, weekly", keywords: ["declassif"] },
    { id: "campaign", label: "Campaign", section: "misc", art: ["Transmigration", "The Witness"], title: "Campaign Replays", place: "Weekly lockout", detail: "Legendary campaign missions reset weekly", keywords: ["legendary campaign", "campaign mission"] },
  ].map((r) => ({
    id: r.id,
    title: r.title,
    kicker: r.label,
    section: r.section,
    period: "weekly",
    place: r.place,
    keywords: r.keywords,
    art: r.art ?? null,
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
// Admin saves from before v0.52 are ignored (the owner asked to reset them when the rotation doc's schedules went
// in); every save since carries `v: SAVE_VERSION`.
export const SAVE_VERSION = 2;

export function withSaved(def, saved) {
  if (saved && saved.v !== SAVE_VERSION) saved = null;
  // An edited loop keeps each entry's item list (the admin edits names and details only) when the name still matches.
  const items = new Map(def.entries.filter((e) => e.items).map((e) => [e.name, e.items]));
  const entries =
    !def.fixed && Array.isArray(saved?.entries) && saved.entries.length
      ? saved.entries.map((e) => (items.has(e.name) ? { ...e, items: items.get(e.name) } : e))
      : def.entries;
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
      current: { name: rotator.period === "daily" ? "Not set today" : "Not set this week", detail: `Rotates through ${n}: ${rotator.entries.map((e) => e.name.split(",")[0]).join(", ")}` },
      ends: new Date(start + size).toISOString(),
      next: [],
    };
  }
  if (rotator.knownOnce && !rotator.custom && steps !== 0) {
    const last = rotator.entries[rotator.anchor.index];
    return {
      index,
      unknown: true,
      current: { name: rotator.period === "daily" ? "Not set today" : "Not set this week", detail: `Last known: ${last.name}${last.detail ? `, ${last.detail}` : ""}` },
      ends: new Date(start + size).toISOString(),
      next: [],
    };
  }
  // Only some weeks known (`knownSpan`, v0.51): the entries are those weeks in order from the anchor, and nothing is
  // guessed before or after them.
  const span = rotator.knownSpan && !rotator.custom ? rotator.knownSpan : null;
  if (span && (steps < 0 || steps >= span)) {
    const last = rotator.entries[Math.min(rotator.entries.length - 1, rotator.anchor.index + span - 1)];
    return {
      index,
      unknown: true,
      current: { name: rotator.period === "daily" ? "Not set today" : "Not set this week", detail: `Last known: ${last.name}${last.detail ? `, ${last.detail}` : ""}` },
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
      ? Array.from({ length: Math.min(upcoming, n - 1, span ? Math.max(0, span - steps - 1) : Infinity) }, (_, k) => ({
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
  return { entries: def.fixed ? undefined : entries, index: body.index, at: lastReset(def.period), v: SAVE_VERSION };
}

// When entry `index` is next up (now if it's current), as an ISO date.
export function nextStart(rotator, state, index) {
  const size = periodMs(rotator);
  const n = rotator.entries.length;
  const start = new Date(state.ends).getTime() - size;
  return new Date(start + mod(index - state.index, n) * size).toISOString();
}
