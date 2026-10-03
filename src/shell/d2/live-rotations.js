// Applies what Bungie's milestones say is on this week (lib/live-week.js) to the Featured rotators, and picks out
// events (v0.47). Pure: no network, so it can be tested with made-up data.
//
// How a rotator is matched: only milestones or activities whose names mention that rotator (its `scope` below) are
// looked at (plus, for all but the Grandmaster, the admin's available activities), so a strike playlist
// listing every strike can't be mistaken for this week's Grandmaster. When exactly
// one of the rotator's entries is named there, that entry is this week's. The Grandmaster can also be read straight
// from the names when the strike isn't in the built-in list. Bungie's answer wins over the admin's
// setting and the built-in schedule; when Bungie says nothing, those are used as before.
import { RAID_NAMES, DUNGEON_NAMES } from "./rotations.js";
import { lastReset, rotatorNow } from "./rotators.js";

const SCOPES = {
  grandmaster: /nightfall|grandmaster|vanguard alert/,
  "exotic-mission": /exotic/,
  ascendant: /ascendant challenge/,
  wellspring: /wellspring/,
  lucent: /executioner|lucent/,
  altars: /altars? of sorrow/,
  "wandering-nightmares": /wandering nightmare|nightmare of/,
  "empire-hunt": /empire hunt|the warrior|the technocrat|the dark priestess/,
  "exo-challenge": /exo challenge|simulation/,
  "eclipsed-zone": /eclipsed/,
  partition: /partition/,
  "terminal-overload": /terminal overload/,
  "neomuna-mission": /breakneck|no time left|desperate measures|first contact|downfall|on the verge|headlong|under siege/,
};

// Names in events that mean "this is a seasonal event or a special weekend", for milestones Bungie doesn't mark
// as special.
const EVENT_WORDS = /solstice|dawning|festival of the lost|guardian games|iron banner|trials of osiris|crimson days|revelry|arms week|event/;

export const norm = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// The words an entry is recognised by: its name without "Attack:"/"Defend:"/"Operation:"/"Nightmare of", split
// into parts at " and " (a Pantheon pair needs both bosses named).
function entryParts(entry) {
  return norm(entry.name)
    .replace(/^(attack|defend|operation) /, "")
    .replace(/^node ovrd /, "")
    .replace(/^nightmare of /, "")
    .replace(/ executioner$/, "")
    .split(",")[0]
    .split(" and ")
    .map((p) => p.trim())
    .filter((p) => p.length >= 4);
}

// Rotators only read from names that mention them, even in the admin's available activities, because those list
// every strike (a playlist) and would otherwise always "match" the one known Grandmaster strike.
const SCOPE_ONLY = new Set(["grandmaster"]);

// Where names come from: the public milestones, plus the admin's available activities as one extra "milestone"
// (`broad`: its names count for other rotators even without naming them, e.g. an exotic mission is just "Presage").
function sources(live) {
  const list = [...(live?.milestones ?? [])];
  if (live?.available?.activities?.length) {
    list.push({ hash: "available", name: "", description: "", activities: live.available.activities, broad: true });
  }
  return list;
}

// The milestone and activity names that are about one rotator.
function scopedNames(list, scope, broad) {
  const names = [];
  for (const m of list) {
    const own = norm(`${m.name} ${m.description}`);
    const all = m.activities.flatMap((a) => a.names);
    if (m.name && scope.test(own)) names.push(m.name, ...all);
    else if (m.broad && broad) names.push(...all);
    else names.push(...all.filter((n) => scope.test(norm(n))));
  }
  return names.filter(Boolean);
}

// This week's Grandmaster strike from names like "Grandmaster: The Sunless Cell" or "Grandmaster Vanguard Alert:
// Exodus Crash": the name with those words taken out. Excision also has a Grandmaster version and isn't the alert
// (the live site read "Excision: Grandmaster" in v0.47), so it's skipped.
function grandmasterStrike(names) {
  for (const n of names) {
    if (!/grandmaster/i.test(n) || /excision/i.test(n)) continue;
    const strike = n
      .replace(/\b(nightfall|grandmaster|the ordeal|conduit|vanguard alert|alert)\b/gi, "")
      .replace(/^[\s:–-]+|[\s:–-]+$/g, "")
      .replace(/\s*:\s*:\s*/g, ": ")
      .trim();
    if (strike.length >= 4) return strike;
  }
  return null;
}

// The Pantheon isn't read from Bungie (v0.49): its "Featured Reprise: Calus" activity was listed while the game showed
// Gahlran, so those names don't follow the week. It stays on the admin's setting.

// The one entry Bungie lists with harder difficulties (v0.49): all three Empire Hunts are always there as "The
// Warrior: Customize" and so on, but only this week's has "The Dark Priestess: Advanced/Expert/Master". Entries are
// recognised by the part after the comma ("Kridis, the Dark Priestess" → "the dark priestess").
function hardModeEntry(rotator, names) {
  const hard = names.map(norm).filter((n) => /\b(advanced|expert|master)$/.test(n));
  const hits = rotator.entries
    .map((entry, i) => ({ i, key: norm(entry.name.split(",").pop()) }))
    .filter(({ key }) => key.length >= 5 && hard.some((n) => n.startsWith(`${key} `)));
  return hits.length === 1 ? hits[0].i : null;
}

const HARD_MODE = new Set(["empire-hunt", "neomuna-mission"]);

// The mission itself when it isn't one of the known entries: "Headlong: Master" → "Headlong".
function hardModeName(names, scope) {
  for (const n of names) {
    const m = /^(.+?)\s*:\s*(advanced|expert|master)\s*$/i.exec(n.trim());
    if (m && scope.test(norm(m[1]))) return m[1].trim();
  }
  return null;
}

// "Terminal Overload: LH" names the zone by its initials (v0.50): the entry whose name's initials match, accents
// ignored ("Límíng Harbor" → "lh").
const initials = (name) =>
  norm(String(name).normalize("NFD").replace(/[\u0300-\u036f]/g, ""))
    .split(" ")
    .map((w) => w[0])
    .join("");

function initialsEntry(rotator, names) {
  const codes = new Set(names.map((n) => (/terminal overload\s*:\s*([a-z]{2,3})\b/i.exec(n) || [])[1]?.toLowerCase()).filter(Boolean));
  if (codes.size !== 1) return null;
  const [code] = codes;
  const hits = rotator.entries.map((e, i) => ({ i, code: initials(e.name) })).filter((e) => e.code === code);
  return hits.length === 1 ? hits[0].i : null;
}

function fromBungie(rotator, entries, index, now) {
  // Bungie agrees with the schedule: keep the schedule (and its "coming up" list), just mark it confirmed.
  if (entries === rotator.entries) {
    const state = rotatorNow(rotator, now);
    if (!state.unknown && state.index === index) return { ...rotator, confirmed: true, source: "bungie" };
  }
  return {
    ...rotator,
    entries,
    anchor: { index, at: lastReset(rotator.period, now) },
    custom: true,
    confirmed: true,
    // One entry that isn't from the known loop: show it as this week's without guessing what comes next.
    knownOnce: entries === rotator.entries ? rotator.knownOnce : false,
    single: entries !== rotator.entries,
    source: "bungie",
  };
}

// The rotators with Bungie's answer applied where there is one, and the milestone hashes that were used.
export function applyLiveRotators(rotators, live, now = Date.now()) {
  const used = new Set();
  const list = sources(live);
  if (!list.length) return { rotators, used };
  const out = rotators.map((rotator) => {
    const scope = SCOPES[rotator.id];
    if (!scope) return rotator;
    const names = scopedNames(list, scope, !SCOPE_ONLY.has(rotator.id));
    if (!names.length) return rotator;
    for (const m of list) {
      if (m.name && scope.test(norm(`${m.name} ${m.description}`))) used.add(m.hash);
    }
    if (rotator.id === "terminal-overload") {
      const i = initialsEntry(rotator, names);
      if (i != null) return fromBungie(rotator, rotator.entries, i, now);
    }
    if (HARD_MODE.has(rotator.id)) {
      const i = hardModeEntry(rotator, names);
      if (i != null) return fromBungie(rotator, rotator.entries, i, now);
      const name = hardModeName(names, scope);
      return name ? fromBungie(rotator, [{ name }], 0, now) : rotator;
    }
    // The Wellspring's names only say "Attack" or "Defend" (the live list, 30 Sep 2026), not the boss. When the schedule
    // disagrees, move to the nearest entry of Bungie's kind; the boss is still the schedule's guess, so it stays Manual.
    if (rotator.id === "wellspring") {
      const kinds = [...new Set(names.map((n) => (/wellspring\W+(attack|defend)/i.exec(n) || [])[1]?.toLowerCase()).filter(Boolean))];
      if (kinds.length !== 1) return rotator;
      const { index } = rotatorNow(rotator, now);
      const n = rotator.entries.length;
      const isKind = (i) => norm(rotator.entries[((i % n) + n) % n].name).startsWith(kinds[0]);
      if (isKind(index)) return rotator;
      const step = [1, -1, 2, -2].find((d) => isKind(index + d));
      if (step == null) return rotator;
      return { ...rotator, anchor: { index: (((index + step) % n) + n) % n, at: lastReset(rotator.period, now) }, custom: true };
    }
    const text = norm(names.join(" | "));
    const hits = rotator.entries
      .map((entry, i) => ({ i, parts: entryParts(entry) }))
      .filter(({ parts }) => parts.length && parts.every((p) => text.includes(p)));
    if (hits.length === 1) return fromBungie(rotator, rotator.entries, hits[0].i, now);
    if (hits.length > 1) return rotator;
    if (rotator.id === "grandmaster") {
      const strike = grandmasterStrike(names);
      if (strike) return fromBungie(rotator, [{ name: strike }], 0, now);
    }
    return rotator;
  });
  return { rotators: out, used };
}

const RAID_DUNGEON = [...RAID_NAMES, ...DUNGEON_NAMES].map((n) => norm(n).replace(/^the /, ""));

// Events and specials Bungie lists this week that no rotator or raid/dungeon card already covers, as
// { hash, name, description, ends }.
export function liveEvents(live, used = new Set()) {
  if (!live?.milestones?.length) return [];
  return live.milestones
    .filter((m) => m.name && !used.has(m.hash))
    .filter((m) => {
      const text = norm(`${m.name} ${m.description}`);
      if (RAID_DUNGEON.some((r) => r.length >= 5 && text.includes(r))) return false;
      return m.type === 5 || EVENT_WORDS.test(text);
    })
    .map((m) => ({ hash: m.hash, name: m.name, description: m.description, ends: m.end }));
}

// Words that find seal triumphs tied to an event: its name without "the" or a leading "Event:".
export function eventKeyword(name) {
  const key = norm(name).replace(/^(event )?the /, "").replace(/^event /, "");
  return key.length >= 4 ? key : null;
}

// Crucible modes that come and go (v0.48); when one is on the admin's list of available activities, it's this week's.
// Guessed from the game's history of rotating modes; the admin panel's full list shows what Bungie actually calls them.
export const ROTATING_PVP = [
  "Team Scorched", "Scorched", "Mayhem", "Momentum Control", "Doubles", "Showdown", "Supremacy", "Rift", "Countdown",
  "Checkmate", "Breakthrough", "Collision", "Lockdown", "Relic", "Salvage", "Fortress", "Clash: Checkmate", "Iron Banner",
  "Trials of Osiris", "Competitive Division",
];

// The Moon's Nightmare Hunts on offer this week (v0.50): only the featured ones are listed with harder difficulties
// ("Nightmare Hunt: Pride: Master"; Anguish, Insanity and Pride on 1 Oct 2026).
function nightmareHunts(names) {
  const hunts = new Set();
  for (const n of names) {
    const m = /^nightmare hunt\s*:\s*([^:]+?)\s*:\s*(advanced|expert|master)\b/i.exec(n.trim());
    if (m) hunts.add(m[1].trim());
  }
  return [...hunts].sort();
}

// Things read straight from the admin's available activities (v0.48): today's Legend/Master Lost Sectors, this
// week's rotating Crucible modes and (v0.50) Nightmare Hunts. Empty when Bungie's list doesn't name any.
export function liveExtras(live) {
  const names = (live?.available?.activities ?? []).flatMap((a) => a.names);
  const lost = new Map();
  for (const n of names) {
    if (!/lost sector/i.test(n) || !/legend|master|expert/i.test(n)) continue;
    const place = n.replace(/lost sector\s*:?/i, "").replace(/\b(legend|master|expert)\b/gi, "").replace(/[:\s]+$|^[:\s]+/g, "").trim();
    const tier = (n.match(/\b(legend|master|expert)\b/i) || [""])[0];
    if (place) lost.set(place, [...new Set([...(lost.get(place) ?? []), tier])].filter(Boolean));
  }
  const text = norm(names.join(" | "));
  const modes = ROTATING_PVP.filter((m) => text.includes(norm(m)));
  // "Scorched" is part of "Team Scorched"; keep the longer name only.
  const crucible = modes.filter((m) => !modes.some((o) => o !== m && norm(o).includes(norm(m))));
  return {
    lostSectors: [...lost.entries()].map(([place, tiers]) => ({ place, tiers })),
    crucible,
    nightmareHunts: nightmareHunts(names),
  };
}
