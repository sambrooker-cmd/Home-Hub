// Energy usage from the smart meter, through Hildebrand's free Glowmarkt service
// (the API behind the Bright app). It reads any DCC-connected smart meter once
// you've connected it in the Bright app. Data normally lands the day after, so
// this runs once a day after 10:00 UK and back-fills late days.
// The API isn't formally documented; this follows the community clients:
//   https://docs.rs/glowmarkt  and  https://pypi.org/project/pyglowmarkt/

import type { Env } from "../env";
import { getJSON, putJSON } from "../store";
import { notifyOnce } from "../notify";
import { addDays, dayLabel, london, ukMidnight, type LondonTime } from "../time";

const BASE = "https://api.glowmarkt.com/api/v0-1";
const DEFAULT_APP_ID = "b0f1b774-a586-4f72-9edd-27ead8aa7a8d"; // the Bright app's application id
const DATA_KEY = "energy:data";
const HALF_KEY = "energy:halfhours";
const TOKEN_KEY = "energy:glow-token";

// Tunable alert settings.
export const SETTINGS = {
  alwaysOnRise: 1.3, // always-on usage 30% over the usual...
  alwaysOnNights: 2, // ...for 2 nights running
  baselineNights: 28,
  minBaselineNights: 7,
  costRise: 1.5, // a day 50% dearer than the same weekday's 4-week average...
  minExtraPence: 50, // ...and at least 50p more (so tiny summer gas days don't alert)
  staleDays: 3, // no new readings for 3 days
  keepDays: 400,
  keepHalfHourDays: 14,
};

export interface Day {
  e: number; // electricity kWh
  g: number | null; // gas kWh (null: no gas meter)
  ec: number | null; // electricity cost, pence (incl. standing charge)
  gc: number | null; // gas cost, pence
  src: "meter" | "tariff" | "none"; // where the cost came from
  base?: number; // always-on watts: lowest hour between 01:00 and 05:00
}

interface Resources {
  elec?: string;
  elecCost?: string;
  gas?: string;
  gasCost?: string;
}

interface Data {
  lastRun?: string;
  resources?: Resources;
  days: Record<string, Day>;
  alert?: { date: string; text: string };
}

type HalfHours = Record<string, number[]>; // date -> 48 electricity kWh values

// ------------------------------------------------------------------ API

async function login(env: Env, now: number): Promise<string> {
  const res = await fetch(`${BASE}/auth`, {
    method: "POST",
    headers: { applicationId: env.GLOW_APP_ID || DEFAULT_APP_ID, "Content-Type": "application/json" },
    body: JSON.stringify({ username: env.GLOW_USERNAME, password: env.GLOW_PASSWORD }),
  });
  if (!res.ok) throw new Error(`Glowmarkt login failed: ${res.status}`);
  const j: any = await res.json();
  if (j.valid === false || !j.token) throw new Error("Glowmarkt login refused: check GLOW_USERNAME and GLOW_PASSWORD");
  const expiresAt = Number(j.exp) ? Number(j.exp) * 1000 : now + 6 * 86400e3;
  await putJSON(env, TOKEN_KEY, { token: j.token, expiresAt }, Math.floor((expiresAt - now) / 1000));
  return j.token;
}

async function token(env: Env, now: number, fresh = false): Promise<string> {
  const cached = await getJSON<{ token: string; expiresAt: number }>(env, TOKEN_KEY);
  if (!fresh && cached && cached.expiresAt - 3600e3 > now) return cached.token;
  return login(env, now);
}

/** GET from Glowmarkt with the cached token, logging in again once if it has expired. */
async function api(env: Env, path: string, now: number): Promise<any> {
  const get = async (tok: string) =>
    fetch(`${BASE}/${path}`, {
      headers: { applicationId: env.GLOW_APP_ID || DEFAULT_APP_ID, token: tok, "Content-Type": "application/json" },
    });
  let res = await get(await token(env, now));
  if (res.status === 401 || res.status === 403) res = await get(await token(env, now, true));
  if (!res.ok) throw new Error(`Glowmarkt ${path.split("?")[0]} failed: ${res.status}`);
  return res.json();
}

/** Find the resource ids for electricity/gas consumption and cost. */
export function findResources(entities: any[]): Resources {
  const r: Resources = {};
  for (const ve of entities ?? []) {
    for (const res of ve.resources ?? []) {
      const c = String(res.classifier ?? "");
      if (c === "electricity.consumption") r.elec ??= res.resourceId;
      if (c === "electricity.consumption.cost") r.elecCost ??= res.resourceId;
      if (c === "gas.consumption") r.gas ??= res.resourceId;
      if (c === "gas.consumption.cost") r.gasCost ??= res.resourceId;
    }
  }
  return r;
}

const glowTime = (d: Date) => d.toISOString().slice(0, 19); // YYYY-MM-DDTHH:MM:SS (UTC)

/** Half-hourly readings, grouped into UK dates: date -> 48 values. */
export function groupHalfHours(data: [number, number][]): HalfHours {
  const out: HalfHours = {};
  for (const [ts, value] of data ?? []) {
    const t = london(new Date(ts * 1000));
    const slot = Math.min(47, Math.floor(t.minutesOfDay / 30));
    (out[t.date] ??= new Array(48).fill(0))[slot] += Number(value) || 0;
  }
  return out;
}

async function readings(env: Env, id: string, fromDate: string, toDate: string, now: number): Promise<HalfHours> {
  const from = glowTime(ukMidnight(fromDate));
  const to = glowTime(new Date(ukMidnight(toDate).getTime() - 1000));
  const j = await api(env, `resource/${id}/readings?from=${from}&to=${to}&period=PT30M&offset=0&function=sum`, now);
  return groupHalfHours(j.data);
}

// ------------------------------------------------------------------ maths

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const round = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;

export function median(a: number[]): number {
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Always-on watts: the lowest-usage clock hour between 01:00 and 05:00. */
export function alwaysOnWatts(half: number[]): number | undefined {
  if (!half || half.length < 10) return undefined;
  const hours = [1, 2, 3, 4].map((h) => (half[h * 2] ?? 0) + (half[h * 2 + 1] ?? 0));
  if (hours.every((h) => h === 0)) return undefined; // no data rather than a house using nothing
  return Math.round(Math.min(...hours) * 1000); // kWh in one hour = average kW
}

function tariff(env: Env) {
  const n = (s?: string) => (s !== undefined && s !== "" && Number.isFinite(Number(s)) ? Number(s) : null);
  return {
    eUnit: n(env.ELEC_UNIT_P),
    eStand: n(env.ELEC_STANDING_P) ?? 0,
    gUnit: n(env.GAS_UNIT_P),
    gStand: n(env.GAS_STANDING_P) ?? 0,
  };
}

/** Build a day's totals. Meter cost data is used when it's there, otherwise the tariff settings. */
export function makeDay(
  env: Env,
  elec: number[] | undefined,
  gas: number[] | undefined,
  elecCost: number[] | undefined,
  gasCost: number[] | undefined,
): Day | null {
  const e = elec ? round(sum(elec), 3) : 0;
  const g = gas ? round(sum(gas), 3) : null;
  if (e <= 0 && !(g && g > 0)) return null; // not landed yet
  const tf = tariff(env);
  const meterE = elecCost ? sum(elecCost) : 0;
  const meterG = gasCost ? sum(gasCost) : 0;
  let ec: number | null = null, gc: number | null = null, src: Day["src"] = "none";
  if (meterE > 0 || meterG > 0) {
    src = "meter";
    ec = round(meterE + tf.eStand, 1);
    gc = g !== null ? round(meterG + tf.gStand, 1) : null;
  } else if (tf.eUnit !== null) {
    src = "tariff";
    ec = round(e * tf.eUnit + tf.eStand, 1);
    gc = g !== null && tf.gUnit !== null ? round(g * tf.gUnit + tf.gStand, 1) : null;
  }
  return { e, g, ec, gc, src, base: alwaysOnWatts(elec ?? []) };
}

const dayCost = (d: Day | undefined) => (d && d.ec !== null ? d.ec + (d.gc ?? 0) : null);
const pounds = (p: number) => `£${(p / 100).toFixed(2)}`;

function latestDate(days: Record<string, Day>): string | null {
  const k = Object.keys(days).sort();
  return k.length ? k[k.length - 1] : null;
}

// ------------------------------------------------------------------ alerts

/** Always-on up on the baseline for 2 nights running? Returns the alert text. */
export function alwaysOnAlert(days: Record<string, Day>, latest: string): string | null {
  const recent: number[] = [];
  for (let i = 0; i < SETTINGS.alwaysOnNights; i++) {
    const b = days[addDays(latest, -i)]?.base;
    if (b === undefined) return null;
    recent.push(b);
  }
  const history: number[] = [];
  for (let i = SETTINGS.alwaysOnNights; i < SETTINGS.alwaysOnNights + SETTINGS.baselineNights; i++) {
    const b = days[addDays(latest, -i)]?.base;
    if (b !== undefined) history.push(b);
  }
  if (history.length < SETTINGS.minBaselineNights) return null;
  const baseline = median(history);
  if (baseline <= 0 || !recent.every((b) => b >= baseline * SETTINGS.alwaysOnRise)) return null;
  return `Something's been left on: overnight use ${recent[0]} W, normally ${Math.round(baseline)} W.`;
}

/** Electricity or gas cost 50%+ above the same weekday's 4-week average. */
export function costAlerts(days: Record<string, Day>, date: string): { fuel: "electricity" | "gas"; text: string }[] {
  const out: { fuel: "electricity" | "gas"; text: string }[] = [];
  const d = days[date];
  if (!d) return out;
  for (const [fuel, field] of [["electricity", "ec"], ["gas", "gc"]] as const) {
    const cost = d[field];
    if (cost === null) continue;
    const past = [7, 14, 21, 28].map((n) => days[addDays(date, -n)]?.[field]).filter((x): x is number => typeof x === "number");
    if (past.length < 2) continue;
    const avg = sum(past) / past.length;
    if (cost >= avg * SETTINGS.costRise && cost - avg >= SETTINGS.minExtraPence) {
      out.push({ fuel, text: `${dayLabel(date)} ${fuel} cost ${pounds(cost)}, against a usual ${pounds(avg)} for that day of the week.` });
    }
  }
  return out;
}

function weekTotal(days: Record<string, Day>, from: string): { cost: number | null; kwh: number; n: number } {
  let cost: number | null = 0, kwh = 0, n = 0;
  for (let i = 0; i < 7; i++) {
    const d = days[addDays(from, i)];
    if (!d) continue;
    n++;
    kwh += d.e + (d.g ?? 0);
    const c = dayCost(d);
    cost = c === null || cost === null ? null : cost + c;
  }
  return { cost, kwh: round(kwh, 1), n };
}

export function weeklySummary(days: Record<string, Day>, monday: string): string | null {
  const last = weekTotal(days, addDays(monday, -7));
  if (last.n < 5) return null;
  const before = weekTotal(days, addDays(monday, -14));
  const lastYear = weekTotal(days, addDays(monday, -7 - 364));
  const fmt = (w: typeof last) => (w.cost !== null ? pounds(w.cost) : `${w.kwh} kWh`);
  const lines = [`Last week: ${fmt(last)}${last.n < 7 ? ` (${last.n} days of data)` : ""}.`];
  if (before.n >= 5) {
    if (last.cost !== null && before.cost !== null) {
      const diff = last.cost - before.cost;
      lines.push(`Week before: ${fmt(before)}, so ${pounds(Math.abs(diff))} ${diff >= 0 ? "more" : "less"}.`);
    } else lines.push(`Week before: ${fmt(before)}.`);
  }
  if (lastYear.n >= 5) lines.push(`Same week last year: ${fmt(lastYear)}.`);
  return lines.join("\n");
}

// ------------------------------------------------------------------ tick

export async function refresh(env: Env, t: LondonTime, now: number): Promise<Data> {
  const data = (await getJSON<Data>(env, DATA_KEY)) ?? { days: {} };
  const res = data.resources?.elec || data.resources?.gas ? data.resources : findResources(await api(env, "virtualentity", now));
  if (!res.elec && !res.gas) throw new Error("No smart meter found in the Bright account yet");

  // Ask Glowmarkt to pull the latest from the meter; harmless if it isn't supported.
  for (const id of [res.elec, res.gas]) {
    if (id) await api(env, `resource/${id}/catchup`, now).catch(() => undefined);
  }

  const from = addDays(t.date, -7);
  const read = (id?: string) => (id ? readings(env, id, from, t.date, now) : Promise.resolve({} as HalfHours));
  const [elec, gas, elecCost, gasCost] = await Promise.all([read(res.elec), read(res.gas), read(res.elecCost), read(res.gasCost)]);

  const half = (await getJSON<HalfHours>(env, HALF_KEY)) ?? {};
  for (let date = from; date < t.date; date = addDays(date, 1)) {
    const day = makeDay(env, elec[date], gas[date], elecCost[date], gasCost[date]);
    if (!day) continue;
    data.days[date] = day;
    if (elec[date]) half[date] = elec[date].map((v) => round(v, 3));
  }
  const keepFrom = addDays(t.date, -SETTINGS.keepDays);
  for (const k of Object.keys(data.days)) if (k < keepFrom) delete data.days[k];
  const halfFrom = addDays(t.date, -SETTINGS.keepHalfHourDays);
  for (const k of Object.keys(half)) if (k < halfFrom) delete half[k];

  data.resources = res;
  data.lastRun = t.date;
  await putJSON(env, HALF_KEY, half);
  return data;
}

async function alerts(env: Env, data: Data, t: LondonTime): Promise<void> {
  const latest = latestDate(data.days);
  if (!latest) return;
  const raise = async (key: string, title: string, text: string) => {
    if (await notifyOnce(env, key, { title, message: text, tags: ["zap"], priority: 4 }, 14)) data.alert = { date: t.date, text };
  };
  if (latest < addDays(t.date, -SETTINGS.staleDays)) {
    await raise(
      `energy:stale:${latest}`,
      "No smart meter readings",
      `Smart meter hasn't sent readings since ${dayLabel(latest)}. Check the Bright app.`,
    );
  }
  const on = alwaysOnAlert(data.days, latest);
  if (on) await raise(`energy:base:${latest}`, "Higher overnight use", on);
  for (const c of costAlerts(data.days, latest)) await raise(`energy:cost:${latest}:${c.fuel}`, `Expensive ${c.fuel} day`, c.text);
}

/** Runs every 10 minutes; does real work once a day after 10:00 (and retries if yesterday is missing). */
export async function tick(env: Env, t: LondonTime, now: Date, force = false): Promise<void> {
  if (!env.GLOW_USERNAME || !env.GLOW_PASSWORD) return;
  let data = (await getJSON<Data>(env, DATA_KEY)) ?? { days: {} };
  const yesterday = addDays(t.date, -1);
  const retry = !data.days[yesterday] && t.minute < 10 && [12, 14, 16, 18, 20].includes(t.hour);
  if (force || (t.hour >= 10 && (data.lastRun !== t.date || retry))) {
    let failed: unknown = null;
    try {
      data = await refresh(env, t, now.getTime());
    } catch (e) {
      failed = e;
      data.lastRun = t.date; // don't retry every 10 minutes; the retry slots above still apply
    }
    await alerts(env, data, t); // still warns about stale readings while the service is failing
    await putJSON(env, DATA_KEY, data);
    if (failed) throw failed;
  }

  // Weekly summary on Monday, once Sunday's readings are in (or by 14:00 regardless).
  if (t.weekday === 1 && t.hour >= 8 && (data.days[yesterday] || t.hour >= 14)) {
    const text = weeklySummary(data.days, t.date);
    if (text) await notifyOnce(env, `energy:week:${t.date}`, { title: "Energy last week", message: text, tags: ["zap"] }, 8);
  }
}

// ------------------------------------------------------------------ dashboard

export interface EnergyView {
  label: string; // "Yesterday" or "Sun 25 Oct"
  total: string; // "£4.82" or "12.4 kWh"
  split: string; // "elec £3.10, gas £1.72"
  week?: string; // "This week £18.40 · last week £21.10 by this point"
  spark: (number | null)[]; // 14 daily values, oldest first (pence, or kWh without costs)
  alert?: string;
  source: string; // where costs come from
}

export function view(data: Data | null, t: LondonTime): EnergyView | null {
  if (!data) return null;
  const latest = latestDate(data.days);
  if (!latest) return null;
  const d = data.days[latest];
  const yesterday = addDays(t.date, -1);
  const costs = dayCost(d) !== null;
  const value = (x: Day | undefined) => (x ? (costs ? dayCost(x) : round(x.e + (x.g ?? 0), 1)) : null);

  const split = costs
    ? `elec ${pounds(d.ec!)}${d.gc !== null ? `, gas ${pounds(d.gc)}` : ""}`
    : `elec ${round(d.e, 1)} kWh${d.g !== null ? `, gas ${round(d.g, 1)} kWh` : ""}`;

  // This week so far (Monday to yesterday) against the same days last week.
  let week: string | undefined;
  const daysIn = (t.weekday + 6) % 7; // days since Monday
  if (costs && daysIn > 0) {
    let now = 0, before = 0, n = 0;
    for (let i = daysIn; i >= 1; i--) {
      const a = dayCost(data.days[addDays(t.date, -i)]);
      const b = dayCost(data.days[addDays(t.date, -i - 7)]);
      if (a === null || b === null) continue;
      now += a;
      before += b;
      n++;
    }
    if (n) week = `This week ${pounds(now)} · last week ${pounds(before)} by this point`;
  }

  const spark: (number | null)[] = [];
  for (let i = 14; i >= 1; i--) {
    const v = value(data.days[addDays(t.date, -i)]);
    spark.push(v === null ? null : round(v, 1));
  }

  return {
    label: latest === yesterday ? "Yesterday" : dayLabel(latest),
    total: costs ? pounds(dayCost(d)!) : `${round(d.e + (d.g ?? 0), 1)} kWh`,
    split,
    week,
    spark,
    alert: data.alert && data.alert.date >= addDays(t.date, -2) ? data.alert.text : undefined,
    source:
      d.src === "meter"
        ? "Costs from the smart meter"
        : d.src === "tariff"
          ? "Costs worked out from your tariff"
          : "No cost data: add your tariff to see costs",
  };
}

export async function getView(env: Env, t: LondonTime): Promise<EnergyView | null> {
  if (!env.GLOW_USERNAME) return null;
  return view(await getJSON<Data>(env, DATA_KEY), t);
}
