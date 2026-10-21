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
}

export function moduleOn(env: Env, name: string): boolean {
  const list = (env.MODULES ?? "bins,commute,dartcharge,f1,watch,weather")
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
