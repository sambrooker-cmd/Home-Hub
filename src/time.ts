// UK time helpers. Everything the hub decides ("is it 7pm?", "is tomorrow bin day?")
// is done in Europe/London time, so the clock changes are handled automatically.

export interface LondonTime {
  date: string; // YYYY-MM-DD
  hour: number;
  minute: number;
  weekday: number; // 0 = Sunday ... 6 = Saturday
  minutesOfDay: number;
}

const fmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  weekday: "short",
  hourCycle: "h23",
});

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function london(d: Date): LondonTime {
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(d)) parts[p.type] = p.value;
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour,
    minute,
    weekday: WEEKDAYS[parts.weekday],
    minutesOfDay: hour * 60 + minute,
  };
}

/** Add whole days to a YYYY-MM-DD date string. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** "Tue 27 Oct" style label for a YYYY-MM-DD date. */
export function dayLabel(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

/** "Sat 15:00" style label in UK time for an instant. */
export function ukDayTime(d: Date): string {
  return d.toLocaleString("en-GB", {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Europe/London",
  });
}

/** True when minutesOfDay is inside [start, end) given as "HH:MM". */
export function inWindow(t: LondonTime, start: string, end: string): boolean {
  const toMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  return t.minutesOfDay >= toMin(start) && t.minutesOfDay < toMin(end);
}

/** The instant UK midnight starts a YYYY-MM-DD date (handles BST/GMT). */
export function ukMidnight(date: string): Date {
  for (const offsetHours of [0, 1]) {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCHours(d.getUTCHours() - offsetHours);
    const t = london(d);
    if (t.date === date && t.hour === 0 && t.minute === 0) return d;
  }
  return new Date(`${date}T00:00:00Z`);
}
