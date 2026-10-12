/**
 * 「削除しました・元に戻す」の削除を、お知らせが閉じるまで本当には行わない仕組み。
 * UI/UX 調査メモ 第4弾 A-2(取り返しがつく削除は確認をやめ、すぐ消して「元に戻す」を出す)。
 *
 * ■ なぜ「すぐ消して、元に戻すで入れ直す」にしなかったか(src/lib/sync.ts を読んで決めた)
 * - 消した行は 'deleting' フックで syncQueue に積まれ、すぐサーバーへ deleted_at が送られる。
 *   サーバーはそれを Realtime で全端末に配る。applyRemoteRow は「削除」だけは、自分の端末から
 *   出たものでも必ず適用する(跳ね返りの見送りより先に処理する作り)。
 * - そのため、入れ直した直後に自分の削除が跳ね返ってくると、入れ直した行がもう一度消える。
 *   しかもその削除は「サーバー由来」扱いなので送り返されず、syncQueue に残った upsert は
 *   送る時に行が見つからず、何も送らずに捨てられる。→ 元に戻したはずの行が、この端末からも
 *   サーバーからも黙って消える。
 * - ほかの端末でも、消えてから戻る(ちらつく)。
 *
 * ■ なので、押した時は「隠す」だけにする
 * - この中の集合に入れ、一覧はそれを除いて描く(src/hooks/usePendingDeletes.ts)。
 *   DB には何も書かないので、元に戻すは集合から外すだけ — 同期には何も流れない。
 * - 本当に消す(commit)のは、お知らせが時間切れで閉じた時・次のお知らせに置き換わった時・
 *   画面が隠れた時(pagehide / visibilitychange → hidden)。
 * - commit の中身は、これまで各画面が直接呼んでいた削除(サブタスク・写真・場所リマインドなど
 *   一緒に落とすもの込み)をそのまま使う(src/lib/undoableDeletes.ts)。同期の流れは今までの削除と同じ。
 *
 * ■ 待っている間にアプリが閉じられた時(控え)
 * - 再読み込み・タブを閉じた時は、pagehide の中で始めた IndexedDB の書き込みがページと一緒に
 *   打ち切られる(2026-10-12、Playwright で再読み込みして確かめた。消したはずの行が戻った)。
 * - そこで、待たせる時に「何を消すか」を localStorage に控えておく(localStorage は同期的に
 *   書けるので、閉じる直前でも残る)。消し終わる・元に戻すと控えも消す。
 * - 次に開いた時は、控えに残っている行を最初から隠し、同期の準備ができてから
 *   replayInterruptedDeletes で消し切る(準備の前に消すと syncQueue に積まれず、サーバーに残った
 *   行がまた降りてくるため。呼ぶのは App.tsx)。
 */
import { scopedKey } from "./accounts";

export interface PendingDeleteRow {
  /** Dexie のテーブル名(db.tasks なら "tasks")。 */
  table: string;
  id: string;
}

/** 控えに書く「何を消すか」。kind は src/lib/undoableDeletes.ts の種類の名前。 */
export interface DeferredDeleteTarget {
  kind: string;
  id: string;
}

export type DeferredDeleteStatus = "pending" | "committing" | "committed" | "undone" | "failed";

export interface DeferredDelete {
  /** 本当に消す。何度呼んでも消すのは1回だけ(2回目からは1回目と同じ Promise)。
   * 元に戻した後なら何もしない。 */
  commit(): Promise<void>;
  /** 隠すのをやめる。DB は触っていないので、これで元どおり。消し始めた後なら false。 */
  undo(): boolean;
  readonly status: DeferredDeleteStatus;
}

/** 消し終わってから隠すのをやめるまでの間。すぐ外すと、useLiveQuery が消えた後の結果を
 * 読み直すまでの一瞬だけ、行が戻って見える。 */
export const COMMITTED_UNHIDE_DELAY_MS = 1500;

interface JournalEntry extends DeferredDeleteTarget {
  token: string;
  rows: PendingDeleteRow[];
}

/** 隠している行(「テーブル名:id」)ごとの数。同じ行を2つの削除が隠すこともあるので数で持つ。 */
const hiddenCounts = new Map<string, number>();
let snapshot: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();
const openEntries = new Set<DeferredDelete>();
/** この開いている間に書いた控え。replay はこれを飛ばす(まだ「元に戻す」が効く削除なので)。 */
const liveTokens = new Set<string>();
let lifecycleAttached = false;
let lastToken = 0;

export function pendingDeleteKey(table: string, id: string): string {
  return `${table}:${id}`;
}

function publish(): void {
  snapshot = new Set(hiddenCounts.keys());
  for (const listener of [...listeners]) listener();
}

function hide(keys: string[]): void {
  for (const key of keys) hiddenCounts.set(key, (hiddenCounts.get(key) ?? 0) + 1);
  publish();
}

function unhide(keys: string[]): void {
  for (const key of keys) {
    const count = (hiddenCounts.get(key) ?? 0) - 1;
    if (count > 0) hiddenCounts.set(key, count);
    else hiddenCounts.delete(key);
  }
  publish();
}

// ---- 控え(localStorage) -------------------------------------------------------------------
// 読み書きできない時(プライベートモード・容量切れ)は控えなしで動く。閉じた時に戻ることがあるだけ。

function journalKey(): string {
  return scopedKey("lifeHubDeferredDeletes");
}

function readJournal(): JournalEntry[] {
  try {
    const raw = localStorage.getItem(journalKey());
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as JournalEntry[]).filter((e) => e && typeof e.token === "string") : [];
  } catch {
    return [];
  }
}

function writeJournal(entries: JournalEntry[]): void {
  try {
    if (entries.length === 0) localStorage.removeItem(journalKey());
    else localStorage.setItem(journalKey(), JSON.stringify(entries));
  } catch {
    // 控えが書けなくても、削除そのものは進める。
  }
}

function addToJournal(entry: JournalEntry): void {
  writeJournal([...readJournal().filter((e) => e.token !== entry.token), entry]);
}

function removeFromJournal(token: string): void {
  const entries = readJournal();
  const rest = entries.filter((e) => e.token !== token);
  if (rest.length !== entries.length) writeJournal(rest);
}

/** 前に開いていた時の控えの行は、読み込んだ時点から隠しておく(消し切るまでの間に一瞬見えないように)。 */
const interruptedHidden = new Map<string, string[]>();
for (const entry of readJournal()) {
  const keys = (entry.rows ?? []).map((row) => pendingDeleteKey(row.table, row.id));
  interruptedHidden.set(entry.token, keys);
  for (const key of keys) hiddenCounts.set(key, (hiddenCounts.get(key) ?? 0) + 1);
}
snapshot = new Set(hiddenCounts.keys());

// ---------------------------------------------------------------------------------------

function attachLifecycleListeners(): void {
  if (lifecycleAttached || typeof window === "undefined") return;
  lifecycleAttached = true;
  // スマホでは、アプリを切り替えた時に来るのは visibilitychange だけのことが多い(pagehide は
  // 来ないまま止められることがある)。どちらでも、まだ待っている削除を書き切る。
  window.addEventListener("pagehide", () => void commitPendingDeletes());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void commitPendingDeletes();
  });
}

/**
 * rows を一覧から隠し、commit を呼ぶまで本当には消さない。
 * target を渡すと、待っている間にアプリが閉じられても次に開いた時に消し切れるよう控えを残す。
 * 普段は src/components/ui/undoToast.ts の deleteWithUndo から使う(お知らせと組み合わせる)。
 */
export function deferDelete(rows: PendingDeleteRow[], commit: () => unknown, target?: DeferredDeleteTarget): DeferredDelete {
  const keys = rows.map((row) => pendingDeleteKey(row.table, row.id));
  let status: DeferredDeleteStatus = "pending";
  let committing: Promise<void> | null = null;
  lastToken += 1;
  const token = `${Date.now().toString(36)}-${lastToken}-${Math.random().toString(36).slice(2, 8)}`;

  const settle = () => {
    openEntries.delete(entry);
    liveTokens.delete(token);
    if (target) removeFromJournal(token);
  };

  const entry: DeferredDelete = {
    get status() {
      return status;
    },
    commit() {
      if (committing) return committing;
      if (status === "undone") return Promise.resolve();
      status = "committing";
      openEntries.delete(entry);
      committing = (async () => {
        try {
          await commit();
        } catch (error) {
          // 消せなかった行はまだ DB にあるので、すぐ見えるように戻す(控えも消す — 次に開いた時に
          // 黙って消すより、見えている通りに残す方が分かりやすい)。
          status = "failed";
          settle();
          unhide(keys);
          throw error;
        }
        status = "committed";
        settle();
        setTimeout(() => unhide(keys), COMMITTED_UNHIDE_DELAY_MS);
      })();
      return committing;
    },
    undo() {
      if (status !== "pending") return false;
      status = "undone";
      settle();
      unhide(keys);
      return true;
    },
  };

  openEntries.add(entry);
  if (target) {
    liveTokens.add(token);
    addToJournal({ token, kind: target.kind, id: target.id, rows });
  }
  hide(keys);
  attachLifecycleListeners();
  return entry;
}

/** まだ待っている削除を全部、本当に消す(画面が隠れた時)。失敗したものは記録だけ残す。 */
export function commitPendingDeletes(): Promise<void> {
  const commits = [...openEntries].map((entry) =>
    entry.commit().catch((error) => console.error("[deferredDelete] failed to commit a delete:", error)),
  );
  return Promise.all(commits).then(() => undefined);
}

/** 前に開いていた時の控え(待っている間にアプリが閉じられた削除)が残っているか。 */
export function hasInterruptedDeletes(): boolean {
  return readJournal().some((entry) => !liveTokens.has(entry.token));
}

let replaying: Promise<void> | null = null;

/**
 * 前に開いていた時の控えに残っている削除を、いま消し切る。同期の準備ができてから呼ぶこと
 * (準備の前に消すと syncQueue に積まれず、サーバーの行がまた降りてくる)。
 * handlers は種類ごとの本当の削除(src/lib/undoableDeletes.ts)。知らない種類は控えだけ捨てる。
 */
export function replayInterruptedDeletes(handlers: Record<string, (id: string) => unknown>): Promise<void> {
  if (replaying) return replaying;
  replaying = (async () => {
    for (const entry of readJournal()) {
      if (liveTokens.has(entry.token)) continue;
      const handler = Object.prototype.hasOwnProperty.call(handlers, entry.kind) ? handlers[entry.kind] : undefined;
      try {
        if (handler) await handler(entry.id);
      } catch (error) {
        console.error("[deferredDelete] failed to finish an interrupted delete:", error);
      }
      removeFromJournal(entry.token);
      const keys = interruptedHidden.get(entry.token);
      interruptedHidden.delete(entry.token);
      if (keys) setTimeout(() => unhide(keys), COMMITTED_UNHIDE_DELAY_MS);
    }
  })().finally(() => {
    replaying = null;
  });
  return replaying;
}

export function isPendingDelete(table: string, id: string | undefined, pending: ReadonlySet<string> = snapshot): boolean {
  return Boolean(id) && pending.has(pendingDeleteKey(table, id!));
}

/** 隠している行を除いた一覧。何も隠していなければ、渡した配列をそのまま返す
 * (useLiveQuery の結果と同じものが返るので、依存配列に入れても描き直しが増えない)。 */
export function withoutPendingDeletes<T extends { id?: string }>(
  table: string,
  rows: T[],
  pending: ReadonlySet<string> = snapshot,
): T[] {
  if (pending.size === 0) return rows;
  const visible = rows.filter((row) => !isPendingDelete(table, row.id, pending));
  return visible.length === rows.length ? rows : visible;
}

export function subscribePendingDeletes(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getPendingDeletes(): ReadonlySet<string> {
  return snapshot;
}
