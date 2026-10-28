// Phone notifications via ntfy (https://ntfy.sh). Install the free "ntfy" app
// on the iPhone and subscribe to the same topic name stored in NTFY_TOPIC.

import type { Env } from "./env";

export interface Note {
  title: string;
  message: string;
  tags?: string[]; // ntfy turns some tags into emoji, e.g. "wastebasket", "car", "tv"
  priority?: 1 | 2 | 3 | 4 | 5;
  click?: string; // URL opened when the notification is tapped
  actions?: { label: string; url: string; method?: "GET" | "POST" | "view" }[];
}

// HTTP headers must be plain ASCII, so strip anything else from header values.
const ascii = (s: string) => s.replace(/[^\x20-\x7E]/g, "").trim();

export async function notify(env: Env, n: Note): Promise<void> {
  const server = (env.NTFY_SERVER || "https://ntfy.sh").replace(/\/$/, "");
  const headers: Record<string, string> = { Title: ascii(n.title) };
  if (n.tags?.length) headers.Tags = n.tags.join(",");
  if (n.priority) headers.Priority = String(n.priority);
  if (n.click) headers.Click = n.click;
  if (n.actions?.length) {
    headers.Actions = n.actions
      .map((a) =>
        a.method === "view" || !a.method
          ? `view, ${ascii(a.label)}, ${a.url}`
          : `http, ${ascii(a.label)}, ${a.url}, method=${a.method}, clear=true`,
      )
      .join("; ");
  }
  const res = await fetch(`${server}/${encodeURIComponent(env.NTFY_TOPIC)}`, {
    method: "POST",
    headers,
    body: n.message,
  });
  if (!res.ok) throw new Error(`ntfy failed: ${res.status} ${await res.text()}`);
}

/**
 * Send a notification only once per key (e.g. "bins:2026-10-27").
 * The key is remembered for `ttlDays`, so repeated cron runs don't spam the phone.
 */
export async function notifyOnce(env: Env, key: string, n: Note, ttlDays = 3): Promise<boolean> {
  const k = `sent:${key}`;
  if (await env.HUB.get(k)) return false;
  await notify(env, n);
  await env.HUB.put(k, "1", { expirationTtl: ttlDays * 86400 });
  return true;
}

/** True the first time it is called for a key within `ttlDays` (for things that aren't notifications). */
export async function firstTime(env: Env, key: string, ttlDays = 3): Promise<boolean> {
  const k = `once:${key}`;
  if (await env.HUB.get(k)) return false;
  await env.HUB.put(k, "1", { expirationTtl: ttlDays * 86400 });
  return true;
}
