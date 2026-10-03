// Reminders in MIDA's own notifications (the bell in the sidebar; never Windows pop-ups): the weekly and daily resets,
// Xûr and Trials arriving, events Bungie lists, and a postmaster that's filling up. Each fires once (its key is
// remembered by the notifications list). Which ones are on is a per-PC choice in Settings → Tabs (`mida-reminders`).
// shell.js calls remind() once a minute on Destiny 2 profiles; tabs.js calls postmasterCheck() after each inventory read.

import { featuredRotation, lostSectorsToday } from "./d2/rotations.js";
import { lastReset, DAY_MS, WEEK_MS } from "./d2/rotators.js";

const KEY = "mida-reminders";
export const REMINDERS = [
  ["weekly", "Weekly reset", "Tuesdays at 17:00 UTC: this week's raids, dungeons and featured activities.", true],
  ["daily", "Daily reset", "Every day at 17:00 UTC: today's Lost Sectors.", false],
  ["events", "Xûr, Trials and events", "When Xûr and Trials arrive on Fridays, and when Bungie lists an event.", true],
  ["news", "Bungie Server Status", "New posts from Bungie Server Status on Bluesky: maintenance, downtime and fixes (checked every 15 minutes).", true],
  ["postmaster", "Postmaster filling up", "When a character has 18 or more items waiting (Bungie removes the oldest past 21).", true],
];

export function reminderChoices() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY)) ?? {};
  } catch {
    // Defaults.
  }
  return Object.fromEntries(REMINDERS.map(([id, , , on]) => [id, typeof saved[id] === "boolean" ? saved[id] : on]));
}
export function setReminder(id, on) {
  const next = { ...reminderChoices(), [id]: Boolean(on) };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Only a convenience.
  }
}

const day = (iso) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

// `remote`: seals.report's answer for the Rotators tab (its `week.events`), when there is one.
export function remind(ctx, remote = null) {
  const notify = ctx.notify;
  if (!notify) return;
  const on = reminderChoices();
  const now = Date.now();
  const week = lastReset("weekly", now);
  const today = lastReset("daily", now);
  // Only within a day of the reset, so opening MIDA days later doesn't announce an old one.
  if (on.weekly && now - week < DAY_MS) {
    const r = featuredRotation(now);
    const raids = r.activities.filter((a) => a.kind === "raid" && !a.always).map((a) => a.name);
    const dungeons = r.activities.filter((a) => a.kind !== "raid" && !a.always).map((a) => a.name);
    notify({
      key: `reset-week-${week}`,
      kind: "reminder",
      title: "Weekly reset",
      detail: `Featured raids: ${raids.join(" and ")}. Dungeons: ${dungeons.join(" and ")}. Rotators has the rest of the week.`,
    });
  }
  if (on.daily && now - today < 6 * 3600e3) {
    const lost = lostSectorsToday(now).sectors.slice(0, 4).map((s) => `${s.name} (${s.destination})`);
    notify({ key: `reset-day-${today}`, kind: "reminder", title: "Daily reset", detail: lost.length ? `Today's Lost Sectors include ${lost.join(", ")}.` : "Today's rotations changed." });
  }
  if (on.events) {
    // Xûr and Trials: Friday's reset to Tuesday's.
    const friday = week + 3 * DAY_MS;
    if (now >= friday && now - friday < DAY_MS) {
      notify({ key: `xur-${week}`, kind: "reminder", title: "Xûr is here", detail: `Until the reset on ${day(new Date(week + WEEK_MS).toISOString())}.` });
      notify({ key: `trials-${week}`, kind: "reminder", title: "Trials of Osiris is live", detail: `Until the reset on ${day(new Date(week + WEEK_MS).toISOString())}.` });
    }
    for (const e of remote?.week?.events ?? []) {
      const name = e.title || e.entries?.[0]?.name;
      if (!name) continue;
      notify({ key: `event-${e.id}`, kind: "reminder", title: `Event: ${name}`, detail: e.endsAt ? `On until ${day(e.endsAt)}.` : "On now." });
    }
  }
}

// After each inventory read: a warning per character when 18 or more items wait at the postmaster (again at 20).
export function postmasterCheck(ctx, data) {
  if (!ctx.notify || !reminderChoices().postmaster || !data?.characters) return;
  const today = new Date().toDateString();
  for (const c of data.characters) {
    const n = (data.postmaster ?? []).filter((i) => i.owner === c.id).length;
    if (n < 18) continue;
    const level = n >= 20 ? 20 : 18;
    ctx.notify({
      key: `postmaster-${c.id}-${level}-${today}`,
      kind: n >= 20 ? "error" : "reminder",
      title: `${c.className}'s postmaster is ${n >= 20 ? "almost full" : "filling up"}`,
      detail: `${n} of 21 items waiting. Bungie removes the oldest once it's past 21. Pull them from the Inventory's Postmaster button.`,
    });
  }
}
