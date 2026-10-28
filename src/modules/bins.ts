// Bin day: reads the council's calendar feed (ICS), sends a reminder the night
// before, and tells the dashboard what to show. The feed is always trusted, so
// bank-holiday date changes are picked up automatically.

import type { Env } from "../env";
import { getJSON, putJSON } from "../store";
import { notifyOnce } from "../notify";
import * as alexa from "../alexa";
import { addDays, dayLabel, type LondonTime } from "../time";

export interface Collection {
  date: string; // YYYY-MM-DD
  bins: string[]; // e.g. ["Green", "Food"]
}

const KEY = "bins:collections";

/** Undo ICS line folding (continuation lines start with a space or tab). */
function unfold(text: string): string[] {
  return text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "").split("\n");
}

function unescape(s: string): string {
  return s.replace(/\\n/gi, " ").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\").trim();
}

/** Turn an event summary like "Green & Food bin collection" into ["Green", "Food"]. */
export function binsFromSummary(summary: string): string[] {
  const cleaned = summary
    .replace(/\b(bins?|collections?|waste|day|wheelie|recycling collection)\b/gi, (m) =>
      /recycling/i.test(m) ? "Recycling" : "",
    )
    .replace(/\s+/g, " ")
    .trim();
  const parts = cleaned
    .split(/\s*(?:,|&|\+|\/|\band\b)\s*/i)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1));
  return parts.length ? parts : [summary.trim()];
}

/** Parse an ICS feed into collections, merging events that fall on the same day. */
export function parseICS(text: string): Collection[] {
  const byDate = new Map<string, Set<string>>();
  let inEvent = false;
  let date: string | null = null;
  let summary = "";
  for (const line of unfold(text)) {
    if (line.startsWith("BEGIN:VEVENT")) {
      inEvent = true;
      date = null;
      summary = "";
    } else if (line.startsWith("END:VEVENT")) {
      if (inEvent && date) {
        const set = byDate.get(date) ?? new Set<string>();
        for (const b of binsFromSummary(summary || "Bins")) set.add(b);
        byDate.set(date, set);
      }
      inEvent = false;
    } else if (inEvent && line.startsWith("DTSTART")) {
      const value = line.slice(line.indexOf(":") + 1).trim();
      const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/);
      if (m) {
        if (m[4] && m[7]) {
          // A UTC time: convert to the UK date it falls on.
          const utc = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
          date = utc.toLocaleDateString("en-CA", { timeZone: "Europe/London" });
        } else {
          date = `${m[1]}-${m[2]}-${m[3]}`;
        }
      }
    } else if (inEvent && line.startsWith("SUMMARY")) {
      summary = unescape(line.slice(line.indexOf(":") + 1));
    }
  }
  return [...byDate.entries()]
    .map(([d, set]) => ({ date: d, bins: [...set] }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function refresh(env: Env): Promise<void> {
  if (!env.BIN_ICS_URL) return;
  const res = await fetch(env.BIN_ICS_URL, { headers: { "User-Agent": "home-hub (personal use)" } });
  if (!res.ok) throw new Error(`Bin feed failed: ${res.status}`);
  const all = parseICS(await res.text());
  // Keep a rolling window so storage stays small.
  const today = new Date().toISOString().slice(0, 10);
  const keep = all.filter((c) => c.date >= addDays(today, -2) && c.date <= addDays(today, 120));
  await putJSON(env, KEY, keep);
}

export function nextCollection(cols: Collection[], today: string): Collection | null {
  return cols.find((c) => c.date >= today) ?? null;
}

export function binText(c: Collection): string {
  return c.bins.join(" + ");
}

export interface BinsView {
  showTile: boolean; // big tile: from 4pm the day before until 9am on the day
  headline?: string; // "Bins tomorrow" / "Bins today"
  bins?: string[];
  nextLine?: string; // small line: "Next collection: Tue 27 Oct, Black"
}

export function view(cols: Collection[], t: LondonTime): BinsView {
  const next = nextCollection(cols, t.date);
  if (!next) return { showTile: false };
  const tomorrow = addDays(t.date, 1);
  if (next.date === tomorrow && t.hour >= 16) {
    return { showTile: true, headline: "Bins out tonight", bins: next.bins };
  }
  if (next.date === t.date && t.hour < 9) {
    return { showTile: true, headline: "Bins today", bins: next.bins };
  }
  // After 9am on the day, look past today's collection.
  const upcoming = next.date === t.date ? nextCollection(cols, tomorrow) : next;
  if (!upcoming) return { showTile: false };
  return { showTile: false, nextLine: `Next bins: ${dayLabel(upcoming.date)}, ${binText(upcoming)}` };
}

export async function getView(env: Env, t: LondonTime): Promise<BinsView> {
  return view((await getJSON<Collection[]>(env, KEY)) ?? [], t);
}

/** Runs every 10 minutes. Refreshes the feed once a night, reminds at 7pm. */
export async function tick(env: Env, t: LondonTime): Promise<void> {
  const cached = await getJSON<Collection[]>(env, KEY);
  if (!cached || (t.hour === 3 && t.minute < 10)) await refresh(env);

  if (t.hour === 19) {
    const cols = (await getJSON<Collection[]>(env, KEY)) ?? [];
    const tomorrow = addDays(t.date, 1);
    const c = cols.find((x) => x.date === tomorrow);
    if (c) {
      const sent = await notifyOnce(env, `bins:${c.date}`, {
        title: `Bins tomorrow: ${binText(c)}`,
        message: `Put the ${binText(c).toLowerCase()} out tonight.`,
        tags: ["wastebasket"],
      });
      if (sent) {
        await alexa.say(env, t, `Bins tomorrow: ${c.bins.join(" and ").toLowerCase()}. Put them out tonight.`);
        await alexa.trigger(env, t, env.ALEXA_TRIGGER_BINS); // e.g. the hallway lamp turns green
      }
    }
  }
}
