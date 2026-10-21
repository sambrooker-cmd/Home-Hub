// F1 race weekends from the Jolpica-F1 API (the Ergast successor).
// Free, no key, 500 requests/hour, so the calendar is cached for a day and
// results are only checked in the hours after a race.
// Docs: https://github.com/jolpica/jolpica-f1

import type { Env } from "../env";
import { getJSON, putJSON } from "../store";
import { notifyOnce } from "../notify";
import { ukDayTime, type LondonTime } from "../time";

const BASE = "https://api.jolpi.ca/ergast/f1";
const CAL_KEY = "f1:calendar";
const LAST_KEY = "f1:last";

export interface Session {
  name: string; // "Practice 1", "Sprint Qualifying", "Qualifying", "Sprint", "Race"
  start: string; // ISO UTC
}

export interface RaceWeekend {
  round: number;
  name: string; // "Mexico City Grand Prix"
  circuit: string;
  locality: string;
  sessions: Session[];
}

export interface LastRace {
  round: number;
  name: string;
  top10: { pos: number; code: string; name: string; team: string }[];
  leader?: { name: string; points: number; gap: number | null }; // championship
}

const SESSION_FIELDS: [string, string][] = [
  ["FirstPractice", "Practice 1"],
  ["SecondPractice", "Practice 2"],
  ["ThirdPractice", "Practice 3"],
  ["SprintQualifying", "Sprint Qualifying"],
  ["SprintShootout", "Sprint Qualifying"],
  ["Sprint", "Sprint"],
  ["Qualifying", "Qualifying"],
];

function iso(date?: string, time?: string): string | null {
  if (!date) return null;
  return `${date}T${(time || "00:00:00Z").replace(/Z?$/, "Z")}`;
}

/** Convert a Jolpica season schedule into race weekends with UTC session times. */
export function parseSchedule(json: any): RaceWeekend[] {
  const races: any[] = json?.MRData?.RaceTable?.Races ?? [];
  return races.map((r) => {
    const sessions: Session[] = [];
    for (const [field, label] of SESSION_FIELDS) {
      const s = r[field];
      const start = s && iso(s.date, s.time);
      if (start) sessions.push({ name: label, start });
    }
    const raceStart = iso(r.date, r.time);
    if (raceStart) sessions.push({ name: "Race", start: raceStart });
    sessions.sort((a, b) => a.start.localeCompare(b.start));
    return {
      round: Number(r.round),
      name: r.raceName,
      circuit: r.Circuit?.circuitName ?? "",
      locality: r.Circuit?.Location?.locality ?? "",
      sessions,
    };
  });
}

export function parseResults(resultsJson: any, standingsJson: any): LastRace | null {
  const race = resultsJson?.MRData?.RaceTable?.Races?.[0];
  if (!race) return null;
  const top10 = (race.Results ?? []).slice(0, 10).map((r: any) => ({
    pos: Number(r.position),
    code: r.Driver?.code ?? r.Driver?.familyName?.slice(0, 3).toUpperCase(),
    name: `${r.Driver?.givenName ?? ""} ${r.Driver?.familyName ?? ""}`.trim(),
    team: r.Constructor?.name ?? "",
  }));
  const st = standingsJson?.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings ?? [];
  let leader: LastRace["leader"];
  if (st.length) {
    const p1 = Number(st[0].points);
    const p2 = st[1] ? Number(st[1].points) : null;
    leader = {
      name: `${st[0].Driver?.givenName} ${st[0].Driver?.familyName}`,
      points: p1,
      gap: p2 === null ? null : p1 - p2,
    };
  }
  return { round: Number(race.round), name: race.raceName, top10, leader };
}

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { "User-Agent": "home-hub (personal use)" } });
  if (!res.ok) throw new Error(`Jolpica ${res.status} for ${url}`);
  return res.json();
}

export async function refreshCalendar(env: Env): Promise<void> {
  await putJSON(env, CAL_KEY, parseSchedule(await getJson(`${BASE}/current.json?limit=100`)));
}

export async function refreshResults(env: Env): Promise<LastRace | null> {
  const [res, st] = await Promise.all([
    getJson(`${BASE}/current/last/results.json`),
    getJson(`${BASE}/current/driverStandings.json`),
  ]);
  const last = parseResults(res, st);
  if (last) await putJSON(env, LAST_KEY, last);
  return last;
}

export function nextSession(cal: RaceWeekend[], now: Date): { race: RaceWeekend; session: Session } | null {
  for (const race of cal) {
    for (const session of race.sessions) {
      // Treat a session as "current" for 2 hours after it starts.
      if (new Date(session.start).getTime() + 2 * 3600e3 > now.getTime()) return { race, session };
    }
  }
  return null;
}

function raceStart(r: RaceWeekend): Date | null {
  const s = r.sessions.find((x) => x.name === "Race");
  return s ? new Date(s.start) : null;
}

export async function tick(env: Env, t: LondonTime, now: Date): Promise<void> {
  let cal = await getJSON<RaceWeekend[]>(env, CAL_KEY);
  if (!cal || (t.hour === 4 && t.minute < 10)) {
    await refreshCalendar(env);
    cal = (await getJSON<RaceWeekend[]>(env, CAL_KEY)) ?? [];
  }
  // First run: fill in the last race podium for the dashboard.
  if (!(await env.HUB.get(LAST_KEY))) await refreshResults(env);

  for (const race of cal) {
    const rs = raceStart(race);
    if (!rs) continue;
    const firstDay = race.sessions[0]?.start;
    if (!firstDay) continue;
    const firstUk = new Date(firstDay).toLocaleDateString("en-CA", { timeZone: "Europe/London" });

    // 1. Weekend schedule on the morning the weekend starts (normally Friday) at 9am.
    if (t.date === firstUk && t.hour === 9) {
      const lines = race.sessions.map((s) => `${s.name}: ${ukDayTime(new Date(s.start))}`).join("\n");
      await notifyOnce(env, `f1:schedule:${race.round}`, {
        title: `F1 this weekend: ${race.name}`,
        message: `${lines}\n(UK times)`,
        tags: ["checkered_flag"],
      });
    }

    // 2. 30 minutes before qualifying (incl. sprint qualifying), sprint and race.
    for (const s of race.sessions) {
      if (!/Qualifying|Sprint|Race/.test(s.name)) continue;
      const mins = (new Date(s.start).getTime() - now.getTime()) / 60000;
      if (mins > 0 && mins <= 35) {
        await notifyOnce(env, `f1:soon:${race.round}:${s.name}`, {
          title: `${s.name} in ${Math.round(mins)} min`,
          message: `${race.name}, starts ${ukDayTime(new Date(s.start))} UK time.`,
          tags: ["racing_car"],
        });
      }
    }

    // 3. Results: check every 30 min from 2h to 8h after the race start.
    const hoursSince = (now.getTime() - rs.getTime()) / 3600e3;
    const halfHourSlot = t.minute < 10 || (t.minute >= 30 && t.minute < 40);
    if (hoursSince >= 2 && hoursSince <= 8 && halfHourSlot) {
      const sentKey = `sent:f1:result:${race.round}`;
      if (await env.HUB.get(sentKey)) continue;
      const last = await refreshResults(env);
      if (last && last.round === race.round && last.top10.length) {
        const podium = last.top10.slice(0, 10).map((r) => `${r.pos}. ${r.name}`).join("\n");
        const champ = last.leader
          ? `\n\nChampionship: ${last.leader.name} leads${last.leader.gap !== null ? ` by ${last.leader.gap} pts` : ""}.`
          : "";
        await notifyOnce(env, `f1:result:${race.round}`, {
          title: `${race.name}: ${last.top10[0].name} wins`,
          message: podium + champ,
          tags: ["trophy"],
        }, 14);
      }
    }
  }
}

export interface F1View {
  next?: { race: string; session: string; start: string; label: string };
  last?: LastRace;
}

export async function getView(env: Env, now: Date): Promise<F1View> {
  const cal = (await getJSON<RaceWeekend[]>(env, CAL_KEY)) ?? [];
  const n = nextSession(cal, now);
  const last = (await getJSON<LastRace>(env, LAST_KEY)) ?? undefined;
  return {
    next: n
      ? { race: n.race.name, session: n.session.name, start: n.session.start, label: ukDayTime(new Date(n.session.start)) }
      : undefined,
    last,
  };
}
