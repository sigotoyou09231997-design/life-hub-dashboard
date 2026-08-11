export interface Holiday {
  date: string; // YYYY-MM-DD
  name: string;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function toDateStr(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

function parseYmd(s: string): [number, number, number] {
  const [y, m, d] = s.split("-").map(Number);
  return [y, m, d];
}

// Date math below stays in UTC for both construction and reading, so results don't
// depend on the browser's local timezone (a plain `new Date("YYYY-MM-DD")` parses as
// UTC midnight but `.getDay()` reads it back in local time, which can shift the
// weekday near midnight in timezones behind UTC).
function utcDate(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d));
}

function addUtcDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86400000);
}

function fromUtcDate(date: Date): string {
  return toDateStr(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function nthMondayOfMonth(year: number, month: number, nth: number): number {
  const firstWeekday = utcDate(year, month, 1).getUTCDay(); // 0=Sun..6=Sat
  const daysUntilFirstMonday = (8 - firstWeekday) % 7;
  return 1 + daysUntilFirstMonday + (nth - 1) * 7;
}

// Standard empirical approximation for the equinox dates, valid for 1980-2099.
function vernalEquinoxDay(year: number): number {
  return Math.floor(20.8431 + 0.242194 * (year - 1980)) - Math.floor((year - 1980) / 4);
}

function autumnalEquinoxDay(year: number): number {
  return Math.floor(23.2488 + 0.242194 * (year - 1980)) - Math.floor((year - 1980) / 4);
}

/**
 * Japanese national holidays for a given year, including 振替休日 (substitute holiday —
 * a holiday landing on Sunday pushes to the next non-holiday day) and 国民の休日
 * (citizen's holiday — a lone weekday sitting between two other holidays). Reflects
 * current law (post-2020 天皇誕生日/スポーツの日); equinox dates are computed, not looked up.
 */
export function getJapaneseHolidays(year: number): Holiday[] {
  const base: Holiday[] = [
    { date: toDateStr(year, 1, 1), name: "元日" },
    { date: toDateStr(year, 1, nthMondayOfMonth(year, 1, 2)), name: "成人の日" },
    { date: toDateStr(year, 2, 11), name: "建国記念の日" },
    { date: toDateStr(year, 2, 23), name: "天皇誕生日" },
    { date: toDateStr(year, 3, vernalEquinoxDay(year)), name: "春分の日" },
    { date: toDateStr(year, 4, 29), name: "昭和の日" },
    { date: toDateStr(year, 5, 3), name: "憲法記念日" },
    { date: toDateStr(year, 5, 4), name: "みどりの日" },
    { date: toDateStr(year, 5, 5), name: "こどもの日" },
    { date: toDateStr(year, 7, nthMondayOfMonth(year, 7, 3)), name: "海の日" },
    { date: toDateStr(year, 8, 11), name: "山の日" },
    { date: toDateStr(year, 9, nthMondayOfMonth(year, 9, 3)), name: "敬老の日" },
    { date: toDateStr(year, 9, autumnalEquinoxDay(year)), name: "秋分の日" },
    { date: toDateStr(year, 10, nthMondayOfMonth(year, 10, 2)), name: "スポーツの日" },
    { date: toDateStr(year, 11, 3), name: "文化の日" },
    { date: toDateStr(year, 11, 23), name: "勤労感謝の日" },
  ];

  const byDate = new Map(base.map((h) => [h.date, h.name]));
  const sorted = [...base].sort((a, b) => a.date.localeCompare(b.date));

  for (let i = 0; i < sorted.length - 1; i++) {
    const cur = utcDate(...parseYmd(sorted[i].date));
    const next = utcDate(...parseYmd(sorted[i + 1].date));
    const gapDays = Math.round((next.getTime() - cur.getTime()) / 86400000);
    if (gapDays === 2) {
      const between = addUtcDays(cur, 1);
      const key = fromUtcDate(between);
      if (!byDate.has(key) && between.getUTCDay() !== 0) {
        byDate.set(key, "国民の休日");
      }
    }
  }

  for (const [dstr] of [...byDate.entries()]) {
    const holidayDate = utcDate(...parseYmd(dstr));
    if (holidayDate.getUTCDay() === 0) {
      let sub = addUtcDays(holidayDate, 1);
      while (byDate.has(fromUtcDate(sub))) {
        sub = addUtcDays(sub, 1);
      }
      byDate.set(fromUtcDate(sub), "振替休日");
    }
  }

  return [...byDate.entries()]
    .map(([date, name]) => ({ date, name }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

const yearCache = new Map<number, Map<string, string>>();

/** Date (YYYY-MM-DD) -> holiday name for the given year. Cached per year. */
export function getHolidayMapForYear(year: number): Map<string, string> {
  let map = yearCache.get(year);
  if (!map) {
    map = new Map(getJapaneseHolidays(year).map((h) => [h.date, h.name]));
    yearCache.set(year, map);
  }
  return map;
}

/** Convenience for a month grid that may span two years (Dec/Jan boundary). */
export function getHolidayMapForYears(years: number[]): Map<string, string> {
  const merged = new Map<string, string>();
  for (const year of new Set(years)) {
    for (const [date, name] of getHolidayMapForYear(year)) merged.set(date, name);
  }
  return merged;
}
