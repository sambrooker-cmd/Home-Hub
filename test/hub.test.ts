import { afterEach, describe, expect, it, vi } from "vitest";
import { london, addDays } from "../src/time";
import * as bins from "../src/modules/bins";
import * as commute from "../src/modules/commute";
import * as dart from "../src/modules/dartcharge";
import * as f1 from "../src/modules/f1";
import * as watch from "../src/modules/watch";
import * as weather from "../src/modules/weather";
import worker from "../src/index";
import { makeEnv, mockFetch } from "./helpers";

afterEach(() => vi.unstubAllGlobals());

// ---------------------------------------------------------------- time
describe("UK time", () => {
  it("handles BST and GMT", () => {
    expect(london(new Date("2026-07-01T18:30:00Z")).hour).toBe(19); // BST
    expect(london(new Date("2026-12-01T18:30:00Z")).hour).toBe(18); // GMT
  });
  it("handles the clocks going back on 25 Oct 2026", () => {
    expect(london(new Date("2026-10-24T23:30:00Z")).date).toBe("2026-10-25"); // 00:30 BST
    expect(london(new Date("2026-10-25T23:30:00Z")).date).toBe("2026-10-25"); // 23:30 GMT
  });
  it("adds days across month ends", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
  });
});

// ---------------------------------------------------------------- bins
const ICS = [
  "BEGIN:VCALENDAR",
  "BEGIN:VEVENT",
  "DTSTART;VALUE=DATE:20261027",
  "SUMMARY:Green bin collection",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTSTART;VALUE=DATE:20261027",
  "SUMMARY:Food waste",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTSTART:20261102T230000Z", // 23:00 GMT on 2 Nov = 2 Nov UK
  "SUMMARY:Black bin\\, ",
  " and Glass",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTSTART;VALUE=DATE:20261229",
  "SUMMARY:Recycling collection (moved for Christmas)",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

describe("bins", () => {
  it("parses ICS, merges same-day events, unfolds lines", () => {
    const cols = bins.parseICS(ICS);
    expect(cols[0]).toEqual({ date: "2026-10-27", bins: ["Green", "Food"] });
    expect(cols[1].date).toBe("2026-11-02");
    expect(cols[1].bins).toEqual(["Black", "Glass"]);
    expect(cols[2].date).toBe("2026-12-29");
  });

  it("shows the big tile from 4pm the day before until 9am on the day", () => {
    const cols = bins.parseICS(ICS);
    const at = (iso: string) => bins.view(cols, london(new Date(iso)));
    expect(at("2026-10-26T14:00:00Z").showTile).toBe(false); // 2pm GMT Monday
    expect(at("2026-10-26T14:00:00Z").nextLine).toContain("Green + Food");
    expect(at("2026-10-26T16:30:00Z")).toMatchObject({ showTile: true, headline: "Bins out tonight" });
    expect(at("2026-10-27T07:00:00Z")).toMatchObject({ showTile: true, headline: "Bins today" });
    const after = at("2026-10-27T10:00:00Z");
    expect(after.showTile).toBe(false);
    expect(after.nextLine).toContain("Black + Glass");
  });

  it("sends one reminder at 7pm the night before", async () => {
    const env = makeEnv({ BIN_ICS_URL: "https://council.example/bins.ics" });
    const { sent } = mockFetch({ "council.example": ICS });
    const t = london(new Date("2026-10-26T19:05:00Z")); // 19:05 GMT
    await bins.tick(env, t);
    await bins.tick(env, london(new Date("2026-10-26T19:15:00Z")));
    expect(sent).toHaveLength(1);
    expect(sent[0].title).toBe("Bins tomorrow: Green + Food");
  });
});

// ---------------------------------------------------------------- commute
const tomtom = (live: number, historic: number, alt?: number) => ({
  routes: [
    { summary: { travelTimeInSeconds: live * 60, historicTrafficTravelTimeInSeconds: historic * 60, lengthInMeters: 32000 } },
    ...(alt ? [{ summary: { travelTimeInSeconds: alt * 60, historicTrafficTravelTimeInSeconds: alt * 60, lengthInMeters: 41000 } }] : []),
  ],
});

describe("commute", () => {
  it("works out delay against the usual time", () => {
    const { main, alt } = commute.parseTomTom(tomtom(52, 35, 44));
    expect(main).toMatchObject({ minutes: 52, typicalMinutes: 35, delayMinutes: 17 });
    expect(alt?.minutes).toBe(44);
    expect(commute.statusFor(17, 10)).toBe("red");
    expect(commute.statusFor(6, 10)).toBe("amber");
    expect(commute.statusFor(2, 10)).toBe("green");
  });

  it("alerts once on a bad morning, never on a normal one or at weekends", async () => {
    const env = makeEnv({ TOMTOM_KEY: "k" });
    let m = mockFetch({ "api.tomtom.com": tomtom(38, 35) });
    await commute.tick(env, london(new Date("2026-10-21T06:40:00Z"))); // Wed 07:40 BST, normal
    expect(m.sent).toHaveLength(0);

    m = mockFetch({ "api.tomtom.com": tomtom(55, 35, 45) });
    await commute.tick(env, london(new Date("2026-10-21T06:50:00Z")));
    await commute.tick(env, london(new Date("2026-10-21T07:00:00Z")));
    expect(m.sent).toHaveLength(1);
    expect(m.sent[0].title).toBe("Traffic: 55 min to work");
    expect(m.sent[0].body).toContain("Alternative route: 45 min");

    m = mockFetch({ "api.tomtom.com": tomtom(55, 35) });
    await commute.tick(env, london(new Date("2026-10-24T06:50:00Z"))); // Saturday
    expect(m.fn).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------- dart charge
describe("Dart Charge", () => {
  it("records crossings, ignores double triggers, and reminds on the due day", async () => {
    const env = makeEnv();
    await dart.recordCrossing(env, new Date("2026-10-21T06:45:00Z"));
    await dart.recordCrossing(env, new Date("2026-10-21T06:50:00Z")); // duplicate trigger
    await dart.recordCrossing(env, new Date("2026-10-21T16:45:00Z")); // drive home
    const list = await dart.unpaid(env);
    expect(list).toHaveLength(2);
    expect(dart.dueDate(list)).toBe("2026-10-22");
    expect(dart.view(list, london(new Date("2026-10-21T19:00:00Z")))).toMatchObject({ count: 2, dueLabel: "tomorrow" });

    const { sent } = mockFetch({});
    await dart.tick(env, london(new Date("2026-10-22T12:00:00Z")), "https://hub.example"); // 1pm, too early
    await dart.tick(env, london(new Date("2026-10-22T17:00:00Z")), "https://hub.example"); // 6pm BST
    expect(sent).toHaveLength(1);
    expect(sent[0].title).toBe("Dart Charge due by midnight");
    expect(sent[0].headers.Actions).toContain("Mark paid");

    await dart.markPaid(env);
    expect(await dart.unpaid(env)).toHaveLength(0);
  });

  it("ignores crossings when the charge doesn't apply (10pm to 6am)", async () => {
    const env = makeEnv();
    await dart.recordCrossing(env, new Date("2026-10-21T21:30:00Z")); // 22:30 BST
    await dart.recordCrossing(env, new Date("2026-10-22T04:30:00Z")); // 05:30 BST
    expect(await dart.unpaid(env)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------- F1
const schedule = {
  MRData: {
    RaceTable: {
      Races: [
        {
          round: "20",
          raceName: "Mexico City Grand Prix",
          date: "2026-11-01",
          time: "20:00:00Z",
          Circuit: { circuitName: "Autódromo Hermanos Rodríguez", Location: { locality: "Mexico City" } },
          FirstPractice: { date: "2026-10-30", time: "18:30:00Z" },
          SecondPractice: { date: "2026-10-30", time: "22:00:00Z" },
          ThirdPractice: { date: "2026-10-31", time: "17:30:00Z" },
          Qualifying: { date: "2026-10-31", time: "21:00:00Z" },
        },
      ],
    },
  },
};
const results = {
  MRData: {
    RaceTable: {
      Races: [
        {
          round: "20",
          raceName: "Mexico City Grand Prix",
          Results: [
            { position: "1", Driver: { code: "NOR", givenName: "Lando", familyName: "Norris" }, Constructor: { name: "McLaren" } },
            { position: "2", Driver: { code: "VER", givenName: "Max", familyName: "Verstappen" }, Constructor: { name: "Red Bull" } },
            { position: "3", Driver: { code: "LEC", givenName: "Charles", familyName: "Leclerc" }, Constructor: { name: "Ferrari" } },
          ],
        },
      ],
    },
  },
};
const standings = {
  MRData: {
    StandingsTable: {
      StandingsLists: [
        {
          DriverStandings: [
            { points: "350", Driver: { givenName: "Lando", familyName: "Norris" } },
            { points: "330", Driver: { givenName: "Oscar", familyName: "Piastri" } },
          ],
        },
      ],
    },
  },
};

describe("F1", () => {
  it("parses the schedule into ordered sessions", () => {
    const cal = f1.parseSchedule(schedule);
    expect(cal[0].sessions.map((s) => s.name)).toEqual(["Practice 1", "Practice 2", "Practice 3", "Qualifying", "Race"]);
    const n = f1.nextSession(cal, new Date("2026-10-31T12:00:00Z"));
    expect(n?.session.name).toBe("Practice 3");
  });

  it("parses results and the championship lead", () => {
    const last = f1.parseResults(results, standings)!;
    expect(last.top10[0].name).toBe("Lando Norris");
    expect(last.leader).toMatchObject({ name: "Lando Norris", gap: 20 });
  });

  it("sends schedule, pre-session and result notifications once each", async () => {
    const env = makeEnv();
    const routes = {
      "/current.json": schedule,
      "/current/last/results.json": results,
      "/current/driverStandings.json": standings,
    };
    const { sent } = mockFetch(routes);
    const tick = (iso: string) => f1.tick(env, london(new Date(iso)), new Date(iso));

    await tick("2026-10-30T08:05:00Z"); // Fri 08:05 UK (GMT after the clocks go back): too early
    await tick("2026-10-30T09:05:00Z"); // Fri 09:05 UK: weekend schedule
    await tick("2026-10-30T09:15:00Z");
    await tick("2026-10-31T20:30:00Z"); // 30 min before qualifying
    await tick("2026-10-31T20:40:00Z");
    await tick("2026-11-01T22:30:00Z"); // 2.5h after race start
    await tick("2026-11-01T23:00:00Z");

    const titles = sent.map((s) => s.title);
    expect(titles).toEqual([
      "F1 this weekend: Mexico City Grand Prix",
      "Qualifying in 30 min",
      "Mexico City Grand Prix: Lando Norris wins",
    ]);
    expect(sent[0].body).toContain("Qualifying: Sat 21:00");
  });
});

// ---------------------------------------------------------------- watch
const discover = (type: "movie" | "tv") => ({
  results: [1, 2, 3, 4].map((i) => ({
    id: i,
    [type === "movie" ? "title" : "name"]: `${type} ${i}`,
    [type === "movie" ? "release_date" : "first_air_date"]: "2024-05-01",
    overview: "x",
    vote_average: 7.5,
    poster_path: `/p${i}.jpg`,
  })),
});

describe("What to Watch", () => {
  it("picks a film and a series, and replaces a title marked seen", async () => {
    const env = makeEnv({ TMDB_KEY: "k" });
    const { fn } = mockFetch({ "/discover/movie": discover("movie"), "/discover/tv": discover("tv") });
    const p = await watch.makePick(env, "2026-10-21");
    expect(p.movie && p.tv).toBeTruthy();
    expect(String(fn.mock.calls[0][0])).toContain("watch_region=GB");
    const p2 = await watch.feedback(env, "movie", p.movie!.id, "2026-10-21");
    expect(p2.movie!.id).not.toBe(p.movie!.id);
  });
});

// ---------------------------------------------------------------- weather
describe("weather", () => {
  it("parses Open-Meteo", () => {
    const w = weather.parseOpenMeteo({
      current: { temperature_2m: 12.6, weather_code: 61, wind_speed_10m: 14.2 },
      daily: {
        temperature_2m_max: [14.1, 15.9],
        temperature_2m_min: [7.4, 8.8],
        precipitation_probability_max: [80, 20],
        weather_code: [61, 2],
      },
    });
    expect(w.now).toMatchObject({ temp: 13, text: "Rain", wind: 14 });
    expect(w.tomorrow).toMatchObject({ max: 16, text: "Partly cloudy" });
  });
});

// ---------------------------------------------------------------- routes
describe("HTTP routes", () => {
  const ctx = { waitUntil() {}, passThroughOnException() {} } as any;

  it("protects the dashboard and API with the token", async () => {
    const env = makeEnv();
    expect((await worker.fetch(new Request("https://h/d/wrong"), env, ctx)).status).toBe(404);
    expect((await worker.fetch(new Request(`https://h/d/${env.DASHBOARD_TOKEN}`), env, ctx)).status).toBe(200);
    expect((await worker.fetch(new Request("https://h/api/state?token=nope"), env, ctx)).status).toBe(401);
    const s = await worker.fetch(new Request(`https://h/api/state?token=${env.DASHBOARD_TOKEN}`), env, ctx);
    expect(s.status).toBe(200);
  });

  it("logs a crossing from the Shortcut and shows it on the dashboard", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-21T11:00:00Z"));
    const env = makeEnv();
    const r = await worker.fetch(new Request(`https://h/crossed?token=${env.SHORTCUT_TOKEN}`, { method: "POST" }), env, ctx);
    expect(r.status).toBe(200);
    const s: any = await (await worker.fetch(new Request(`https://h/api/state?token=${env.DASHBOARD_TOKEN}`), env, ctx)).json();
    expect(s.dart.count).toBe(1);
    await worker.fetch(new Request(`https://h/paid?token=${env.SHORTCUT_TOKEN}`, { method: "POST" }), env, ctx);
    const s2: any = await (await worker.fetch(new Request(`https://h/api/state?token=${env.DASHBOARD_TOKEN}`), env, ctx)).json();
    expect(s2.dart.count).toBe(0);
    vi.useRealTimers();
  });

  it("keeps running other modules when one fails", async () => {
    const env = makeEnv({ BIN_ICS_URL: "https://broken.example/x.ics", TMDB_KEY: "k" });
    mockFetch({ "open-meteo": { current: { temperature_2m: 1, weather_code: 0, wind_speed_10m: 1 }, daily: { temperature_2m_max: [1, 1], temperature_2m_min: [1, 1], precipitation_probability_max: [0, 0], weather_code: [0, 0] } } });
    const r: any = await (await worker.fetch(new Request(`https://h/api/run?token=${env.DASHBOARD_TOKEN}`), env, ctx)).json();
    expect(r.weather).toBe("ok");
    expect(r.bins).toMatch(/^error/);
  });
});
