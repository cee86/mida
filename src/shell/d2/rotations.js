// Weekly rotations Bungie's API doesn't report, worked out from a known starting week.
// Destiny's week starts at the Tuesday reset, 17:00 UTC.
//
// Each rotation is counted from one known starting point (an anchor). If the site ever shows the wrong
// week or hour, compare with the game and move that rotation's anchor; everything else follows from it.

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// ---------- Dreaming City ----------

// Reset that began the week of Ouroborea with a weak curse (per guide sites; confirm in game).
const ANCHOR_WEEK = Date.UTC(2026, 8, 22, 17); // 22 September 2026, 17:00 UTC

// The Dreaming City curse grows over three weeks, then resets.
const CURSE = [
  // Labels are capitalized like in-game names (owner's request); matching lowercases them.
  { id: "weak", label: "Weak Curse" },
  { id: "growing", label: "Growing Curse" },
  { id: "strong", label: "Strongest Curse" },
];

// The Ascendant Challenge moves around the Dreaming City on a six-week loop.
const ASCENDANT = [
  { name: "Ouroborea", location: "Aphelion's Rest" },
  { name: "Forfeit Shrine", location: "Gardens of Esila" },
  { name: "Shattered Ruins", location: "Spine of Keres" },
  { name: "Keep of Honed Edges", location: "Harbinger's Seclude" },
  { name: "Agonarch Abyss", location: "Bay of Drowned Wishes" },
  { name: "Cimmerian Garrison", location: "Chamber of Starlight" },
];

const mod = (n, m) => ((n % m) + m) % m;

// This week's Dreaming City state, plus when the week started and ends. `ascendantIndex` is this week's
// Ascendant Challenge when the admin has set it (the "ascendant" rotator), overriding the anchor's count.
export function dreamingCityWeek(now = Date.now(), ascendantIndex = null) {
  const index = Math.floor((now - ANCHOR_WEEK) / WEEK_MS);
  const start = ANCHOR_WEEK + index * WEEK_MS;
  const ascendant = Number.isInteger(ascendantIndex) ? ascendantIndex : index;
  return {
    curse: CURSE[mod(index, CURSE.length)],
    ascendant: ASCENDANT[mod(ascendant, ASCENDANT.length)],
    weekStart: new Date(start).toISOString(),
    weekEnd: new Date(start + WEEK_MS).toISOString(),
  };
}

// Triumphs that can only be progressed in some weeks. Each rule decides, from a triumph's name and
// description (lower case), whether it's tied to the Dreaming City rotation and whether it's doable now.
// Returns null when the triumph isn't rotation-bound, otherwise { available, why }.
export function rotationStatus(text, week) {
  const current = week.ascendant;
  // Challenge names only: the locations are ordinary Dreaming City areas that other triumphs mention too.
  const named = ASCENDANT.find((a) => text.includes(a.name.toLowerCase()));
  if (named) {
    return named === current
      ? { available: true, why: `${current.name} is this week's Ascendant Challenge. It comes back every six weeks.` }
      : { available: false };
  }
  if (text.includes("ascendant challenge")) {
    return { available: true, why: `This week's Ascendant Challenge is ${current.name} (${current.location}).` };
  }
  if (text.includes("corrupted egg")) {
    return {
      available: true,
      why: `Some eggs can only be reached in certain curse weeks or Ascendant Challenges. This week: ${week.curse.label}, ${current.name}.`,
    };
  }
  // A triumph that names a curse strength can only be done in that week.
  const needs = CURSE.find((c) => text.includes(c.label.toLowerCase()));
  if (needs) {
    return needs === week.curse
      ? { available: true, why: `Needs the ${needs.label}, which is this week. It returns every three weeks.` }
      : { available: false };
  }
  // Only phrases about the curse cycle; a bare "curse" would also match Curse of Osiris.
  if (["curse strength", "curse cycle", "curse week", "curse is at"].some((p) => text.includes(p))) {
    return { available: true, why: `This week has the ${week.curse.label}. The curse cycles every three weeks.` };
  }
  return null;
}

// ---------- Featured raids and dungeons ----------
// Monument of Triumph features two raids and two dungeons a week on fixed loops, plus one of each that is
// always featured. From the owner's rotation table: raids loop every 9 weeks with the second raid 5 steps
// ahead of the first; dungeons loop every 10 weeks with the second 4 steps ahead. (The table's second
// dungeon column drifts off this pattern from 22 Sep 2026; the pattern matched the game that week.)

// Reset that began week 0 of both loops: Vow of the Disciple + Last Wish, Sundered Doctrine + Grasp of Avarice.
const FEATURED_ANCHOR = Date.UTC(2026, 7, 11, 17); // 11 August 2026, 17:00 UTC

const RAIDS = [
  "Vow of the Disciple", "King's Fall", "Root of Nightmares", "Crota's End", "Salvation's Edge",
  "Last Wish", "Garden of Salvation", "Deep Stone Crypt", "Vault of Glass",
];
const DUNGEONS = [
  "Sundered Doctrine", "The Shattered Throne", "Pit of Heresy", "Prophecy", "Grasp of Avarice",
  "Duality", "Spire of the Watcher", "Ghosts of the Deep", "Warlord's Ruin", "Vesper's Host",
];
const ALWAYS_RAID = "The Desert Perpetual";
const ALWAYS_DUNGEON = "Equilibrium";

// Every raid and dungeon the site knows, featured or not (used to tell which seals are raid or dungeon seals).
export const RAID_NAMES = [...RAIDS, ALWAYS_RAID];
export const DUNGEON_NAMES = [...DUNGEONS, ALWAYS_DUNGEON];

// Where each one is launched from (from guide sites; Prophecy, Vesper's Host and Equilibrium less certain).
const DESTINATIONS = {
  "Vow of the Disciple": "Savathûn's Throne World",
  "King's Fall": "Dreadnaught",
  "Root of Nightmares": "Neptune",
  "Crota's End": "Moon",
  "Salvation's Edge": "The Pale Heart",
  "Last Wish": "Dreaming City",
  "Garden of Salvation": "Black Garden, from the Moon",
  "Deep Stone Crypt": "Europa",
  "Vault of Glass": "Venus",
  "The Desert Perpetual": "Kepler",
  "Sundered Doctrine": "Savathûn's Throne World",
  "The Shattered Throne": "Dreaming City",
  "Pit of Heresy": "Moon",
  "Prophecy": "The Reef",
  "Grasp of Avarice": "Cosmodrome",
  "Duality": "Moon",
  "Spire of the Watcher": "Mars",
  "Ghosts of the Deep": "Titan",
  "Warlord's Ruin": "EDZ",
  "Vesper's Host": "Europa",
  "Equilibrium": "Venus",
};

function featuredForWeek(index) {
  return {
    raids: [RAIDS[mod(index, RAIDS.length)], RAIDS[mod(index + 5, RAIDS.length)]],
    dungeons: [DUNGEONS[mod(index, DUNGEONS.length)], DUNGEONS[mod(index + 4, DUNGEONS.length)]],
  };
}

// This week's featured raids and dungeons, next week's, and the ones featured all the time.
// Each activity: { name, kind, always, destination, ends } (ends = next reset; null when always featured).
export function featuredRotation(now = Date.now()) {
  const index = Math.floor((now - FEATURED_ANCHOR) / WEEK_MS);
  const current = featuredForWeek(index);
  const next = featuredForWeek(index + 1);
  const ends = new Date(FEATURED_ANCHOR + (index + 1) * WEEK_MS).toISOString();
  const entry = (name, kind, always) => ({ name, kind, always, destination: DESTINATIONS[name] ?? null, ends: always ? null : ends });
  const activities = [
    ...current.raids.map((name) => entry(name, "raid", false)),
    entry(ALWAYS_RAID, "raid", true),
    ...current.dungeons.map((name) => entry(name, "dungeon", false)),
    entry(ALWAYS_DUNGEON, "dungeon", true),
  ];
  return { activities, next };
}

// ---------- Distortions ----------
// One destination is distorted at a time, boosting its drops. It moves every hour, on the hour, through a
// fixed loop of seven. Anchored to Nessus at 01:00 UTC on 29 Sep 2026 (from the owner's screenshot and
// time zone; confirm in game).

const HOUR_MS = 60 * 60 * 1000;
const DISTORTION_ANCHOR = Date.UTC(2026, 8, 29, 1);
// `place` is the destination's own activity name in Bungie's data, whose art stands in when the
// distortion activity itself has none.
const DISTORTIONS = [
  { destination: "Nessus", activity: "Exodus Down", place: "Nessus" },
  { destination: "Cosmodrome", activity: "Seventh Seraph", place: "Cosmodrome" },
  { destination: "EDZ", activity: "Wildwood", place: "European Dead Zone" },
  { destination: "Dreaming City", activity: "Reverie Dawn", place: "The Dreaming City" },
  { destination: "Savathûn's Throne World", activity: "Veritas", place: "Savathûn's Throne World" },
  { destination: "Moon", activity: "Dreambane", place: "The Moon" },
  { destination: "Europa", activity: "Crystocrene", place: "Europa" },
];

export const DISTORTION_ACTIVITIES = DISTORTIONS.map((d) => d.activity);
// Every name whose art the Distortion card might use: the activities, then their destinations.
export const DISTORTION_ART_NAMES = [...DISTORTION_ACTIVITIES, ...DISTORTIONS.map((d) => d.place)];

// The art for each distortion activity: its own, else its destination's.
export function distortionImages(art) {
  return Object.fromEntries(DISTORTIONS.map((d) => [d.activity, art[d.activity] ?? art[d.place] ?? null]));
}

// The next `count` distortions starting with the current one, each with its start and end time.
export function distortionSchedule(now = Date.now(), count = DISTORTIONS.length) {
  const index = Math.floor((now - DISTORTION_ANCHOR) / HOUR_MS);
  return Array.from({ length: count }, (_, i) => {
    const start = DISTORTION_ANCHOR + (index + i) * HOUR_MS;
    return {
      ...DISTORTIONS[mod(index + i, DISTORTIONS.length)],
      start: new Date(start).toISOString(),
      end: new Date(start + HOUR_MS).toISOString(),
    };
  });
}
