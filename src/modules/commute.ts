// Commute check via the TomTom Routing API (live traffic). Only alerts when the
// drive is meaningfully slower than usual, and only once per morning/evening.
//
// TomTom's response includes the live journey time and a "historic" (typical)
// time for this time of day, which is used as the normal baseline.
// Docs: https://developer.tomtom.com/routing-api/documentation

import { parseLatLon, type Env } from "../env";
import { getJSON, putJSON } from "../store";
import { notifyOnce } from "../notify";
import * as alexa from "../alexa";
import { inWindow, type LondonTime } from "../time";

export interface RouteTime {
  minutes: number; // live journey time
  typicalMinutes: number | null; // usual time for this hour
  delayMinutes: number; // live minus typical (or TomTom's traffic delay)
  lengthKm: number;
}

export interface CommuteState {
  direction: "to work" | "home";
  checkedAt: string; // ISO time
  main: RouteTime;
  alt: RouteTime | null; // quickest alternative route, if TomTom found one
  status: "green" | "amber" | "red";
}

const KEY = "commute:latest";

/** Pull journey times out of a TomTom calculateRoute response. */
export function parseTomTom(json: any): { main: RouteTime; alt: RouteTime | null } {
  const routes: any[] = json?.routes ?? [];
  if (!routes.length) throw new Error("TomTom returned no routes");
  const toRT = (r: any): RouteTime => {
    const s = r.summary ?? {};
    const minutes = Math.round((s.travelTimeInSeconds ?? 0) / 60);
    const typical = s.historicTrafficTravelTimeInSeconds;
    const typicalMinutes = typeof typical === "number" ? Math.round(typical / 60) : null;
    const delayMinutes =
      typicalMinutes !== null ? minutes - typicalMinutes : Math.round((s.trafficDelayInSeconds ?? 0) / 60);
    return { minutes, typicalMinutes, delayMinutes, lengthKm: Math.round((s.lengthInMeters ?? 0) / 100) / 10 };
  };
  const all = routes.map(toRT);
  const main = all[0];
  const alts = all.slice(1).sort((a, b) => a.minutes - b.minutes);
  return { main, alt: alts[0] ?? null };
}

export function statusFor(delayMinutes: number, alertMinutes: number): "green" | "amber" | "red" {
  if (delayMinutes >= alertMinutes) return "red";
  if (delayMinutes >= Math.max(4, Math.round(alertMinutes / 2))) return "amber";
  return "green";
}

async function fetchRoute(env: Env, from: string, to: string) {
  const a = parseLatLon(from)!;
  const b = parseLatLon(to)!;
  const url =
    `https://api.tomtom.com/routing/1/calculateRoute/${a.lat},${a.lon}:${b.lat},${b.lon}/json` +
    `?key=${encodeURIComponent(env.TOMTOM_KEY!)}&traffic=true&computeTravelTimeFor=all` +
    `&maxAlternatives=2&routeType=fastest&travelMode=car`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TomTom failed: ${res.status}`);
  return parseTomTom(await res.json());
}

function windowFor(t: LondonTime): "to work" | "home" | null {
  const weekday = t.weekday >= 1 && t.weekday <= 5;
  if (!weekday) return null;
  if (inWindow(t, "06:30", "08:30")) return "to work";
  if (inWindow(t, "16:30", "18:30")) return "home";
  return null;
}

export async function tick(env: Env, t: LondonTime): Promise<void> {
  if (!env.TOMTOM_KEY || !env.HOME_LATLON || !env.WORK_LATLON) return;
  const direction = windowFor(t);
  if (!direction) return;

  const alertMinutes = Number(env.COMMUTE_ALERT_MINUTES || 10);
  const [from, to] = direction === "to work" ? [env.HOME_LATLON, env.WORK_LATLON] : [env.WORK_LATLON, env.HOME_LATLON];
  const { main, alt } = await fetchRoute(env, from, to);
  const state: CommuteState = {
    direction,
    checkedAt: new Date().toISOString(),
    main,
    alt,
    status: statusFor(main.delayMinutes, alertMinutes),
  };
  await putJSON(env, KEY, state, 6 * 3600);

  if (main.delayMinutes >= alertMinutes) {
    const altLine =
      alt && alt.minutes < main.minutes ? `\nAlternative route: ${alt.minutes} min (${alt.lengthKm} km).` : "";
    const sent = await notifyOnce(
      env,
      `commute:${t.date}:${direction}`,
      {
        title: `Traffic: ${main.minutes} min ${direction}`,
        message: `About ${main.delayMinutes} min slower than usual${
          main.typicalMinutes ? ` (normally ${main.typicalMinutes} min)` : ""
        }.${altLine}`,
        tags: ["car", "warning"],
        priority: 4,
      },
      1,
    );
    // Spoken in the morning only: in the evening nobody is home to hear it.
    if (sent && direction === "to work") {
      const altSpeech = alt && alt.minutes < main.minutes ? ` The other route is ${alt.minutes}.` : "";
      await alexa.say(
        env,
        t,
        `Heads up: ${main.minutes} minutes to work today, ${main.delayMinutes} slower than usual.${altSpeech}`,
      );
    }
  }
}

export async function getView(env: Env): Promise<CommuteState | null> {
  return getJSON<CommuteState>(env, KEY);
}
