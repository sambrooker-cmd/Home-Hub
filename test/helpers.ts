// Test helpers: an in-memory stand-in for Cloudflare KV, and a fake fetch that
// records ntfy notifications and serves canned API responses.

import { vi } from "vitest";
import type { Env } from "../src/env";

export function fakeKV() {
  const m = new Map<string, string>();
  return {
    map: m,
    async get(k: string, type?: string) {
      const v = m.get(k);
      if (v === undefined) return null;
      return type === "json" ? JSON.parse(v) : v;
    },
    async put(k: string, v: string) {
      m.set(k, v);
    },
    async delete(k: string) {
      m.delete(k);
    },
  } as unknown as KVNamespace & { map: Map<string, string> };
}

export function makeEnv(over: Partial<Env> = {}): Env & { HUB: ReturnType<typeof fakeKV> } {
  return {
    HUB: fakeKV(),
    DASHBOARD_TOKEN: "dash-token-1234567890",
    SHORTCUT_TOKEN: "short-token-1234567890",
    NTFY_TOPIC: "test-topic",
    HOME_LATLON: "51.45,0.25",
    WORK_LATLON: "51.48,0.23",
    ...over,
  } as any;
}

/**
 * Install a fake global fetch. `routes` maps a URL substring to a JSON or text body,
 * or to a function `(url, init) => Response | body` for status codes and request checks.
 */
export function mockFetch(routes: Record<string, unknown>) {
  const sent: { title: string; body: string; headers: Record<string, string> }[] = [];
  const fn = vi.fn(async (input: any, init?: any) => {
    const url = String(input);
    if (url.startsWith("https://ntfy.sh/")) {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      sent.push({ title: headers.Title, body: String(init?.body ?? ""), headers });
      return new Response("{}", { status: 200 });
    }
    for (const [frag, route] of Object.entries(routes)) {
      if (url.includes(frag)) {
        const body = typeof route === "function" ? await route(url, init) : route;
        if (body instanceof Response) return body;
        return typeof body === "string"
          ? new Response(body, { status: 200 })
          : new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
      }
    }
    return new Response("not mocked: " + url, { status: 404 });
  });
  vi.stubGlobal("fetch", fn);
  return { sent, fn };
}
