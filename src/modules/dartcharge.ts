// Dart Charge reminder. There's no API for checking payments, so the iPhone
// tells the hub about each crossing (via a Shortcut), and the hub nags until
// it's marked paid. The charge must be paid by midnight the day after crossing.

import type { Env } from "../env";
import { getJSON, putJSON } from "../store";
import { notifyOnce } from "../notify";
import { addDays, dayLabel, london, type LondonTime } from "../time";

export const PAY_URL = "https://www.gov.uk/pay-dartford-crossing-charge";

export interface Crossing {
  at: string; // ISO time
  date: string; // UK date of the crossing
}

const KEY = "dart:unpaid";

export async function unpaid(env: Env): Promise<Crossing[]> {
  return (await getJSON<Crossing[]>(env, KEY)) ?? [];
}

export async function recordCrossing(env: Env, now = new Date()): Promise<Crossing[]> {
  const list = await unpaid(env);
  const t = london(now);
  // The charge applies 6am to 10pm, so crossings outside those hours are ignored.
  if (t.hour < 6 || t.hour >= 22) return list;
  // Ignore duplicate triggers within 20 minutes (e.g. two automations firing).
  const last = list[list.length - 1];
  if (last && now.getTime() - new Date(last.at).getTime() < 20 * 60 * 1000) return list;
  list.push({ at: now.toISOString(), date: t.date });
  await putJSON(env, KEY, list);
  return list;
}

export async function markPaid(env: Env): Promise<void> {
  await env.HUB.delete(KEY);
}

/** Earliest payment deadline among unpaid crossings: end of the day after the first one. */
export function dueDate(list: Crossing[]): string | null {
  if (!list.length) return null;
  const first = list.map((c) => c.date).sort()[0];
  return addDays(first, 1);
}

export interface DartView {
  count: number;
  dueLabel?: string; // "today" | "tomorrow" | "Thu 22 Oct"
  overdue?: boolean;
}

export function view(list: Crossing[], t: LondonTime): DartView {
  const due = dueDate(list);
  if (!due) return { count: 0 };
  const dueLabel = due === t.date ? "today" : due === addDays(t.date, 1) ? "tomorrow" : dayLabel(due);
  return { count: list.length, dueLabel, overdue: due < t.date };
}

export async function tick(env: Env, t: LondonTime, publicUrl: string): Promise<void> {
  const list = await unpaid(env);
  const due = dueDate(list);
  if (!due) return;
  // Reminder at 6pm on the due day (and again at 9pm if still unpaid).
  if (due === t.date && (t.hour === 18 || t.hour === 21)) {
    const paidUrl = `${publicUrl}/paid?token=${encodeURIComponent(env.SHORTCUT_TOKEN)}`;
    await notifyOnce(
      env,
      `dart:${due}:${t.hour}`,
      {
        title: "Dart Charge due by midnight",
        message: `${list.length} crossing${list.length > 1 ? "s" : ""} to pay. Tap Pay now, then Mark paid.`,
        tags: ["bridge_at_night", "money_with_wings"],
        priority: 4,
        click: PAY_URL,
        actions: [
          { label: "Pay now", url: PAY_URL, method: "view" },
          { label: "Mark paid", url: paidUrl, method: "POST" },
        ],
      },
      2,
    );
  }
}
