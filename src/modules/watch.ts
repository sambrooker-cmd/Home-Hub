// What to Watch: picks one film and one series each evening that are on the
// streaming services you have in the UK, skipping anything marked seen or
// "not interested". Data from TMDB (free key). TMDB attribution is required
// and shown on the dashboard.
// Docs: https://developer.themoviedb.org/reference/discover-movie

import type { Env } from "../env";
import { getJSON, putJSON } from "../store";
import { notifyOnce } from "../notify";
import type { LondonTime } from "../time";

const API = "https://api.themoviedb.org/3";
const IMG = "https://image.tmdb.org/t/p/w342";
const PICK_KEY = "watch:pick";
const SKIP_KEY = "watch:skip";

export interface Title {
  id: number;
  type: "movie" | "tv";
  title: string;
  year: string;
  overview: string;
  rating: number;
  poster: string | null;
}

export interface Pick {
  date: string;
  movie: Title | null;
  tv: Title | null;
}

export function toTitle(r: any, type: "movie" | "tv"): Title {
  const date: string = (type === "movie" ? r.release_date : r.first_air_date) || "";
  return {
    id: r.id,
    type,
    title: type === "movie" ? r.title : r.name,
    year: date.slice(0, 4),
    overview: (r.overview || "").slice(0, 240),
    rating: Math.round((r.vote_average || 0) * 10) / 10,
    poster: r.poster_path ? `${IMG}${r.poster_path}` : null,
  };
}

/** Choose a title deterministically for the day, skipping excluded ids. */
export function choose(results: any[], type: "movie" | "tv", skip: Set<string>, seed: number): Title | null {
  const ok = results.filter((r) => !skip.has(`${type}:${r.id}`) && r.poster_path);
  if (!ok.length) return null;
  return toTitle(ok[seed % ok.length], type);
}

async function discover(env: Env, type: "movie" | "tv", page: number): Promise<any[]> {
  const p = new URLSearchParams({
    api_key: env.TMDB_KEY!,
    watch_region: "GB",
    with_watch_monetization_types: "flatrate",
    with_watch_providers: env.WATCH_PROVIDERS || "8|9",
    sort_by: "popularity.desc",
    "vote_average.gte": "6.8",
    "vote_count.gte": type === "movie" ? "300" : "150",
    include_adult: "false",
    language: "en-GB",
    page: String(page),
  });
  if (env.WATCH_GENRES) p.set("with_genres", env.WATCH_GENRES);
  const res = await fetch(`${API}/discover/${type}?${p}`);
  if (!res.ok) throw new Error(`TMDB ${res.status}`);
  return ((await res.json()) as any).results ?? [];
}

function daySeed(date: string): number {
  return Number(date.replace(/-/g, "")) % 997;
}

export async function makePick(env: Env, date: string): Promise<Pick> {
  const skip = new Set((await getJSON<string[]>(env, SKIP_KEY)) ?? []);
  const seed = daySeed(date);
  const page = (seed % 5) + 1; // vary across the top ~100 titles
  const [movies, shows] = await Promise.all([discover(env, "movie", page), discover(env, "tv", page)]);
  const pick: Pick = {
    date,
    movie: choose(movies, "movie", skip, seed),
    tv: choose(shows, "tv", skip, seed),
  };
  await putJSON(env, PICK_KEY, pick);
  return pick;
}

/** Mark a title as seen / not interested, then pick a replacement for tonight. */
export async function feedback(env: Env, type: "movie" | "tv", id: number, date: string): Promise<Pick> {
  const skip = (await getJSON<string[]>(env, SKIP_KEY)) ?? [];
  const key = `${type}:${id}`;
  if (!skip.includes(key)) skip.push(key);
  await putJSON(env, SKIP_KEY, skip.slice(-2000));
  return makePick(env, date);
}

/** UK streaming services TMDB knows about, with the ids WATCH_PROVIDERS needs. */
export async function ukProviders(env: Env): Promise<{ id: number; name: string }[]> {
  if (!env.TMDB_KEY) return [];
  const res = await fetch(`${API}/watch/providers/movie?watch_region=GB&api_key=${encodeURIComponent(env.TMDB_KEY)}`);
  if (!res.ok) throw new Error(`TMDB ${res.status}`);
  const list: any[] = ((await res.json()) as any).results ?? [];
  return list
    .sort((a, b) => (a.display_priorities?.GB ?? 999) - (b.display_priorities?.GB ?? 999))
    .map((p) => ({ id: p.provider_id, name: p.provider_name }));
}

export async function getView(env: Env): Promise<Pick | null> {
  return getJSON<Pick>(env, PICK_KEY);
}

export async function tick(env: Env, t: LondonTime): Promise<void> {
  if (!env.TMDB_KEY) return;
  const current = await getJSON<Pick>(env, PICK_KEY);
  // New picks each day from 5pm (or straight away if there are none yet).
  if (!current || (current.date !== t.date && t.hour >= 17)) await makePick(env, t.date);

  if (t.hour === 19 && t.minute >= 30) {
    const p = await getJSON<Pick>(env, PICK_KEY);
    if (p && p.date === t.date && (p.movie || p.tv)) {
      const lines = [
        p.movie ? `Film: ${p.movie.title} (${p.movie.year}), ${p.movie.rating}/10` : "",
        p.tv ? `Series: ${p.tv.title} (${p.tv.year}), ${p.tv.rating}/10` : "",
      ].filter(Boolean);
      await notifyOnce(env, `watch:${t.date}`, {
        title: "Tonight's watch",
        message: lines.join("\n"),
        tags: ["tv"],
      }, 1);
    }
  }
}
