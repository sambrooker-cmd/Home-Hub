// Weather from Open-Meteo (free, no key). Refreshed every 30 minutes.
// Docs: https://open-meteo.com/en/docs

import { parseLatLon, type Env } from "../env";
import { getJSON, putJSON } from "../store";
import type { LondonTime } from "../time";

const KEY = "weather:latest";

export interface Weather {
  updatedAt: string;
  now: { temp: number; code: number; text: string; wind: number };
  today: { max: number; min: number; rainChance: number; code: number; text: string };
  tomorrow: { max: number; min: number; rainChance: number; code: number; text: string };
}

// WMO weather codes, shortened for a wall display.
export function codeText(code: number): string {
  if (code === 0) return "Clear";
  if (code <= 2) return "Partly cloudy";
  if (code === 3) return "Cloudy";
  if (code === 45 || code === 48) return "Fog";
  if (code >= 51 && code <= 57) return "Drizzle";
  if (code >= 61 && code <= 67) return "Rain";
  if (code >= 71 && code <= 77) return "Snow";
  if (code >= 80 && code <= 82) return "Showers";
  if (code === 85 || code === 86) return "Snow showers";
  if (code >= 95) return "Thunderstorms";
  return "—";
}

export function parseOpenMeteo(j: any): Weather {
  const day = (i: number) => ({
    max: Math.round(j.daily.temperature_2m_max[i]),
    min: Math.round(j.daily.temperature_2m_min[i]),
    rainChance: j.daily.precipitation_probability_max?.[i] ?? 0,
    code: j.daily.weather_code[i],
    text: codeText(j.daily.weather_code[i]),
  });
  return {
    updatedAt: new Date().toISOString(),
    now: {
      temp: Math.round(j.current.temperature_2m),
      code: j.current.weather_code,
      text: codeText(j.current.weather_code),
      wind: Math.round(j.current.wind_speed_10m),
    },
    today: day(0),
    tomorrow: day(1),
  };
}

export async function refresh(env: Env): Promise<void> {
  const home = parseLatLon(env.HOME_LATLON);
  if (!home) return;
  const p = new URLSearchParams({
    latitude: String(home.lat),
    longitude: String(home.lon),
    current: "temperature_2m,weather_code,wind_speed_10m",
    daily: "temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code",
    timezone: "Europe/London",
    wind_speed_unit: "mph",
    forecast_days: "2",
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${p}`);
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  await putJSON(env, KEY, parseOpenMeteo(await res.json()));
}

export async function tick(env: Env, t: LondonTime): Promise<void> {
  const slot = t.minute < 10 || (t.minute >= 30 && t.minute < 40);
  if (slot || !(await env.HUB.get(KEY))) await refresh(env);
}

export async function getView(env: Env): Promise<Weather | null> {
  return getJSON<Weather>(env, KEY);
}
