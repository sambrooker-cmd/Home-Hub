// Tests for the add-ons: MOT/tax watcher, energy usage and Alexa (Voice Monkey).
// All external services are faked with canned answers via mockFetch.

import { afterEach, describe, expect, it, vi } from "vitest";
import { london, ukMidnight, addDays } from "../src/time";
import * as vehicles from "../src/modules/vehicles";
import * as energy from "../src/modules/energy";
import * as bins from "../src/modules/bins";
import * as f1 from "../src/modules/f1";
import * as alexa from "../src/alexa";
import { makeEnv, mockFetch } from "./helpers";

afterEach(() => vi.unstubAllGlobals());

const at = (iso: string) => ({ t: london(new Date(iso)), now: new Date(iso) });
const bodyOf = (call: any[]) => (typeof call[1]?.body === "string" ? call[1].body : "");
const callsTo = (fn: any, frag: string) => fn.mock.calls.filter((c: any[]) => String(c[0]).includes(frag));

// ---------------------------------------------------------------- vehicles
const DVSA_ENV = {
  DVSA_API_KEY: "dvsa-key",
  DVSA_CLIENT_ID: "id",
  DVSA_CLIENT_SECRET: "secret",
  DVSA_TOKEN_URL: "https://login.example/tenant/oauth2/v2.0/token",
};

const dvlaCar = {
  registrationNumber: "AB12CDE",
  make: "FORD",
  colour: "BLUE",
  taxStatus: "Taxed",
  taxDueDate: "2027-03-01",
  motStatus: "Valid",
  motExpiryDate: "2026-11-20",
  monthOfFirstRegistration: "2015-03",
};

const motTest = (n: string, date: string, miles: number, defects: any[] = []) => ({
  motTestNumber: n,
  completedDate: `${date}T10:00:00.000Z`,
  testResult: "PASSED",
  expiryDate: addDays(date, 367),
  odometerValue: String(miles),
  odometerUnit: "MI",
  defects,
});

const historyCar = (extra: any[] = []) => ({
  registration: "AB12CDE",
  make: "FORD",
  motTests: [
    ...extra,
    motTest("2", "2025-11-18", 60000, [
      { text: "Nearside Front Tyre worn close to legal limit/worn on edge (5.2.3 (e))", type: "ADVISORY" },
      { text: "Front brake disc worn, pitted or scored, but not seriously weakened (1.1.14 (a) (ii))", type: "ADVISORY" },
    ]),
    motTest("1", "2024-11-15", 52000),
  ],
});

function vehicleRoutes(over: Record<string, unknown> = {}) {
  return {
    "login.example": { access_token: "dvsa-token", expires_in: 1199 },
    "driver-vehicle-licensing.api.gov.uk": (_u: string, init: any) => {
      const reg = JSON.parse(init.body).registrationNumber;
      if (reg === "AB12CDE") return dvlaCar;
      if (reg === "VAN1") return { ...dvlaCar, registrationNumber: "VAN1", taxStatus: "Untaxed", taxDueDate: "2026-09-01", motExpiryDate: "2027-06-01" };
      if (reg === "XY24ZZZ") return { ...dvlaCar, registrationNumber: "XY24ZZZ", make: "HONDA", taxDueDate: "2027-09-01", monthOfFirstRegistration: "2024-05", motExpiryDate: undefined, motStatus: "No details held by DVLA" };
      return new Response(JSON.stringify({ errors: [{ status: "404" }] }), { status: 404 });
    },
    "history.mot.api.gov.uk": (url: string) => (url.endsWith("AB12CDE") ? historyCar() : historyCar()),
    ...over,
  };
}

describe("vehicles", () => {
  it("parses MOT history: advisories by part, plain wording, miles a year", () => {
    const p = vehicles.parseMotHistory(historyCar());
    expect(p.latest?.id).toBe("2");
    expect(p.advisories).toEqual([
      { part: "Tyres", text: "Nearside Front Tyre worn close to legal limit/worn on edge" },
      { part: "Brakes", text: "Front brake disc worn, pitted or scored, but not seriously weakened" },
    ]);
    expect(p.milesPerYear).toBe(7900);
    expect(vehicles.parseVehicles("car:AB12 CDE, bike:xy70zzz")).toEqual([
      { label: "car", reg: "AB12CDE" },
      { label: "bike", reg: "XY70ZZZ" },
    ]);
  });

  it("taxed car with advisories: 30-day MOT reminder once, tile line with parts to watch", async () => {
    const env = makeEnv({ VEHICLES: "car:AB12CDE", DVLA_VES_KEY: "dvla", ...DVSA_ENV });
    const { sent } = mockFetch(vehicleRoutes());
    const a = at("2026-10-21T08:05:00Z"); // Wed 09:05 BST, first run
    await vehicles.tick(env, a.t, a.now);
    const b = at("2026-10-21T08:15:00Z");
    await vehicles.tick(env, b.t, b.now);
    expect(sent.map((s) => s.title)).toEqual(["MOT due in 30 days for the car"]);
    expect(sent[0].body).toContain("Tyres, Brakes");

    const lines = await vehicles.getView(env, a.t);
    expect(lines).toEqual([
      { label: "Car", text: "MOT due Fri 20 Nov (30 days)", status: "ok", advisories: ["Tyres", "Brakes"], milesPerYear: 7900 },
    ]);
    expect(vehicles.view((await vehicles.details(env))!.list, london(new Date("2026-11-15T12:00:00Z")))[0].status).toBe("amber");
    expect(vehicles.view((await vehicles.details(env))!.list, london(new Date("2026-11-22T12:00:00Z")))[0].status).toBe("red");
  });

  it("untaxed vehicle alerts straight away; a wrong reg notifies once and the rest keep going", async () => {
    const env = makeEnv({ VEHICLES: "van:VAN1,car:WRONG1", DVLA_VES_KEY: "dvla" });
    const { sent } = mockFetch(vehicleRoutes());
    const a = at("2026-10-21T08:05:00Z");
    await vehicles.tick(env, a.t, a.now);
    await vehicles.tick(env, a.t, a.now, true);
    const titles = sent.map((s) => s.title);
    expect(titles).toContain("Van is showing as untaxed");
    expect(titles).toContain("Tax overdue for the van");
    expect(titles.filter((x) => x.startsWith("Can't find the car (WRONG1)"))).toHaveLength(1);
    expect(new Set(titles).size).toBe(titles.length); // nothing twice
    const lines = await vehicles.getView(env, a.t);
    expect(lines[0]).toMatchObject({ label: "Van", status: "red" });
  });

  it("new bike: first MOT from the registration month, no history lookup", async () => {
    const env = makeEnv({ VEHICLES: "bike:XY24ZZZ", DVLA_VES_KEY: "dvla", ...DVSA_ENV });
    const { fn } = mockFetch(vehicleRoutes());
    const a = at("2027-04-05T08:05:00Z"); // Mon 09:05 BST
    await vehicles.tick(env, a.t, a.now);
    expect(callsTo(fn, "history.mot.api.gov.uk")).toHaveLength(0);
    const lines = await vehicles.getView(env, a.t);
    expect(lines[0]).toMatchObject({ label: "Bike", text: "First MOT due Sat 1 May (26 days)" });
  });

  it("refreshes an expired DVSA token and reports a new MOT result once", async () => {
    const env = makeEnv({ VEHICLES: "car:AB12CDE", ...DVSA_ENV });
    // First week: the old history.
    let m = mockFetch(vehicleRoutes());
    const a = at("2026-10-18T08:05:00Z"); // Sun 09:05 BST
    await vehicles.tick(env, a.t, a.now);
    expect(m.sent).toHaveLength(0); // first read sets the baseline, no "new result"

    // A week later the cached token has expired, and a new test has appeared.
    await env.HUB.put("vehicles:dvsa-token", JSON.stringify({ token: "old", expiresAt: 0 }));
    m = mockFetch(
      vehicleRoutes({
        "login.example": { access_token: "fresh", expires_in: 1199 },
        "history.mot.api.gov.uk": (_u: string, init: any) =>
          init.headers.Authorization === "Bearer fresh"
            ? historyCar([{ ...motTest("3", "2026-10-23", 68000, [{ text: "Offside rear tyre slightly damaged (5.2.2)", type: "ADVISORY" }]), expiryDate: "2027-11-19" }])
            : new Response("", { status: 401 }),
      }),
    );
    const b = at("2026-10-25T09:05:00Z"); // Sun 09:05 GMT
    await vehicles.tick(env, b.t, b.now);
    await vehicles.tick(env, b.t, b.now, true);
    expect(callsTo(m.fn, "login.example").length).toBeGreaterThanOrEqual(1);
    expect(m.sent.map((s) => s.title)).toEqual(["Car MOT passed (Fri 23 Oct)"]);
    expect(m.sent[0].body).toContain("Tyres: Offside rear tyre slightly damaged");
    const lines = await vehicles.getView(env, b.t);
    expect(lines[0].text).toBe("MOT passed Fri 23 Oct");
  });
});

// ---------------------------------------------------------------- energy
type Slot = (date: string, slot: number) => number;

/** Glowmarkt-style readings: [[unix seconds, value], ...] for each half-hour of each date. */
function series(from: string, days: number, value: Slot, skip: string[] = []) {
  const data: [number, number][] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(from, i);
    if (skip.includes(date)) continue;
    const start = ukMidnight(date).getTime() / 1000;
    for (let s = 0; s < 48; s++) data.push([start + s * 1800, value(date, s)]);
  }
  return { data };
}

const night = (s: number) => s >= 2 && s <= 9; // 01:00 to 05:00
const ENTITIES = [
  {
    veId: "ve1",
    resources: [
      { resourceId: "E1", classifier: "electricity.consumption" },
      { resourceId: "EC1", classifier: "electricity.consumption.cost" },
      { resourceId: "G1", classifier: "gas.consumption" },
      { resourceId: "GC1", classifier: "gas.consumption.cost" },
    ],
  },
];

function glow(r: { elec?: any; elecCost?: any; gas?: any; gasCost?: any; entities?: any }, onRequest?: (init: any) => Response | void) {
  const guard = (body: any) => (_u: string, init: any) => onRequest?.(init) ?? body;
  return mockFetch({
    "/auth": { valid: true, token: "new", exp: 4102444800 },
    "/virtualentity": guard(r.entities ?? ENTITIES),
    "/catchup": guard({}),
    "resource/E1/readings": guard(r.elec ?? { data: [] }),
    "resource/EC1/readings": guard(r.elecCost ?? { data: [] }),
    "resource/G1/readings": guard(r.gas ?? { data: [] }),
    "resource/GC1/readings": guard(r.gasCost ?? { data: [] }),
  });
}

const GLOW_ENV = { GLOW_USERNAME: "sam@example.com", GLOW_PASSWORD: "pw" };
const normalDay = {
  elec: series("2026-10-14", 7, () => 0.2), // 9.6 kWh a day
  elecCost: series("2026-10-14", 7, () => 5), // £2.40
  gas: series("2026-10-14", 7, () => 1), // 48 kWh
  gasCost: series("2026-10-14", 7, () => 3), // £1.44
};

describe("energy", () => {
  it("reads yesterday and shows the cost tile", async () => {
    const env = makeEnv(GLOW_ENV);
    const { sent } = glow(normalDay);
    const a = at("2026-10-21T09:05:00Z"); // Wed 10:05 BST
    await energy.tick(env, a.t, a.now);
    const v = (await energy.getView(env, a.t))!;
    expect(v).toMatchObject({ label: "Yesterday", total: "£3.84", split: "elec £2.40, gas £1.44", source: "Costs from the smart meter" });
    expect(v.week).toBeUndefined(); // no readings yet for Mon/Tue last week to compare with
    expect(v.spark).toHaveLength(14);
    expect(v.spark.slice(-7)).toEqual([384, 384, 384, 384, 384, 384, 384]);
    expect(sent).toHaveLength(0);
  });

  it("back-fills a late day on a later retry", async () => {
    const env = makeEnv(GLOW_ENV);
    glow({ elec: series("2026-10-14", 7, () => 0.2, ["2026-10-18", "2026-10-20"]) });
    let a = at("2026-10-21T09:05:00Z");
    await energy.tick(env, a.t, a.now);
    let v = (await energy.getView(env, a.t))!;
    expect(v.label).toBe("Mon 19 Oct");
    expect(v.total).toBe("9.6 kWh"); // no cost data and no tariff: kWh only
    expect(v.source).toContain("add your tariff");

    const { fn } = glow({ elec: series("2026-10-14", 7, () => 0.2) });
    a = at("2026-10-21T10:15:00Z"); // 11:15: not a retry slot
    await energy.tick(env, a.t, a.now);
    expect(fn).not.toHaveBeenCalled();
    a = at("2026-10-21T11:05:00Z"); // 12:05: retry
    await energy.tick(env, a.t, a.now);
    v = (await energy.getView(env, a.t))!;
    expect(v.label).toBe("Yesterday");
    expect(v.spark.filter((x) => x !== null)).toHaveLength(7); // 14th to 20th, including the 18th
  });

  it("alerts when always-on use jumps for 2 nights running", async () => {
    const env = makeEnv(GLOW_ENV);
    const days: Record<string, energy.Day> = {};
    for (let i = 1; i <= 13; i++) days[`2026-10-${String(i).padStart(2, "0")}`] = { e: 8, g: 40, ec: 200, gc: 120, src: "meter", base: 220 };
    await env.HUB.put("energy:data", JSON.stringify({ days }));
    const high = (d: string) => d === "2026-10-19" || d === "2026-10-20";
    const { sent } = glow({
      ...normalDay,
      elec: series("2026-10-14", 7, (d, s) => (night(s) ? (high(d) ? 0.155 : 0.11) : 0.2)),
    });
    const a = at("2026-10-21T09:05:00Z");
    await energy.tick(env, a.t, a.now);
    expect(sent.map((s) => s.body)).toEqual(["Something's been left on: overnight use 310 W, normally 220 W."]);
    expect((await energy.getView(env, a.t))!.alert).toContain("310 W");
  });

  it("handles a meter with no gas, and falls back to the tariff when cost data is empty", async () => {
    const env = makeEnv({ ...GLOW_ENV, ELEC_UNIT_P: "25", ELEC_STANDING_P: "50" });
    glow({
      entities: [{ veId: "ve1", resources: [ENTITIES[0].resources[0], ENTITIES[0].resources[1]] }],
      elec: normalDay.elec,
      elecCost: series("2026-10-14", 7, () => 0),
    });
    const a = at("2026-10-21T09:05:00Z");
    await energy.tick(env, a.t, a.now);
    const v = (await energy.getView(env, a.t))!;
    expect(v).toMatchObject({ total: "£2.90", split: "elec £2.90", source: "Costs worked out from your tariff" });
  });

  it("logs in again when the token has expired or is refused", async () => {
    const env = makeEnv(GLOW_ENV);
    await env.HUB.put("energy:glow-token", JSON.stringify({ token: "old", expiresAt: 4102444800000 }));
    const { fn } = glow(normalDay, (init) => (init?.headers?.token === "old" ? new Response("", { status: 401 }) : undefined));
    const a = at("2026-10-21T09:05:00Z");
    await energy.tick(env, a.t, a.now);
    expect(callsTo(fn, "/auth")).toHaveLength(1);
    expect((await energy.getView(env, a.t))!.total).toBe("£3.84");
  });

  it("warns when the meter stops sending readings", async () => {
    const env = makeEnv(GLOW_ENV);
    await env.HUB.put("energy:data", JSON.stringify({ days: { "2026-10-16": { e: 8, g: null, ec: 200, gc: null, src: "meter" } } }));
    const { sent } = glow({});
    const a = at("2026-10-21T09:05:00Z");
    await energy.tick(env, a.t, a.now);
    expect(sent.map((s) => s.body)).toEqual(["Smart meter hasn't sent readings since Fri 16 Oct. Check the Bright app."]);
  });

  it("sums last week against the week before", () => {
    const days: Record<string, energy.Day> = {};
    for (let i = 0; i < 7; i++) {
      days[addDays("2026-10-12", i)] = { e: 8, g: 30, ec: 200, gc: 100, src: "meter" };
      days[addDays("2026-10-05", i)] = { e: 8, g: 30, ec: 150, gc: 100, src: "meter" };
    }
    expect(energy.weeklySummary(days, "2026-10-19")).toBe("Last week: £21.00.\nWeek before: £17.50, so £3.50 more.");
  });
});

// ---------------------------------------------------------------- alexa
const ALEXA_ENV = {
  MODULES: "bins,f1,alexa",
  VOICEMONKEY_TOKEN: "vm-token",
  ALEXA_SPEAKERS: "kitchen,hallway",
  ALEXA_TRIGGER_BINS: "bin-lamp",
  ALEXA_TRIGGER_RACE: "race-tv",
};
const vmCalls = (fn: any) =>
  callsTo(fn, "voicemonkey.io").map((c: any[]) => ({ path: new URL(String(c[0])).pathname, ...JSON.parse(bodyOf(c)) }));

describe("Alexa", () => {
  it("knows quiet hours (default 21:00 to 07:00)", () => {
    const env = makeEnv(ALEXA_ENV);
    const q = (iso: string) => alexa.isQuiet(env, london(new Date(iso)));
    expect(q("2026-12-01T20:30:00Z")).toBe(false);
    expect(q("2026-12-01T21:00:00Z")).toBe(true);
    expect(q("2026-12-02T06:59:00Z")).toBe(true);
    expect(q("2026-12-02T07:00:00Z")).toBe(false);
  });

  it("says the bin reminder in the kitchen and hallway and switches the bin lamp on", async () => {
    const env = makeEnv({ ...ALEXA_ENV, BIN_ICS_URL: "https://council.example/bins.ics" });
    const ics = ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "DTSTART;VALUE=DATE:20261027", "SUMMARY:Green & Food", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
    const { fn } = mockFetch({ "council.example": ics, "voicemonkey.io": {} });
    await bins.tick(env, london(new Date("2026-10-26T19:05:00Z")));
    await bins.tick(env, london(new Date("2026-10-26T19:15:00Z")));
    expect(vmCalls(fn)).toEqual([
      { path: "/announce", token: "vm-token", device: "kitchen,hallway", speech: "Bins tomorrow: green and food. Put them out tonight." },
      { path: "/trigger", token: "vm-token", device: "bin-lamp" },
    ]);
  });

  it("stays silent in quiet hours and when switched off", async () => {
    const { fn } = mockFetch({ "voicemonkey.io": {} });
    expect(await alexa.say(makeEnv(ALEXA_ENV), london(new Date("2026-12-01T22:00:00Z")), "hi")).toBe(false);
    expect(await alexa.say(makeEnv({ ...ALEXA_ENV, MODULES: "bins" }), london(new Date("2026-12-01T12:00:00Z")), "hi")).toBe(false);
    expect(fn).not.toHaveBeenCalled();
  });

  it("starts the race routine a few minutes before lights out, once", async () => {
    const env = makeEnv(ALEXA_ENV);
    const race = {
      MRData: { RaceTable: { Races: [{ round: "20", raceName: "Mexico City Grand Prix", date: "2026-11-01", time: "20:00:00Z", Circuit: {} }] } },
    };
    const { fn } = mockFetch({
      "/current.json": race,
      "/current/last/results.json": { MRData: { RaceTable: { Races: [] } } },
      "/current/driverStandings.json": { MRData: { StandingsTable: { StandingsLists: [] } } },
      "voicemonkey.io": {},
    });
    const tick = (iso: string) => f1.tick(env, london(new Date(iso)), new Date(iso));
    await tick("2026-11-01T19:30:00Z"); // 30 min before: notification + spoken
    await tick("2026-11-01T19:50:00Z"); // 10 min before: TV routine
    await tick("2026-11-01T19:55:00Z");
    expect(vmCalls(fn)).toEqual([
      { path: "/announce", token: "vm-token", device: "kitchen,hallway", speech: "Race starts in 30 minutes." },
      { path: "/trigger", token: "vm-token", device: "race-tv" },
    ]);
  });
});
