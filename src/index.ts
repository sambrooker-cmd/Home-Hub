// Home Hub: one Cloudflare Worker that runs every 10 minutes to check things
// and send notifications, and serves the wall dashboard and its data.
//
// Routes
//   GET  /d/<DASHBOARD_TOKEN>                  wall dashboard page
//   GET  /api/state?token=<DASHBOARD_TOKEN>    dashboard data (JSON)
//   POST /api/watch/feedback?token=..&type=movie|tv&id=123   "seen it"/"not for me"
//   GET  /api/test?token=<DASHBOARD_TOKEN>     sends a test notification
//   GET  /api/run?token=<DASHBOARD_TOKEN>      runs every check now, incl. the weekly/daily reads (for testing)
//   GET  /api/providers?token=<DASHBOARD_TOKEN> lists UK streaming services and their TMDB ids
//   GET  /api/alexa-test?token=<DASHBOARD_TOKEN> says a test message on the Alexa speakers
//   GET  /api/vehicles?token=<DASHBOARD_TOKEN>  stored MOT/tax details, incl. average miles a year
//   GET|POST /crossed?token=<SHORTCUT_TOKEN>   iPhone Shortcut: "I crossed the Dartford Crossing"
//   GET|POST /paid?token=<SHORTCUT_TOKEN>      mark Dart Charge crossings paid
//   GET  /health                               simple "ok"

import { moduleOn, type Env } from "./env";
import { london, inWindow, type LondonTime } from "./time";
import { notify } from "./notify";
import { dashboardHtml } from "./dashboard";
import * as bins from "./modules/bins";
import * as commute from "./modules/commute";
import * as dart from "./modules/dartcharge";
import * as f1 from "./modules/f1";
import * as watch from "./modules/watch";
import * as weather from "./modules/weather";
import * as vehicles from "./modules/vehicles";
import * as energy from "./modules/energy";
import * as alexa from "./alexa";

function publicUrl(env: Env, req?: Request): string {
  if (env.PUBLIC_URL) return env.PUBLIC_URL.replace(/\/$/, "");
  return req ? new URL(req.url).origin : "";
}

/** Constant-time-ish token comparison. */
function tokenOk(given: string | null, expected: string | undefined): boolean {
  if (!given || !expected || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const page = (title: string, body: string) =>
  new Response(
    `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>` +
      `<body style="font:20px system-ui,sans-serif;background:#0c0e11;color:#f1ede4;padding:2em">${body}</body>`,
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );

/** Run every switched-on module. Each one is isolated so one failure can't stop the others. */
async function runAll(env: Env, now: Date, url: string, force = false): Promise<Record<string, string>> {
  const t = london(now);
  const jobs: [string, () => Promise<void>][] = [
    ["weather", () => weather.tick(env, t)],
    ["bins", () => bins.tick(env, t)],
    ["commute", () => commute.tick(env, t)],
    ["dartcharge", () => dart.tick(env, t, url)],
    ["f1", () => f1.tick(env, t, now)],
    ["watch", () => watch.tick(env, t)],
    // Slow modules: weekly / daily on their own schedule; /api/run forces a read now.
    ["vehicles", () => vehicles.tick(env, t, now, force)],
    ["energy", () => energy.tick(env, t, now, force)],
  ];
  const report: Record<string, string> = {};
  for (const [name, job] of jobs) {
    if (!moduleOn(env, name)) {
      report[name] = "off";
      continue;
    }
    try {
      await job();
      report[name] = "ok";
    } catch (e) {
      report[name] = `error: ${(e as Error).message}`;
      console.error(`[${name}]`, e);
    }
  }
  return report;
}

/** The commute tile only appears around commute times, while the data is fresh. */
function commuteVisible(c: commute.CommuteState | null, t: LondonTime, now: Date): boolean {
  if (!c) return false;
  const fresh = now.getTime() - new Date(c.checkedAt).getTime() < 30 * 60 * 1000;
  const weekday = t.weekday >= 1 && t.weekday <= 5;
  return fresh && weekday && (inWindow(t, "06:15", "09:00") || inWindow(t, "16:15", "19:00"));
}

async function state(env: Env, now: Date) {
  const t = london(now);
  const [w, b, c, d, f, wp, v, e] = await Promise.all([
    moduleOn(env, "weather") ? weather.getView(env) : null,
    moduleOn(env, "bins") ? bins.getView(env, t) : null,
    moduleOn(env, "commute") ? commute.getView(env) : null,
    moduleOn(env, "dartcharge") ? dart.unpaid(env).then((l) => dart.view(l, t)) : null,
    moduleOn(env, "f1") ? f1.getView(env, now) : null,
    moduleOn(env, "watch") ? watch.getView(env) : null,
    moduleOn(env, "vehicles") ? vehicles.getView(env, t) : null,
    moduleOn(env, "energy") ? energy.getView(env, t) : null,
  ]);
  return {
    now: now.toISOString(),
    weather: w,
    bins: b,
    commute: commuteVisible(c, t, now) ? c : null,
    dart: d,
    f1: f,
    watch: wp,
    vehicles: v && v.length ? v : null,
    energy: e,
  };
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const token = url.searchParams.get("token");
    const now = new Date();

    if (path === "/health") return new Response("ok");

    // --- Dashboard ---
    if (path.startsWith("/d/")) {
      const given = decodeURIComponent(path.slice(3));
      if (!tokenOk(given, env.DASHBOARD_TOKEN)) return new Response("Not found", { status: 404 });
      return new Response(dashboardHtml(given), {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
      });
    }

    if (path.startsWith("/api/")) {
      if (!tokenOk(token, env.DASHBOARD_TOKEN)) return json({ error: "unauthorised" }, 401);

      if (path === "/api/state") return json(await state(env, now));

      if (path === "/api/watch/feedback" && req.method === "POST") {
        const type = url.searchParams.get("type") === "tv" ? "tv" : "movie";
        const id = Number(url.searchParams.get("id"));
        if (!id) return json({ error: "missing id" }, 400);
        return json(await watch.feedback(env, type, id, london(now).date));
      }

      if (path === "/api/test") {
        await notify(env, {
          title: "Home Hub is connected",
          message: "Test notification. If you can read this, notifications work.",
          tags: ["white_check_mark"],
        });
        return json({ sent: true });
      }

      if (path === "/api/run") return json(await runAll(env, now, publicUrl(env, req), true));

      // Says a test message on the Alexa speakers (ignores quiet hours).
      if (path === "/api/alexa-test") {
        const spoke = await alexa.say(env, london(now), "Home Hub is connected to Alexa.", { ignoreQuiet: true });
        return json({ spoke, hint: spoke ? undefined : "Check MODULES includes alexa, VOICEMONKEY_TOKEN and ALEXA_SPEAKERS" });
      }

      // Everything stored about the vehicles, including average miles a year.
      if (path === "/api/vehicles") return json(await vehicles.details(env));

      // Lists UK streaming services and their TMDB ids, for setting WATCH_PROVIDERS.
      if (path === "/api/providers") return json(await watch.ukProviders(env));

      return json({ error: "not found" }, 404);
    }

    // --- iPhone Shortcuts (Dart Charge) ---
    if (path === "/crossed" || path === "/paid") {
      if (!tokenOk(token, env.SHORTCUT_TOKEN)) return new Response("Not found", { status: 404 });
      if (path === "/crossed") {
        const list = await dart.recordCrossing(env, now);
        return page("Crossing logged", `Crossing logged. ${list.length} unpaid.`);
      }
      await dart.markPaid(env);
      return page("Paid", "Dart Charge marked as paid.");
    }

    return new Response("Not found", { status: 404 });
  },

  // Cron Trigger: runs every 10 minutes (see wrangler.toml).
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runAll(env, new Date(event.scheduledTime), publicUrl(env)).then(() => undefined));
  },
};
