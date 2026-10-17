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

/** IST time after which the day's EOD data is expected to be stored (cron at 16:30 IST, Hobby jitter up to an hour). */
export const EOD_EXPECTED_MINUTES = 17 * 60 + 30;

/**
 * The most recent Mon–Fri IST date whose 17:30 IST has passed: the newest session the
 * dashboard expects to have. NSE holidays are not modelled.
 */
export function latestExpectedSession(now: Date): string {
  const { date, weekday, minutes } = istNowParts(now);
  let d = date;
  let wd = weekday;
  if (!(wd >= 1 && wd <= 5 && minutes >= EOD_EXPECTED_MINUTES)) {
    do {
      d = addDays(d, -1);
      wd = (wd + 6) % 7;
    } while (wd === 0 || wd === 6);
  }
  return d;
}
