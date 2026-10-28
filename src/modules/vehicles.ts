// MOT and tax watcher. Once a week it looks up each vehicle by reg plate and
// warns ahead of the tax and MOT due dates, with the last MOT's advisories.
// Two free government APIs, each optional (use whichever you have a key for):
//   DVLA Vehicle Enquiry Service: tax status and due date, MOT expiry, first registration.
//     https://developer-portal.driver-vehicle-licensing.api.gov.uk/apis/vehicle-enquiry-service/vehicle-enquiry-service-description.html
//   DVSA MOT History: every past test with result, mileage and advisories.
//     https://documentation.history.mot.api.gov.uk/

import type { Env } from "../env";
import { getJSON, putJSON } from "../store";
import { notifyOnce } from "../notify";
import { dayLabel, type LondonTime } from "../time";

const DVLA_URL = "https://driver-vehicle-licensing.api.gov.uk/vehicle-enquiry/v1/vehicles";
const DVSA_URL = "https://history.mot.api.gov.uk/v1/trade/vehicles/registration/";
const DATA_KEY = "vehicles:data";
const TOKEN_KEY = "vehicles:dvsa-token";

export interface Advisory {
  part: string; // "Tyres", "Brakes"...
  text: string;
}

export interface VehicleRecord {
  label: string; // "car", "bike"
  reg: string;
  make?: string;
  colour?: string;
  taxStatus?: string; // DVLA: "Taxed", "Untaxed", "SORN"...
  taxDue?: string; // YYYY-MM-DD
  motStatus?: string; // DVLA: "Valid", "Not valid"...
  motDue?: string; // YYYY-MM-DD
  firstMot?: boolean; // motDue is the first MOT (3 years after registration)
  lastTest?: { id: string; date: string; result: "PASSED" | "FAILED"; miles?: number };
  newResultOn?: string; // date the hub first saw lastTest
  advisories: Advisory[];
  milesPerYear?: number;
  error?: string;
}

interface Data {
  lastRun: string; // date of the last weekly read
  list: VehicleRecord[];
}

/** "car:AB12CDE,bike:XY70ZZZ" -> [{label, reg}] */
export function parseVehicles(s: string | undefined): { label: string; reg: string }[] {
  return (s ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const [a, b] = p.includes(":") ? p.split(":") : ["vehicle", p];
      return { label: a.trim().toLowerCase(), reg: b.replace(/[^A-Za-z0-9]/g, "").toUpperCase() };
    })
    .filter((v) => v.reg);
}

const PARTS: [RegExp, string][] = [
  [/tyre|tread|sidewall/i, "Tyres"],
  [/brake|disc|pad|caliper|drum/i, "Brakes"],
  [/suspension|shock|spring|bush|ball joint|anti-roll|wishbone|strut/i, "Suspension"],
  [/steering|track rod|rack/i, "Steering"],
  [/lamp|light|headlamp|indicator|bulb|reflector/i, "Lights"],
  [/exhaust|emission|silencer/i, "Exhaust"],
  [/wiper|windscreen|washer|mirror/i, "Windscreen and mirrors"],
  [/corro|rust/i, "Corrosion"],
  [/chain|sprocket/i, "Chain and sprockets"],
  [/oil|fluid|leak/i, "Leaks"],
];

export function partOf(text: string): string {
  for (const [re, part] of PARTS) if (re.test(text)) return part;
  return "Other";
}

/** Tidy DVSA wording a little: drop the trailing MOT manual reference like "(5.2.3 (e))". */
function plain(text: string): string {
  return text.replace(/\s*\(\d+(\.\d+)*\s*(\([a-z]+\))*\s*(\([ivx]+\))*\)\s*$/i, "").replace(/\s+/g, " ").trim();
}

function toMiles(value: unknown, unit: unknown): number | undefined {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return String(unit).toUpperCase() === "KM" ? Math.round(n * 0.621371) : n;
}

const isoDate = (s: unknown) => (typeof s === "string" ? s.slice(0, 10).replace(/\./g, "-") : undefined);

/** Average miles a year across the test history. */
export function milesPerYear(tests: { date: string; miles?: number }[]): number | undefined {
  const m = tests.filter((x) => x.miles).sort((a, b) => a.date.localeCompare(b.date));
  if (m.length < 2) return undefined;
  const first = m[0], last = m[m.length - 1];
  const years = (Date.parse(last.date) - Date.parse(first.date)) / (365.25 * 86400e3);
  if (years < 0.5) return undefined;
  return Math.round((last.miles! - first.miles!) / years / 100) * 100;
}

/** Turn a DVSA vehicle answer into the parts the hub keeps. */
export function parseMotHistory(j: any) {
  const tests = ((j?.motTests ?? []) as any[]).map((t) => ({
    id: String(t.motTestNumber ?? t.completedDate),
    date: isoDate(t.completedDate)!,
    result: (String(t.testResult).toUpperCase().startsWith("PASS") ? "PASSED" : "FAILED") as "PASSED" | "FAILED",
    expiry: isoDate(t.expiryDate),
    miles: toMiles(t.odometerValue, t.odometerUnit),
    defects: ((t.defects ?? t.rfrAndComments ?? []) as any[]).map((d) => ({
      type: String(d.type ?? "").toUpperCase(),
      text: plain(String(d.text ?? "")),
    })),
  }));
  tests.sort((a, b) => b.date.localeCompare(a.date));
  const latest = tests[0];
  const motDue = tests.find((t) => t.expiry)?.expiry ?? isoDate(j?.motTestDueDate);
  return {
    make: j?.make as string | undefined,
    colour: j?.primaryColour as string | undefined,
    latest,
    motDue,
    firstMot: !tests.length && !!motDue,
    // Advisories (and minor defects) from the latest test, to keep an eye on.
    advisories: latest
      ? latest.defects
          .filter((d) => d.text && /ADVISORY|MINOR|PRS/.test(d.type))
          .map((d) => ({ part: partOf(d.text), text: d.text }))
      : [],
    failures: latest ? latest.defects.filter((d) => /MAJOR|DANGEROUS|FAIL/.test(d.type)).map((d) => d.text) : [],
    milesPerYear: milesPerYear(tests),
  };
}

/** First MOT is due 3 years after first registration ("2024-05" -> "2027-05-01", the earliest it could be). */
export function firstMotDue(monthOfFirstRegistration: string | undefined): string | undefined {
  const m = monthOfFirstRegistration?.match(/^(\d{4})-(\d{2})/);
  return m ? `${Number(m[1]) + 3}-${m[2]}-01` : undefined;
}

async function dvla(env: Env, reg: string): Promise<any | null> {
  const res = await fetch(DVLA_URL, {
    method: "POST",
    headers: { "x-api-key": env.DVLA_VES_KEY!, "Content-Type": "application/json" },
    body: JSON.stringify({ registrationNumber: reg }),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`DVLA failed: ${res.status}`);
  return res.json();
}

interface Token {
  token: string;
  expiresAt: number; // ms
}

async function dvsaToken(env: Env, now: number, fresh = false): Promise<string> {
  const cached = await getJSON<Token>(env, TOKEN_KEY);
  if (!fresh && cached && cached.expiresAt - 60_000 > now) return cached.token;
  const res = await fetch(env.DVSA_TOKEN_URL!, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: env.DVSA_CLIENT_ID!,
      client_secret: env.DVSA_CLIENT_SECRET!,
      scope: env.DVSA_SCOPE || "https://tapi.dvsa.gov.uk/.default",
    }).toString(),
  });
  if (!res.ok) throw new Error(`DVSA token failed: ${res.status}`);
  const j: any = await res.json();
  const ttl = Number(j.expires_in) || 1200;
  await putJSON(env, TOKEN_KEY, { token: j.access_token, expiresAt: now + ttl * 1000 }, ttl);
  return j.access_token;
}

async function dvsa(env: Env, reg: string, now: number): Promise<any | null> {
  const get = (token: string) =>
    fetch(DVSA_URL + encodeURIComponent(reg), {
      headers: { Authorization: `Bearer ${token}`, "X-API-Key": env.DVSA_API_KEY!, Accept: "application/json" },
    });
  let res = await get(await dvsaToken(env, now));
  if (res.status === 401) res = await get(await dvsaToken(env, now, true)); // token expired early
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`DVSA failed: ${res.status}`);
  return res.json();
}

const hasDvla = (env: Env) => !!env.DVLA_VES_KEY;
const hasDvsa = (env: Env) => !!(env.DVSA_API_KEY && env.DVSA_CLIENT_ID && env.DVSA_CLIENT_SECRET && env.DVSA_TOKEN_URL);

/** Look one vehicle up in both services. Notifies once if the reg isn't found. */
async function lookup(
  env: Env,
  v: { label: string; reg: string },
  prev: VehicleRecord | undefined,
  t: LondonTime,
  now: number,
): Promise<VehicleRecord> {
  const rec: VehicleRecord = { label: v.label, reg: v.reg, advisories: [] };
  let notFound = false;

  let recentlyRegistered = false;
  if (hasDvla(env)) {
    const d = await dvla(env, v.reg);
    if (!d) notFound = true;
    else {
      rec.make = d.make;
      rec.colour = d.colour;
      rec.taxStatus = d.taxStatus;
      rec.taxDue = isoDate(d.taxDueDate);
      rec.motStatus = d.motStatus;
      rec.motDue = isoDate(d.motExpiryDate);
      const first = firstMotDue(d.monthOfFirstRegistration);
      if (first && first > t.date && !rec.motDue) {
        // Under 3 years old: no MOT history to fetch yet.
        recentlyRegistered = true;
        rec.motDue = first;
        rec.firstMot = true;
      }
    }
  }

  if (hasDvsa(env) && !recentlyRegistered && !(hasDvla(env) && notFound)) {
    const h = await dvsa(env, v.reg, now);
    if (!h) {
      if (!hasDvla(env)) notFound = true; // otherwise DVLA knows it: just no MOT history yet
    } else {
      const p = parseMotHistory(h);
      rec.make ??= p.make;
      rec.colour ??= p.colour;
      if (p.motDue && (!rec.motDue || p.motDue > rec.motDue)) rec.motDue = p.motDue;
      rec.firstMot = p.firstMot && !p.latest;
      rec.advisories = p.advisories;
      rec.milesPerYear = p.milesPerYear;
      if (p.latest) {
        rec.lastTest = { id: p.latest.id, date: p.latest.date, result: p.latest.result, miles: p.latest.miles };
        const isNew = prev?.lastTest && prev.lastTest.id !== p.latest.id;
        rec.newResultOn = isNew ? t.date : prev?.lastTest?.id === p.latest.id ? prev.newResultOn : undefined;
        if (isNew) await notifyNewResult(env, rec, p.failures);
      }
    }
  }

  if (notFound) {
    rec.error = "not found";
    await notifyOnce(env, `vehicles:notfound:${v.reg}`, {
      title: `Can't find the ${v.label} (${v.reg})`,
      message: "The DVLA/DVSA don't recognise that reg. Check the VEHICLES setting.",
      tags: ["warning"],
    }, 30);
  }
  return rec;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

async function notifyNewResult(env: Env, rec: VehicleRecord, failures: string[]): Promise<void> {
  const test = rec.lastTest!;
  const lines: string[] = [];
  if (failures.length) lines.push("Failed on:", ...failures.map((f) => `- ${f}`));
  if (rec.advisories.length) lines.push("Advisories:", ...rec.advisories.map((a) => `- ${a.part}: ${a.text}`));
  if (!lines.length) lines.push("No advisories.");
  if (rec.motDue && test.result === "PASSED") lines.push(`Next MOT due ${dayLabel(rec.motDue)}.`);
  await notifyOnce(env, `vehicles:result:${rec.reg}:${test.id}`, {
    title: `${cap(rec.label)} MOT ${test.result === "PASSED" ? "passed" : "failed"} (${dayLabel(test.date)})`,
    message: lines.join("\n"),
    tags: [test.result === "PASSED" ? "white_check_mark" : "x"],
  }, 60);
}

export function daysUntil(date: string, today: string): number {
  return Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86400e3);
}

/** Which reminder a due date is in: 30 days, 7 days, the day before, or overdue. */
export function bucket(days: number): "30" | "7" | "1" | "overdue" | null {
  if (days < 0) return "overdue";
  if (days <= 1) return "1";
  if (days <= 7) return "7";
  if (days <= 30) return "30";
  return null;
}

function whenText(days: number): string {
  if (days < 0) return `${-days} day${days === -1 ? "" : "s"} ago`;
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

/** Daily: reminders from the stored dates (no API calls). */
async function remind(env: Env, rec: VehicleRecord, t: LondonTime): Promise<void> {
  const name = `the ${rec.label}`;
  const due: [string, string | undefined, string][] = [
    ["tax", rec.taxStatus === "SORN" ? undefined : rec.taxDue, "https://www.gov.uk/vehicle-tax"],
    ["MOT", rec.motDue, "https://www.gov.uk/getting-an-mot"],
  ];
  for (const [kind, date, link] of due) {
    if (!date) continue;
    const days = daysUntil(date, t.date);
    const b = bucket(days);
    if (!b) continue;
    const what = kind === "MOT" && rec.firstMot ? "first MOT" : kind;
    await notifyOnce(env, `vehicles:${rec.reg}:${kind}:${date}:${b}`, {
      title: b === "overdue" ? `${cap(what)} overdue for ${name}` : `${cap(what)} due ${whenText(days)} for ${name}`,
      message:
        `${cap(rec.label)} (${rec.reg}): ${what} ${b === "overdue" ? "was" : "is"} due ${dayLabel(date)}.` +
        (kind === "MOT" && rec.advisories.length && b !== "overdue"
          ? `\nLast time's advisories: ${[...new Set(rec.advisories.map((a) => a.part))].join(", ")}.`
          : ""),
      tags: ["car"],
      priority: b === "30" ? 3 : 4,
      click: link,
    }, 40);
  }
  // Straight away if DVLA says it's untaxed or has no valid MOT.
  if (rec.taxStatus && /untaxed|tax due/i.test(rec.taxStatus)) {
    await notifyOnce(env, `vehicles:${rec.reg}:untaxed:${rec.taxDue ?? ""}`, {
      title: `${cap(rec.label)} is showing as untaxed`,
      message: `DVLA says ${rec.reg} is "${rec.taxStatus}". Tax it or make a SORN before driving.`,
      tags: ["warning"],
      priority: 4,
      click: "https://www.gov.uk/vehicle-tax",
    }, 30);
  }
  if (rec.motStatus && /not valid/i.test(rec.motStatus)) {
    await notifyOnce(env, `vehicles:${rec.reg}:nomot:${rec.motDue ?? ""}`, {
      title: `${cap(rec.label)} has no valid MOT`,
      message: `DVLA says the MOT for ${rec.reg} is "${rec.motStatus}".`,
      tags: ["warning"],
      priority: 4,
      click: "https://www.gov.uk/getting-an-mot",
    }, 30);
  }
}

/** Weekly read on Sunday at 09:00 UK (or when there's no data yet); reminders every morning at 09:00. */
export async function tick(env: Env, t: LondonTime, now: Date, force = false): Promise<void> {
  const vehicles = parseVehicles(env.VEHICLES);
  if (!vehicles.length || !(hasDvla(env) || hasDvsa(env))) return;
  let data = await getJSON<Data>(env, DATA_KEY);
  const sameList = data && vehicles.every((v) => data!.list.some((r) => r.reg === v.reg)) && data.list.length === vehicles.length;
  const weekly = t.weekday === 0 && t.hour === 9 && data?.lastRun !== t.date;
  if (force || weekly || !data || !sameList) {
    const list: VehicleRecord[] = [];
    for (const v of vehicles) {
      const prev = data?.list.find((r) => r.reg === v.reg);
      try {
        list.push(await lookup(env, v, prev, t, now.getTime()));
      } catch (e) {
        // One vehicle failing (or a service being down) keeps the last good data for it.
        console.error(`[vehicles] ${v.reg}`, e);
        list.push(prev ?? { label: v.label, reg: v.reg, advisories: [], error: (e as Error).message });
      }
    }
    data = { lastRun: t.date, list };
    await putJSON(env, DATA_KEY, data);
  }
  if (t.hour === 9 || force) for (const rec of data.list) await remind(env, rec, t);
}

export interface VehicleLine {
  label: string; // "Bike"
  text: string; // "MOT due 14 Mar (16 days)"
  status: "ok" | "amber" | "red";
  advisories?: string[]; // parts to watch, in the month before the MOT
  milesPerYear?: number;
}

/** Tile lines: only things due within 30 days, untaxed / no MOT, or a new result this week. */
export function view(list: VehicleRecord[], t: LondonTime): VehicleLine[] {
  const out: VehicleLine[] = [];
  for (const r of list) {
    const label = cap(r.label);
    const items: { text: string; status: VehicleLine["status"]; days: number }[] = [];
    for (const [kind, date] of [["Tax", r.taxStatus === "SORN" ? undefined : r.taxDue], ["MOT", r.motDue]] as const) {
      if (!date) continue;
      const days = daysUntil(date, t.date);
      if (days > 30) continue;
      const what = kind === "MOT" && r.firstMot ? "First MOT" : kind;
      items.push({
        text: days < 0 ? `${what} overdue since ${dayLabel(date)}` : `${what} due ${dayLabel(date)} (${days === 0 ? "today" : days === 1 ? "tomorrow" : `${days} days`})`,
        status: days < 0 ? "red" : days <= 7 ? "amber" : "ok",
        days,
      });
    }
    if (r.taxStatus && /untaxed|tax due/i.test(r.taxStatus) && !items.some((i) => i.status === "red" && i.text.startsWith("Tax")))
      items.push({ text: "Showing as untaxed", status: "red", days: -1 });
    if (r.motStatus && /not valid/i.test(r.motStatus) && !items.some((i) => i.status === "red" && i.text.includes("MOT")))
      items.push({ text: "No valid MOT", status: "red", days: -1 });
    if (r.lastTest && r.newResultOn && daysUntil(r.newResultOn, t.date) >= -7)
      items.push({ text: `MOT ${r.lastTest.result === "PASSED" ? "passed" : "failed"} ${dayLabel(r.lastTest.date)}`, status: r.lastTest.result === "PASSED" ? "ok" : "red", days: 99 });
    if (!items.length) continue;
    items.sort((a, b) => a.days - b.days);
    const motSoon = r.motDue && daysUntil(r.motDue, t.date) <= 31;
    out.push({
      label,
      text: items.map((i) => i.text).join(" · "),
      status: items.some((i) => i.status === "red") ? "red" : items.some((i) => i.status === "amber") ? "amber" : "ok",
      advisories: motSoon && r.advisories.length ? [...new Set(r.advisories.map((a) => a.part))] : undefined,
      milesPerYear: r.milesPerYear,
    });
  }
  return out;
}

export async function getView(env: Env, t: LondonTime): Promise<VehicleLine[]> {
  return view((await getJSON<Data>(env, DATA_KEY))?.list ?? [], t);
}

/** Everything stored, for /api/vehicles (handy for insurance renewals: miles a year). */
export async function details(env: Env): Promise<Data | null> {
  return getJSON<Data>(env, DATA_KEY);
}
