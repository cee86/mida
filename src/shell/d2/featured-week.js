// This week's Featured rotators beyond the featured raids and dungeons (v0.59), put together from the saved and
// built-in schedules and Bungie's live weekly list. Pure: used by the Featured page and, as an unchanged copy, by the
// MIDA desktop app's Rotators tab, which gets the same saved schedules, art and live list from /api/mida/rotators.
// Keep it free of server-only imports so the copy keeps working.
import { DISTORTION_ART_NAMES, DUNGEON_NAMES, LOST_SECTORS, RAID_NAMES, dreamingCityWeek, lostSectorsToday } from "./rotations.js";
import { lastReset, rotatorNow, WEEK_MS } from "./rotators.js";
import { applyLiveRotators, eventKeyword, liveEvents, liveExtras } from "./live-rotations.js";

// The Dreaming City card's art comes from its patrol activity.
export const DREAMING_CITY_ART = "The Dreaming City";

// A rotator card's art: the current entry's own activity (a strike, a mission) or one fixed activity.
// Since v0.58 `art` can also be a list of names, tried in order (the activity, then its destination).
export const artCandidates = (r) =>
  [r.art].flat().filter(Boolean).flatMap((a) => (a === "current" ? (r.unknown ? [] : [r.current.name]) : [a]));
// Every name a rotator's card might use, across its whole loop (so the saved art covers every week).
export const artNamesFor = (r) => [r.art].flat().filter(Boolean).flatMap((a) => (a === "current" ? r.entries.map((e) => e.name) : [a]));
// Fixed picture choices for the cards built here (v0.58): the same names every week, so the saved art isn't rebuilt
// each week.
const NIGHTMARE_HUNTS = ["Anguish", "Insanity", "Pride", "Despair", "Rage", "Isolation", "Servitude", "Fear"];
export const EXTRA_ART = {
  crucible: ["Control", "Momentum Control", "Crucible"],
  "nightmare-hunts": [...NIGHTMARE_HUNTS.map((h) => `Nightmare Hunt: ${h}`), "The Moon"],
  "weekend-xur": ["Xûr's Treasure Hoard", "The Tower"],
  "weekend-trials": ["Trials of Osiris"],
};

// `savedRotators`: ROTATORS with the admin's saves applied (loadRotators); `live`: loadLiveWeek's reading, or null.
// Returns the rotators that get cards (with Lost Sectors, the weekly PvP modes and Nightmare Hunts), Bungie's events,
// the Xûr and Trials weekend cards, the Ascendant Challenge rotator, the Dreaming City week, and every activity name
// whose art the cards might use.
export function featuredWeek(savedRotators, live, now = Date.now()) {
  // What Bungie's milestones say is on this week wins over the saved and built-in schedules (v0.47).
  const { rotators: allRotators, used } = applyLiveRotators(savedRotators, live, now);
  // The Ascendant Challenge rotator feeds the Dreaming City card (when set or read from Bungie); the rest get cards.
  const ascendant = allRotators.find((r) => r.id === "ascendant");
  const week = dreamingCityWeek(now, ascendant?.custom ? rotatorNow(ascendant, now).index : null);
  // Xûr and Trials of Osiris run from Friday's reset to Tuesday's (v0.51); before Friday their cards say when they
  // start. A Bungie milestone for either is folded into these cards instead of getting its own.
  const weekStart = lastReset("weekly", now);
  const weekendStart = weekStart + 3 * 24 * 60 * 60 * 1000;
  const weekendOn = now >= weekendStart;
  const liveList = liveEvents(live, used);
  const weekendLive = liveList.filter((e) => /trials of osiris|x[uû]r\b/i.test(e.name));
  const weekend = [
    { id: "xur", title: "Xûr", label: "Vendor", section: "vendors", detail: "Exotic vendor, Friday to Tuesday", keywords: ["xûr"], match: /x[uû]r\b/i },
    { id: "trials", title: "Trials of Osiris", label: "Crucible", section: "crucible", detail: "Friday to Tuesday", keywords: ["trials of osiris"], match: /trials of osiris/i },
  ].map((w) => ({
    id: `weekend-${w.id}`,
    title: w.title,
    kicker: w.label,
    section: w.section,
    period: "event",
    place: "",
    keywords: w.keywords,
    art: EXTRA_ART[`weekend-${w.id}`],
    detailKind: "text",
    entries: [{ name: w.title, detail: w.detail }],
    anchor: { index: 0, at: weekStart },
    custom: true,
    confirmed: true,
    source: weekendLive.some((e) => w.match.test(e.name)) ? "bungie" : null,
    endsAt: new Date(weekStart + WEEK_MS).toISOString(),
    startsAt: weekendOn ? null : new Date(weekendStart).toISOString(),
  }));
  // Events Bungie lists get a card each, like a rotator with a single entry that ends on the event's own date.
  const events = liveList.filter((e) => !weekendLive.includes(e)).map((e) => ({
    id: `event-${e.hash}`,
    title: e.name,
    kicker: "Event",
    section: "events",
    detailKind: "text",
    period: "event",
    place: "",
    keywords: [eventKeyword(e.name)].filter(Boolean),
    art: null,
    entries: [{ name: e.name, detail: e.description.length > 110 ? `${e.description.slice(0, 107).trim()}...` : e.description || undefined }],
    anchor: { index: 0, at: lastReset("weekly", now) },
    custom: true,
    confirmed: true,
    source: "bungie",
    endsAt: e.ends ?? new Date(lastReset("weekly", now) + WEEK_MS).toISOString(),
  }));
  // Read straight from Bungie's list of available activities (v0.48): today's Lost Sectors and this week's rotating
  // Crucible modes, each a card only when Bungie named something.
  const extras = liveExtras(live);
  const auto = [];
  // Today's Lost Sector on every destination (v0.51), from the owner's rotation doc: one card, a row per destination.
  const lost = lostSectorsToday(now);
  auto.push({
    id: "lost-sectors",
    title: "Lost Sectors",
    kicker: "Lost Sector",
    section: "lost-sectors",
    period: "daily",
    place: "",
    keywords: ["lost sector"],
    art: null,
    matchEntries: false,
    confirmed: true,
    detailKind: "text",
    entries: [{ name: `${lost.sectors.length} Lost Sectors today`, detail: "Expert and Master; solo for exotic drops" }],
    lanes: lost.sectors.map((l) => ({ label: l.destination, name: l.name, next: l.next })),
    anchor: { index: 0, at: lastReset("daily", now) },
    custom: true,
  });
  // Trials of Osiris has its own card, so it's left out of the modes list.
  const pvpModes = extras.crucible.filter((m) => m !== "Trials of Osiris");
  if (pvpModes.length) {
    auto.push({
      id: "crucible",
      title: "Weekly PvP Modes",
      kicker: "Crucible",
      section: "crucible",
      detailKind: "text",
      period: "weekly",
      place: "Crucible",
      keywords: pvpModes.map((m) => m.toLowerCase()),
      art: EXTRA_ART.crucible,
      entries: [{ name: pvpModes.join(", ") }],
      anchor: { index: 0, at: lastReset("weekly", now) },
      custom: true,
      confirmed: true,
      source: "bungie",
    });
  }
  if (extras.nightmareHunts.length) {
    auto.push({
      id: "nightmare-hunts",
      title: "Nightmare Hunts",
      kicker: "Shadowkeep",
      section: "shadowkeep",
      detailKind: "text",
      period: "weekly",
      place: "The Moon",
      keywords: ["nightmare hunt", ...extras.nightmareHunts.map((h) => `nightmare of ${h.toLowerCase()}`)],
      // This week's first hunt, then any hunt, then the Moon.
      art: [...extras.nightmareHunts.map((h) => `Nightmare Hunt: ${h}`), ...EXTRA_ART["nightmare-hunts"]],
      entries: [{ name: extras.nightmareHunts.join(", "), detail: "This week's hunts" }],
      anchor: { index: 0, at: lastReset("weekly", now) },
      custom: true,
      confirmed: true,
      source: "bungie",
    });
  }
  const rotators = [...allRotators.filter((r) => r.id !== "ascendant"), ...auto];
  // Every raid, dungeon and rotator entry, not just this week's, so the saved art stays valid across resets.
  const artNames = [
    ...new Set([
      ...RAID_NAMES,
      ...DUNGEON_NAMES,
      DREAMING_CITY_ART,
      ...DISTORTION_ART_NAMES,
      ...savedRotators.filter((r) => r.id !== "ascendant").flatMap(artNamesFor),
      ...Object.values(EXTRA_ART).flat(),
      ...LOST_SECTORS.flatMap((d) => d.loop),
    ]),
  ].filter(Boolean);
  return { rotators, events, weekend, ascendant, week, artNames };
}
