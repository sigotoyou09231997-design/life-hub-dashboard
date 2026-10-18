import type { ElementType } from "react";
import type { CalendarEvent, Note, SyncedEmail, Task, Trip, TripScheduleItem } from "../types";
import { formatGmailTimestamp } from "./date";
import { findAppPage } from "./commandPalette";
import {
  emailHit,
  eventHit,
  noteHit,
  searchKindLabel,
  taskHit,
  tripHit,
  tripScheduleHit,
  type SearchHit,
  type SearchKind,
} from "./globalSearch";

/*
 * まとめて検索の「最近見たもの」。この端末の中(localStorage)だけに残す。
 *
 * 残すのは「何を開いたか(種類とid)」だけで、名前は出す時にその都度 Dexie から引く。
 * 名前を書き換えた旅行が古い名前のまま並んだり、消した予定が残り続けたりしないように
 * するため。別のアカウントに切り替えた時も、そのアカウントに無いものは引けずに
 * 並ばない(アカウントごとに Dexie が分かれている、src/lib/accounts.ts)。
 *
 * どこで残すか:
 *   - 旅行の詳細・メールの詳細・各画面へ移った時(GlobalSearch.tsx がURLの変化を見て
 *     recentEntryForPath で拾う)。一覧や通知から開いたものも並ぶようにするため。
 *   - まとめて検索の当たりを開いた時。予定・タスク・メモ・旅行の日程は自分の画面
 *     (URL)を持たないので、ここでしか「開いた」が分からない。
 * PC とスマホの間では同期しない — 端末ごとに見ているものが違うので、その端末で
 * 見たものだけが並ぶ方が「さっきの」にすぐ戻れる。
 */

export type RecentKind = SearchKind | "page";

export interface RecentEntry {
  kind: RecentKind;
  /** データはそのid。画面(page)はそのパス(例: /records/expense)。 */
  id: string;
  /** 開いた時刻(ミリ秒)。並びは新しい順。 */
  at: number;
}

export const RECENT_STORAGE_KEY = "lifeHubRecent:v1";
/** 残しておく数。消されて引けなくなるものもあるので、出す数(RECENT_SHOW_LIMIT)より多めに持つ。 */
export const RECENT_STORE_LIMIT = 20;
export const RECENT_SHOW_LIMIT = 8;
/** 画面は下のナビ・サイドバーからいつでも行けるので、並ぶ数を抑えて旅行やメールの場所を残す。 */
export const RECENT_PAGE_LIMIT = 3;

const RECENT_KINDS = new Set<RecentKind>(["event", "task", "note", "trip", "tripSchedule", "email", "page"]);

type ReadStorage = Pick<Storage, "getItem">;
type WriteStorage = Pick<Storage, "getItem" | "setItem">;

/** プライベートブラウズ・保存を切った設定などでは localStorage に触るだけで例外になる。 */
function defaultStorage(): WriteStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isRecentEntry(value: unknown): value is RecentEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.kind === "string" &&
    RECENT_KINDS.has(entry.kind as RecentKind) &&
    typeof entry.id === "string" &&
    entry.id.length > 0 &&
    typeof entry.at === "number"
  );
}

/** 残っている「最近見たもの」(新しい順)。読めない・壊れている時は空として扱う。 */
export function loadRecent(storage: ReadStorage | null = defaultStorage()): RecentEntry[] {
  if (!storage) return [];
  try {
    const parsed: unknown = JSON.parse(storage.getItem(RECENT_STORAGE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecentEntry).slice(0, RECENT_STORE_LIMIT);
  } catch {
    return [];
  }
}

/** 1件を先頭に足す。同じものは前の分を消して先頭へ上げる(並びが重複しないように)。 */
export function recordRecent(
  entry: Pick<RecentEntry, "kind" | "id">,
  storage: WriteStorage | null = defaultStorage(),
  now: number = Date.now(),
): RecentEntry[] {
  const rest = loadRecent(storage).filter((existing) => !(existing.kind === entry.kind && existing.id === entry.id));
  const next = [{ kind: entry.kind, id: entry.id, at: now }, ...rest].slice(0, RECENT_STORE_LIMIT);
  try {
    storage?.setItem(RECENT_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // 保存できなくても、開く操作そのものは止めない。
  }
  return next;
}

/** URLの一部を戻す。壊れた書き方(%の後ろが数字でない等)でも落とさず、そのまま使う。 */
function safeDecode(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

/** URLから「開いたもの」を読む。旅行の詳細・メールの詳細・各画面だけ。ホームや
 * ログインの戻り先などは並べても意味がないので null。 */
export function recentEntryForPath(pathname: string): Pick<RecentEntry, "kind" | "id"> | null {
  const trip = /^\/trips\/([^/]+)\/?$/.exec(pathname);
  if (trip) return { kind: "trip", id: safeDecode(trip[1]) };
  const mail = /^\/gmail\/mail\/([^/]+)\/?$/.exec(pathname);
  if (mail) return { kind: "email", id: safeDecode(mail[1]) };
  const page = findAppPage(pathname.replace(/\/+$/, "") || "/");
  return page ? { kind: "page", id: page.path } : null;
}

/** そのもの自身の画面(URLのパス)。自分の画面を持たないもの(予定・メモなど)は null。 */
function ownPath(entry: Pick<RecentEntry, "kind" | "id">): string | null {
  if (entry.kind === "page") return entry.id;
  if (entry.kind === "trip") return `/trips/${entry.id}`;
  if (entry.kind === "email") return `/gmail/mail/${entry.id}`;
  return null;
}

/** 名前を引くための行。GlobalSearch.tsx が Dexie から id で引いて渡す。 */
export interface RecentRows {
  events: Map<string, CalendarEvent>;
  tasks: Map<string, Task>;
  notes: Map<string, Note>;
  trips: Map<string, Trip>;
  tripSchedule: Map<string, TripScheduleItem>;
  emails: Map<string, SyncedEmail>;
}

export function emptyRecentRows(): RecentRows {
  return {
    events: new Map(),
    tasks: new Map(),
    notes: new Map(),
    trips: new Map(),
    tripSchedule: new Map(),
    emails: new Map(),
  };
}

export interface RecentItem {
  key: string;
  entry: RecentEntry;
  title: string;
  subtitle: string;
  to: string;
  /** 画面の行だけが持つアイコン。データの行は種類から決める(GlobalSearch.tsx)。 */
  icon?: ElementType;
  personIds?: string[];
}

function hitFor(entry: RecentEntry, rows: RecentRows): SearchHit | null {
  const { id } = entry;
  switch (entry.kind) {
    case "event": {
      const row = rows.events.get(id);
      return row ? eventHit({ ...row, id }) : null;
    }
    case "task": {
      const row = rows.tasks.get(id);
      return row ? taskHit({ ...row, id }) : null;
    }
    case "note": {
      const row = rows.notes.get(id);
      return row ? noteHit({ ...row, id }) : null;
    }
    case "trip": {
      const row = rows.trips.get(id);
      return row ? tripHit({ ...row, id }) : null;
    }
    case "tripSchedule": {
      const row = rows.tripSchedule.get(id);
      return row ? tripScheduleHit({ ...row, id }, rows.trips.get(row.tripId)?.name) : null;
    }
    case "email": {
      const row = rows.emails.get(id);
      return row ? emailHit({ ...row, id }) : null;
    }
    default:
      return null;
  }
}

function describe(entry: RecentEntry, rows: RecentRows): RecentItem | null {
  const key = `${entry.kind}:${entry.id}`;
  if (entry.kind === "page") {
    const page = findAppPage(entry.id);
    return page ? { key, entry, title: page.label, subtitle: "画面", to: page.path, icon: page.icon } : null;
  }
  const hit = hitFor(entry, rows);
  if (!hit) return null;
  // メールは件名を出さない(画面を人に見られた時のため。第8弾 D-2)。「Gmail のメール」と日付だけ。
  if (entry.kind === "email") {
    const row = rows.emails.get(entry.id);
    return { key, entry, title: "Gmail のメール", subtitle: `Gmail ・ ${row ? formatGmailTimestamp(row.receivedAt) : ""}`.trim(), to: hit.to };
  }
  return {
    key,
    entry,
    title: hit.title,
    subtitle: [searchKindLabel(hit.kind), hit.subtitle].filter((part) => part.length > 0).join(" ・ "),
    to: hit.to,
    personIds: hit.personIds,
  };
}

/**
 * 出す「最近見たもの」を決める。
 * - いま開いている画面そのものは出さない(押しても何も変わらないため)。
 * - 消された・このアカウントに無いものは出さない(引けなかったもの)。
 * - 画面は RECENT_PAGE_LIMIT 件まで。全部で RECENT_SHOW_LIMIT 件まで。
 */
export function buildRecentList(
  entries: RecentEntry[],
  rows: RecentRows,
  options: { currentPath?: string; limit?: number; pageLimit?: number } = {},
): RecentItem[] {
  const { currentPath, limit = RECENT_SHOW_LIMIT, pageLimit = RECENT_PAGE_LIMIT } = options;
  const items: RecentItem[] = [];
  let pages = 0;
  for (const entry of entries) {
    if (items.length >= limit) break;
    if (currentPath !== undefined && ownPath(entry) === currentPath) continue;
    if (entry.kind === "page" && pages >= pageLimit) continue;
    const item = describe(entry, rows);
    if (!item) continue;
    if (entry.kind === "page") pages += 1;
    items.push(item);
  }
  return items;
}
