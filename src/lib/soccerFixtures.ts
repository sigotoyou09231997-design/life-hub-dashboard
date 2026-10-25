import { db } from "../db/schema";
import type { CalendarEvent } from "../types";
import { scopedKey } from "./accounts";
import { stableUuid } from "./googleCalendar";
import { SOCCER_TITLE_PREFIX, soccerCrestUrl } from "./soccerMatch";
import { competitionNameJa, teamNameJa } from "./soccerTeamNames";

export { SOCCER_TITLE_PREFIX, soccerCrestUrl };

/**
 * 海外サッカーの試合日程を、自分が選んだチームの分だけ予定に入れる(2026-10-25、本人「海外サッカーを追加して、
 * ネットからスケジュールを取得して入れたい。全部じゃなくて自分が見たいチームの」「日本時間で」)。
 *
 * - データ元は ESPN の公開API(キー不要)。ブラウザから直接は読めない(CORS)ので、api/soccer.ts が代わりに取る。
 *   公式の窓口ではないので、形が変わったら ここ と api/soccer.ts だけ直す。読めなかった時は何も消さずに、次の機会にやり直す。
 * - 入れるのは、リーグ戦と UEFA の大会(CL/EL/カンファレンス)。国内カップ・スーパーカップ・親善試合は入れない。
 * - 時刻は日本時間。端末の時差設定に関わらず Asia/Tokyo で日付と時刻を作る。
 * - 予定のidは ESPN の試合idから毎回同じ値を作る(stableUuid)。選んだ2チームが当たる試合が1件になり、
 *   PCとスマホの両方で取り込んでも calendar_events の同期で同じ行に重なる。
 * - 取り込んだ予定は、メモの `ESPN#<試合id>` で見分ける。今日以降の分だけを入れ直し、過ぎた試合には触らない。
 *   選ぶのをやめたチームの試合・日程が変わって消えた試合は、全チームの取得に成功した時だけ消す。
 */

const API = "/api/soccer";
const TEAMS_KEY = "lifeHubSoccerTeams:v1";
const SYNCED_AT_KEY = "lifeHubSoccerSyncedAt:v1";
const SYNC_VERSION_KEY = "lifeHubSoccerSyncVersion:v1";
/** 取り込む予定の中身(題名・メモの書き方)を変えたら上げる。上げると、6時間待たずに、次に開いた時に全部書き直す。
 * 1=英語名、2=日本語名・U-NEXT配信の記載、3=メモの印に紋章用のチームidを足した。 */
export const SOCCER_SYNC_VERSION = "3";
/** 画面を開いた時の自動取得を見送る間隔。日程はそう頻繁には変わらない。 */
export const SOCCER_AUTO_SYNC_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const MARKER_RE = /ESPN#(\d+)/;

export interface SoccerTeam {
  id: string;
  name: string;
  /** ESPN のリーグ名(プレミアリーグなど、選ぶ画面の見出しに使う)。 */
  league: string;
}

/** 選ぶ画面に出すリーグ。日本人選手の所属が多いリーグまで入れている。 */
export const SOCCER_LEAGUES: readonly { slug: string; label: string; short: string }[] = [
  { slug: "eng.1", label: "プレミアリーグ(イングランド)", short: "プレミア" },
  { slug: "esp.1", label: "ラ・リーガ(スペイン)", short: "ラ・リーガ" },
  { slug: "ger.1", label: "ブンデスリーガ(ドイツ)", short: "ブンデス" },
  { slug: "ita.1", label: "セリエA(イタリア)", short: "セリエA" },
  { slug: "fra.1", label: "リーグ・アン(フランス)", short: "リーグ・アン" },
  { slug: "ned.1", label: "エールディヴィジ(オランダ)", short: "オランダ" },
  { slug: "por.1", label: "リーガ・ポルトガル", short: "ポルトガル" },
  { slug: "sco.1", label: "スコットランド・プレミアシップ", short: "スコットランド" },
  { slug: "bel.1", label: "ベルギー・プロリーグ", short: "ベルギー" },
  { slug: "eng.2", label: "チャンピオンシップ(イングランド2部)", short: "英2部" },
];


type FetchLike = (url: string) => Promise<Pick<Response, "ok" | "json">>;

/** この端末にチームの選択が記録されているか(選んでいない=記録なし、と、全部外した=空の記録、を区別する)。 */
export function hasStoredSoccerTeams(storage: Pick<Storage, "getItem"> = window.localStorage): boolean {
  try {
    return storage.getItem(scopedKey(TEAMS_KEY)) !== null;
  } catch {
    return false;
  }
}

export function loadSoccerTeams(storage: Pick<Storage, "getItem"> = window.localStorage): SoccerTeam[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(scopedKey(TEAMS_KEY)) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (t): t is SoccerTeam => !!t && typeof t.id === "string" && typeof t.name === "string" && typeof t.league === "string",
    );
  } catch {
    return [];
  }
}

export function saveSoccerTeams(teams: SoccerTeam[], storage: Pick<Storage, "setItem"> = window.localStorage): void {
  try {
    storage.setItem(scopedKey(TEAMS_KEY), JSON.stringify(teams));
  } catch {
    // 書けない環境では覚えられないだけ。
  }
}

/** 選んだチームのうち、前回取り込んだ時刻(ミリ秒)。無ければ 0。 */
export function lastSoccerSyncAt(storage: Pick<Storage, "getItem"> = window.localStorage): number {
  try {
    return Number(storage.getItem(scopedKey(SYNCED_AT_KEY))) || 0;
  } catch {
    return 0;
  }
}

/** 前回の取り込みが、いまの書き方(SOCCER_SYNC_VERSION)での取り込みだったか。 */
export function soccerSyncIsCurrent(storage: Pick<Storage, "getItem"> = window.localStorage): boolean {
  try {
    return storage.getItem(scopedKey(SYNC_VERSION_KEY)) === SOCCER_SYNC_VERSION;
  } catch {
    return false;
  }
}

function markSoccerSynced(now: number): void {
  try {
    window.localStorage.setItem(scopedKey(SYNCED_AT_KEY), String(now));
    window.localStorage.setItem(scopedKey(SYNC_VERSION_KEY), SOCCER_SYNC_VERSION);
  } catch {
    // 印を残せないだけ。次に開いた時にもう一度取るだけで済む。
  }
}

export function shouldAutoSyncSoccer(teams: SoccerTeam[], lastAt: number, now: number, current = true): boolean {
  return teams.length > 0 && (!current || now - lastAt >= SOCCER_AUTO_SYNC_COOLDOWN_MS);
}

/** ESPN の順位表(standings)の中の、チーム1件。 */
interface StandingsNode {
  entries?: { team?: { id?: string; displayName?: string } }[];
  [key: string]: unknown;
}

/** 順位表の中の「entries」を、どの深さにあっても集める(リーグによって、グループ分けの層が違う)。 */
function collectStandingsTeams(node: unknown, out: { id: string; name: string }[]): void {
  if (Array.isArray(node)) {
    for (const item of node) collectStandingsTeams(item, out);
    return;
  }
  if (!node || typeof node !== "object") return;
  const record = node as StandingsNode;
  for (const entry of record.entries ?? []) {
    const id = entry.team?.id;
    const name = entry.team?.displayName;
    if (id && name) out.push({ id, name });
  }
  for (const value of Object.values(record)) if (value && typeof value === "object") collectStandingsTeams(value, out);
}

/** 選ぶ画面用: そのリーグのチーム一覧。
 * チーム一覧は ESPN の順位表(standings)から取る(api/soccer.ts が中継する)。 */
export async function fetchLeagueTeams(slug: string, fetchImpl: FetchLike = (u) => fetch(u)): Promise<SoccerTeam[]> {
  const response = await fetchImpl(`${API}?kind=teams&value=${encodeURIComponent(slug)}`);
  if (!response.ok) throw new Error(`ESPN ${slug}`);
  const found: { id: string; name: string }[] = [];
  collectStandingsTeams(await response.json(), found);
  const label = SOCCER_LEAGUES.find((l) => l.slug === slug)?.label ?? slug;
  const seen = new Set<string>();
  const teams: SoccerTeam[] = [];
  for (const { id, name } of found) {
    if (seen.has(id)) continue;
    seen.add(id);
    teams.push({ id, name: teamNameJa(name), league: label });
  }
  return teams.sort((a, b) => a.name.localeCompare(b.name, "ja"));
}

/** ESPN の試合1件(使う項目だけ)。 */
export interface EspnFixture {
  id: string;
  date: string;
  season?: { displayName?: string };
  seasonType?: { name?: string };
  competitions?: {
    timeValid?: boolean;
    venue?: { fullName?: string; address?: { city?: string; country?: string } };
    competitors?: { homeAway?: string; id?: string; team?: { id?: string; displayName?: string } }[];
  }[];
}

export async function fetchTeamFixtures(teamId: string, fetchImpl: FetchLike = (u) => fetch(u)): Promise<EspnFixture[]> {
  const response = await fetchImpl(`${API}?kind=fixtures&value=${encodeURIComponent(teamId)}`);
  if (!response.ok) throw new Error(`ESPN team ${teamId}`);
  const body = (await response.json()) as { events?: EspnFixture[] };
  return body.events ?? [];
}

/** U-NEXT のサッカーパックが全試合をライブ配信しているリーグ(2026-27、プレミアリーグ・ラ・リーガ1部)。
 * 試合ごとの配信予定は U-NEXT に公開の窓口が無く取れないので、リーグ単位で書く。CL/EL などは U-NEXT では
 * 配信していない(または一部だけ)ので、何も書かない — 見られると思って見逃すより、書かない方が安全。 */
export function isUnextFullCoverage(seasonName: string | undefined): boolean {
  const name = (seasonName ?? "").replace(/^\d{4}-\d{2,4}\s+/, "").trim();
  return /^(English Premier League|(Spanish )?LA ?LIGA)$/i.test(name);
}

/** リーグ戦と UEFA の大会だけを入れる。国内カップ(FA Cup・Carabao Cup・Copa del Rey など)・スーパーカップ・親善試合は外す。 */
export function isTargetCompetition(seasonName: string | undefined): boolean {
  const name = seasonName ?? "";
  if (/UEFA (Champions|Europa|Conference) League/i.test(name)) return true;
  return !/cup|copa|coupe|coppa|pokal|taça|shield|supercopa|supercoppa|trophy|friendly|親善/i.test(name);
}

const JST_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** ISO(UTC)の時刻を日本時間の日付・時刻にする。 */
export function toJst(iso: string): { date: string; time: string } | null {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  const parts = Object.fromEntries(JST_FORMAT.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

export function soccerEventId(espnId: string): Promise<string> {
  return stableUuid(`soccer:${espnId}`);
}

export function espnIdOfEvent(event: Pick<CalendarEvent, "memo">): string | null {
  return MARKER_RE.exec(event.memo ?? "")?.[1] ?? null;
}

/** ESPN の試合を、予定の中身(idと作成時刻以外)にする。取り込まない試合は null。 */
export function fixtureToEventFields(fixture: EspnFixture): Omit<CalendarEvent, "id" | "createdAt"> | null {
  if (!isTargetCompetition(fixture.season?.displayName)) return null;
  const jst = toJst(fixture.date);
  if (!jst) return null;
  const competition = fixture.competitions?.[0];
  const homeSide = competition?.competitors?.find((c) => c.homeAway === "home");
  const awaySide = competition?.competitors?.find((c) => c.homeAway === "away");
  const home = homeSide?.team?.displayName;
  const away = awaySide?.team?.displayName;
  const homeId = homeSide?.team?.id ?? homeSide?.id;
  const awayId = awaySide?.team?.id ?? awaySide?.id;
  if (!home || !away) return null;
  const timeKnown = competition?.timeValid !== false;
  const venue = competition?.venue;
  const location = [venue?.fullName, venue?.address?.city].filter(Boolean).join("、");
  const stripYear = (text: string) => text.replace(/^\d{4}-\d{2,4}\s+/, "");
  const stageRaw = stripYear(fixture.seasonType?.name ?? "");
  // 「Regular Season」は、リーグ戦だと言っているだけなので書かない。
  const stage = /^regular season$/i.test(stageRaw) ? "" : stageRaw;
  const season = stripYear(fixture.season?.displayName ?? "");
  const memo = [
    [competitionNameJa(season), stage && !season.toLowerCase().includes(stage.toLowerCase()) && !stage.toLowerCase().includes(season.toLowerCase()) ? competitionNameJa(stage) : ""].filter(Boolean).join(" "),
    isUnextFullCoverage(fixture.season?.displayName) ? "配信: U-NEXT(サッカーパック)でライブ配信" : "",
    timeKnown ? "" : "キックオフ時刻は未定です",
    "日本時間・ESPN の日程から自動で入れた予定です",
    // 画面が紋章を出すための、チームのid(src/lib/soccerMatch.ts が読む)。
    `ESPN#${fixture.id}${homeId && awayId ? ` (${homeId}-${awayId})` : ""}`,
  ]
    .filter(Boolean)
    .join("\n");
  return {
    title: `${SOCCER_TITLE_PREFIX}${teamNameJa(home)} vs ${teamNameJa(away)}`,
    date: jst.date,
    ...(timeKnown ? { startTime: jst.time } : { allDay: true }),
    ...(location ? { location } : {}),
    memo,
    category: "other",
  };
}

export interface SoccerSyncResult {
  added: number;
  updated: number;
  removed: number;
  /** 取得できなかったチーム数。1つでもあれば、消す処理は見送っている。 */
  failedTeams: number;
}

function sameFields(a: CalendarEvent, b: Omit<CalendarEvent, "id" | "createdAt">): boolean {
  return (
    a.title === b.title &&
    a.date === b.date &&
    (a.startTime ?? "") === (b.startTime ?? "") &&
    Boolean(a.allDay) === Boolean(b.allDay) &&
    (a.location ?? "") === (b.location ?? "") &&
    (a.memo ?? "") === (b.memo ?? "")
  );
}

let running: Promise<SoccerSyncResult> | null = null;

/** 選んだチームの今後の試合を取り込み直す。同時に2本は走らせない。 */
export function syncSoccerFixtures(
  teams: SoccerTeam[],
  now: number = Date.now(),
  fetchImpl?: FetchLike,
): Promise<SoccerSyncResult> {
  if (!running) {
    running = runSync(teams, now, fetchImpl).finally(() => {
      running = null;
    });
  }
  return running;
}

async function runSync(teams: SoccerTeam[], now: number, fetchImpl?: FetchLike): Promise<SoccerSyncResult> {
  const settled = await Promise.allSettled(teams.map((t) => fetchTeamFixtures(t.id, fetchImpl)));
  const failedTeams = settled.filter((s) => s.status === "rejected").length;

  const desired = new Map<string, Omit<CalendarEvent, "id" | "createdAt">>();
  for (const s of settled) {
    if (s.status !== "fulfilled") continue;
    for (const fixture of s.value) {
      const fields = fixtureToEventFields(fixture);
      if (fields) desired.set(fixture.id, fields);
    }
  }

  const today = toJst(new Date(now).toISOString())?.date ?? "";
  // 今日以降の予定だけ読む(日付に索引がある)。予定が何千件あっても、起動の邪魔をしない。
  const existingAll = await db.calendarEvents.where("date").aboveOrEqual(today).toArray();
  const existing = new Map<string, CalendarEvent>();
  for (const event of existingAll) {
    const espnId = espnIdOfEvent(event);
    if (espnId && event.date >= today) existing.set(espnId, event);
  }

  const result: SoccerSyncResult = { added: 0, updated: 0, removed: 0, failedTeams };
  for (const [espnId, fields] of desired) {
    if (fields.date < today) continue;
    const old = existing.get(espnId);
    if (old) {
      if (!sameFields(old, fields)) {
        // 日程が動いた時に、前の時刻や「終日」が残らないように、日程の項目は置き換える。
        const { startTime: _s, allDay: _a, location: _l, endTime: _e, ...rest } = old;
        await db.calendarEvents.put({ ...rest, ...fields, updatedAt: now });
        result.updated++;
      }
    } else {
      await db.calendarEvents.put({ ...fields, id: await soccerEventId(espnId), createdAt: now });
      result.added++;
    }
  }
  if (failedTeams === 0) {
    for (const [espnId, event] of existing) {
      if (!desired.has(espnId) && event.id) {
        await db.calendarEvents.delete(event.id);
        result.removed++;
      }
    }
  }
  if (failedTeams < teams.length) markSoccerSynced(now);
  return result;
}

/** 選ぶのをやめた時に、そのチームだけの今後の試合を消す(取り込み直しでも消えるが、すぐ消えるように)。 */
export async function removeAllSoccerEvents(now: number = Date.now()): Promise<number> {
  const today = toJst(new Date(now).toISOString())?.date ?? "";
  const events = await db.calendarEvents.where("date").aboveOrEqual(today).toArray();
  let removed = 0;
  for (const event of events) {
    if (event.id && espnIdOfEvent(event) && event.date >= today) {
      await db.calendarEvents.delete(event.id);
      removed++;
    }
  }
  return removed;
}
