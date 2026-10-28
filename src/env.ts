// Everything the hub needs from Cloudflare: the storage binding plus settings.
// Secrets (keys, tokens, URLs) are set with `npx wrangler secret put NAME`.
// Non-secret settings live in wrangler.toml under [vars].

export interface Env {
  HUB: KVNamespace;

  // --- Access tokens (secrets) ---
  DASHBOARD_TOKEN: string; // long random string; the dashboard URL is /d/<token>
  SHORTCUT_TOKEN: string; // long random string used by the iPhone Shortcuts

  // --- Notifications (ntfy) ---
  NTFY_TOPIC: string; // secret: a long, unguessable topic name
  NTFY_SERVER?: string; // default https://ntfy.sh

  // --- Which modules are switched on (comma list) ---
  MODULES?: string; // e.g. "bins,commute,dartcharge,f1,watch,weather"

  // --- Bins ---
  BIN_ICS_URL?: string;

  // --- Locations (secrets, "lat,lon") ---
  HOME_LATLON?: string;
  WORK_LATLON?: string;

  // --- Commute ---
  TOMTOM_KEY?: string;
  COMMUTE_ALERT_MINUTES?: string; // default 10

  // --- What to Watch ---
  TMDB_KEY?: string; // TMDB v3 API key
  WATCH_PROVIDERS?: string; // TMDB provider ids, e.g. "8|9|350"
  WATCH_GENRES?: string; // TMDB genre ids, e.g. "28|53|878"

  // --- Public base URL of this worker, used in notification links ---
  PUBLIC_URL?: string; // e.g. https://home-hub.yourname.workers.dev

  // --- Alexa via Voice Monkey ---
  VOICEMONKEY_TOKEN?: string; // secret
  ALEXA_SPEAKERS?: string; // Voice Monkey speaker device ids, comma list, e.g. "kitchen,hallway"
  ALEXA_QUIET?: string; // "21:00-07:00": nothing spoken or switched on in these hours
  ALEXA_TRIGGER_BINS?: string; // Routine Trigger device id: bin-night lamp
  ALEXA_TRIGGER_RACE?: string; // Routine Trigger device id: TV on before the race

  // --- Vehicles (MOT and tax) ---
  VEHICLES?: string; // secret: "car:AB12CDE,bike:XY70ZZZ" (label:reg)
  DVLA_VES_KEY?: string; // secret: DVLA Vehicle Enquiry Service key
  DVSA_API_KEY?: string; // secrets: DVSA MOT History API
  DVSA_CLIENT_ID?: string;
  DVSA_CLIENT_SECRET?: string;
  DVSA_TOKEN_URL?: string; // from the DVSA credentials email
  DVSA_SCOPE?: string; // default https://tapi.dvsa.gov.uk/.default

  // --- Energy (smart meter via Glowmarkt / Bright app) ---
  GLOW_USERNAME?: string; // secrets: Bright app login
  GLOW_PASSWORD?: string;
  GLOW_APP_ID?: string; // optional: Glowmarkt application id (the Bright app's one by default)
  ELEC_UNIT_P?: string; // optional secrets, pence: used if the meter's cost data is empty
  ELEC_STANDING_P?: string;
  GAS_UNIT_P?: string;
  GAS_STANDING_P?: string;
}

export function moduleOn(env: Env, name: string): boolean {
  const list = (env.MODULES ?? "bins,commute,dartcharge,f1,watch,weather,vehicles,energy")
    .split(",")
    .map((s) => s.trim().toLowerCase());
  return list.includes(name);
}

export function parseLatLon(s: string | undefined): { lat: number; lon: number } | null {
  if (!s) return null;
  const [a, b] = s.split(",").map((x) => Number(x.trim()));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return { lat: a, lon: b };
}
