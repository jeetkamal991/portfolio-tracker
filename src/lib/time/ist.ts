const fmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  weekday: "short",
});

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function istNowParts(now: Date): { date: string; weekday: number; minutes: number } {
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(now)) p[part.type] = part.value;
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    weekday: WEEKDAYS.indexOf(p.weekday),
    minutes: Number(p.hour) * 60 + Number(p.minute),
  };
}

export function istDate(d: Date): string {
  return istNowParts(d).date;
}

/** Mon-Fri, 09:15 <= IST time <= 15:30 (minute resolution). */
export function isMarketOpen(now: Date): boolean {
  const { weekday, minutes } = istNowParts(now);
  return weekday >= 1 && weekday <= 5 && minutes >= 9 * 60 + 15 && minutes <= 15 * 60 + 30;
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d, 12));
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
