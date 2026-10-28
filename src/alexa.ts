// Alexa via Voice Monkey (https://voicemonkey.io), a free Alexa skill that lets
// the hub speak on chosen Echo devices and start Alexa Routines. The phone
// notification always goes out first; Alexa is an extra, so a failure here is
// logged and never stops a module.
// Docs: https://voicemonkey.io/docs/api

import { moduleOn, type Env } from "./env";
import { inWindow, type LondonTime } from "./time";

const API = "https://api-v3.voicemonkey.io";

function list(s: string | undefined): string[] {
  return (s ?? "").split(",").map((x) => x.trim()).filter(Boolean);
}

/** Quiet hours as "HH:MM-HH:MM" (default 21:00-07:00). Can wrap past midnight. */
export function isQuiet(env: Env, t: LondonTime): boolean {
  const [start, end] = (env.ALEXA_QUIET || "21:00-07:00").split("-").map((s) => s.trim());
  if (!start || !end || start === end) return false;
  return start < end ? inWindow(t, start, end) : inWindow(t, start, "24:00") || inWindow(t, "00:00", end);
}

function ready(env: Env): boolean {
  return moduleOn(env, "alexa") && !!env.VOICEMONKEY_TOKEN;
}

async function call(path: "announce" | "trigger", body: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${API}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Voice Monkey ${path} failed: ${res.status} ${await res.text()}`);
}

/** Speak on the ALEXA_SPEAKERS devices (e.g. kitchen and hallway), outside quiet hours. */
export async function say(env: Env, t: LondonTime, speech: string, opts: { ignoreQuiet?: boolean } = {}): Promise<boolean> {
  const speakers = list(env.ALEXA_SPEAKERS);
  if (!ready(env) || !speakers.length) return false;
  if (!opts.ignoreQuiet && isQuiet(env, t)) return false;
  try {
    await call("announce", { token: env.VOICEMONKEY_TOKEN, device: speakers.join(","), speech });
    return true;
  } catch (e) {
    console.error("[alexa]", e);
    return false;
  }
}

/** Start the Alexa Routine linked to a Voice Monkey Routine Trigger device, outside quiet hours. */
export async function trigger(env: Env, t: LondonTime, device: string | undefined): Promise<boolean> {
  if (!ready(env) || !device || isQuiet(env, t)) return false;
  try {
    await call("trigger", { token: env.VOICEMONKEY_TOKEN, device });
    return true;
  } catch (e) {
    console.error("[alexa]", e);
    return false;
  }
}
