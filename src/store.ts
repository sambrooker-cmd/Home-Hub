// Small wrapper over Cloudflare KV. The free tier allows 1,000 writes a day,
// so the hub only writes when something has actually changed.

import type { Env } from "./env";

export async function getJSON<T>(env: Env, key: string): Promise<T | null> {
  return (await env.HUB.get(key, "json")) as T | null;
}

export async function putJSON(env: Env, key: string, value: unknown, ttlSeconds?: number): Promise<void> {
  const body = JSON.stringify(value);
  const existing = await env.HUB.get(key);
  if (existing === body) return; // nothing changed: save a write
  await env.HUB.put(key, body, ttlSeconds ? { expirationTtl: Math.max(60, ttlSeconds) } : undefined);
}
