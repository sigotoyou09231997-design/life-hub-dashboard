import type { EntityTable } from "dexie";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseDataClient } from "./supabaseData";
import { scopedKey } from "./accounts";
import { db, type SyncQueueEntry } from "../db/schema";
import { summarizeSyncProblems, syncTableLabel } from "./syncProblems";
import { getDeviceId } from "./deviceId";
import {
  SHARED_TRIP_TABLES,
  TRIP_CHILD_TABLES,
  notifyTripMembersChanged,
  ownerIdForPush,
  planSharedTrips,
  readSeenSharedTrips,
  readSharedOwners,
  writeSeenSharedTrips,
  writeSharedOwners,
} from "./sharedTrips";

interface SyncableRow {
  id?: string;
  createdAt?: number;
  updatedAt?: number;
  deviceId?: string;
  userId?: string;
}

interface RegisteredTable {
  table: EntityTable<SyncableRow, "id">;
  tableName: string;
}

/** Local epoch-ms fields that map to Postgres `timestamptz` columns and need
 * explicit conversion — everything else passes through unchanged. */
const TIMESTAMP_FIELDS = new Set(["createdAt", "updatedAt"]);

const registered: RegisteredTable[] = [];
const registeredNames = new Set<string>();
const realtimeChannels: RealtimeChannel[] = [];
let currentUserId: string | null = null;
let applyingRemoteChange = false;
let dataClient: SupabaseClient | null = null;
let lifecycleListenersAttached = false;

/** テーブルのフック(下の registerSyncedTable)に「この変更は送り返さない」と
 * 伝えるための一時停止。サーバー由来の反映(applyRemoteRow)と同じ仕組みを、
 * ローカルだけで完結させたい一括操作にも使う — src/lib/dataOwner.ts の
 * wipeLocalData(持ち主が変わった端末のローカルを空にする)がこれを使う。
 *
 * Dexie は削除対象のテーブルに1つでもフックが登録済みだと table.clear() を
 * 1行ずつ削除する経路に切り替え、'deleting' フックを毎回発火させる。これを
 * 素通りさせると、ローカルの安全な空っぽ化のはずが「全行削除」としてsyncQueueに
 * 積まれ、次の同期でサーバー側まで消してしまう(2026-09-28、実際に船田悦司さんの
 * 端末内データが空になった事故で発覚。幸いサーバー側は無事だった)。 */
export async function withSyncSuppressed<T>(fn: () => Promise<T>): Promise<T> {
  applyingRemoteChange = true;
  try {
    return await fn();
  } finally {
    applyingRemoteChange = false;
  }
}
let sessionStart: Promise<void> = Promise.resolve();
/** 他人から共有された旅行 → 持ち主(src/lib/sharedTrips.ts)。送る時に、その旅行の行を持ち主の名前で送るのに使う。 */
let sharedOwners = new Map<string, string>();

function camelToSnake(key: string): string {
  return key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
}

function snakeToCamel(key: string): string {
  return key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

function rowToSnake(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value === undefined) continue;
    out[camelToSnake(key)] = TIMESTAMP_FIELDS.has(key) && typeof value === "number" ? new Date(value).toISOString() : value;
  }
  return out;
}

function rowToCamel(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    const camelKey = snakeToCamel(key);
    out[camelKey] = TIMESTAMP_FIELDS.has(camelKey) && typeof value === "string" ? new Date(value).getTime() : value;
  }
  return out;
}

function lastSyncedKey(tableName: string): string {
  // アカウントごとに別のカーソルにする — 2つ目のアカウントが1つ目の「最後に同期した
  // 時刻」を引き継いでしまうと、それより古い自分のデータが降りてこない。
  return scopedKey(`lifeHubLastSynced:${tableName}`);
}

/** Dexie hook `onsuccess` callbacks still run inside the ambient ("PSD") zone of
 * the transaction that just committed, so a Dexie operation on a *different*
 * table (like enqueueing into syncQueue from a `transactions` hook) throws
 * NotFoundError as if that table weren't open. Deferring to a macrotask fully
 * escapes that zone. */
function enqueueAfterCommit(tableName: string, rowId: string, op: "upsert" | "delete"): void {
  setTimeout(() => void enqueue(tableName, rowId, op), 0);
}

async function enqueue(tableName: string, rowId: string, op: "upsert" | "delete"): Promise<void> {
  try {
    const existing = await db.syncQueue.where("[table+rowId]").equals([tableName, rowId]).first();
    if (existing?.id) {
      await db.syncQueue.update(existing.id, { op, queuedAt: Date.now() });
    } else {
      await db.syncQueue.add({ table: tableName, rowId, op, queuedAt: Date.now() });
    }
  } catch (err) {
    console.error("[sync] failed to queue a local change for push:", err);
    return;
  }
  void drainQueue();
}

let draining = false;
async function drainQueue(): Promise<void> {
  if (draining || !currentUserId || !navigator.onLine) return;
  const supabase = dataClient ?? await getSupabaseDataClient();
  draining = true;
  try {
    const entries = await db.syncQueue.toArray();
    for (const entry of entries) {
      if (!entry.id) continue;
      const reg = registered.find((r) => r.tableName === entry.table);
      if (!reg) {
        await db.syncQueue.delete(entry.id);
        continue;
      }
      try {
        if (entry.op === "delete") {
          const { error } = await supabase.from(entry.table).update({ deleted_at: new Date().toISOString() }).eq("id", entry.rowId);
          if (error) throw error;
        } else {
          const row = await reg.table.get(entry.rowId);
          if (row) {
            const userId = (await sharedOwnerOf(reg, row)) ?? currentUserId;
            const { error } = await supabase.from(entry.table).upsert(rowToSnake({ ...row, userId, deletedAt: null }));
            if (error) throw error;
          }
        }
        await db.syncQueue.delete(entry.id);
      } catch (err) {
        console.error("[sync] failed to push a queued change, will retry later:", err);
        // 通信が切れている・ログインが切れている時は、残りを送っても同じように落ちるので止める。
        if (isTransientPushError(err)) break;
        // サーバーがこの行だけを弾いた時(列が無い等)は、印を付けて次へ進む。以前はここでも
        // break していたため、予定1件の失敗でお金・メモまで3週間以上止まっていた(2026-09-21)。
        // 印の付いた行は消さずに残し、次の機会にまた送る(SQLを流せばそのまま送れる)。
        await db.syncQueue.update(entry.id, { lastError: pushErrorText(err), failedAt: Date.now() });
      }
    }
  } finally {
    draining = false;
  }
}

/** supabase-js は通信の失敗も PostgrestError の形で返すが、その時は code が空になる。
 * PGRST301/302/303 はトークン切れ・不正で、ログインし直せば全部送れるので行のせいにしない。 */
function isTransientPushError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code !== "string" || code === "") return true;
  return /^PGRST30\d$/.test(code);
}

function pushErrorText(err: unknown): string {
  const e = err as { code?: string; message?: string } | null;
  const message = e?.message ?? String(err);
  return e?.code ? `${e.code}: ${message}` : message;
}

/** 共有された旅行(他人の旅行)の行なら、その持ち主。そうでなければ null(= 自分の名前で送る)。 */
async function sharedOwnerOf(reg: RegisteredTable, row: SyncableRow): Promise<string | null> {
  if (sharedOwners.size === 0) return null;
  let tripIdOfExpense: string | undefined;
  if (reg.tableName === "trip_expense_currencies") {
    const { expenseId } = row as { expenseId?: unknown };
    const expenses = registered.find((r) => r.tableName === "trip_expenses");
    const expense = expenses && typeof expenseId === "string" ? ((await expenses.table.get(expenseId)) as { tripId?: string } | undefined) : undefined;
    tripIdOfExpense = expense?.tripId;
  }
  return ownerIdForPush(sharedOwners, reg.tableName, row as { id?: unknown; tripId?: unknown }, tripIdOfExpense);
}

type ApplyOutcome = "added" | "updated" | "deleted" | "skipped-echo" | "skipped-lww" | "skipped-no-id" | "error";

async function applyRemoteRow(reg: RegisteredTable, remoteRow: Record<string, unknown>): Promise<ApplyOutcome> {
  const camel = rowToCamel(remoteRow) as SyncableRow & { deletedAt?: number | string | null; serverUpdatedAt?: unknown };
  if (!camel.id) return "skipped-no-id";

  // A delete push only sets deleted_at, never device_id — so a deleted row's device_id
  // can still be whichever device originally created it. Checking the echo-skip before
  // this would mean that original-creator device could never apply a delete performed
  // by any OTHER device. Always process deletes first; deleting an already-absent (or
  // already-deleted) local row is a harmless no-op.
  if (camel.deletedAt) {
    applyingRemoteChange = true;
    try {
      await reg.table.delete(camel.id);
      return "deleted";
    } catch (err) {
      console.error("[sync] applyRemoteRow failed:", err, remoteRow);
      return "error";
    } finally {
      applyingRemoteChange = false;
    }
  }

  applyingRemoteChange = true;
  try {
    const local = await reg.table.get(camel.id);

    // 自分の端末から出た変更が跳ね返ってきただけなら、もう持っているので無視して
    // 良い(元々の意図)。ただし「持っている」かどうかは local の有無で確かめる
    // 必要がある — deviceId が一致するというだけで無視すると、この端末のローカルを
    // 空にして復旧する場面(src/lib/dataOwner.ts の ensureDataOwner)で、まさに
    // この端末で作った行だけが「自分の端末発だから」と一生戻らなくなる
    // (2026-09-28、実際にこれでカレンダーやメモが復旧しきらなかった)。
    if (local && camel.deviceId && camel.deviceId === getDeviceId()) return "skipped-echo";
    if (local && (local.updatedAt ?? 0) > (camel.updatedAt ?? 0)) return "skipped-lww";

    // deletedAt/serverUpdatedAt are sync-plumbing columns, not part of the local row shape.
    const { deletedAt: _deletedAt, serverUpdatedAt: _serverUpdatedAt, ...rest } = camel;
    if (local) {
      await reg.table.update(camel.id, rest);
      return "updated";
    } else {
      await reg.table.add(rest as SyncableRow);
      return "added";
    }
  } catch (err) {
    console.error("[sync] applyRemoteRow failed:", err, remoteRow);
    return "error";
  } finally {
    applyingRemoteChange = false;
  }
}

interface ReconcileResult {
  tableName: string;
  rows: number;
  outcomes: Partial<Record<ApplyOutcome, number>>;
  error: string | null;
}

async function reconcile(reg: RegisteredTable, forceFull = false): Promise<ReconcileResult> {
  if (!currentUserId) {
    return { tableName: reg.tableName, rows: 0, outcomes: {}, error: "not signed in" };
  }
  const key = lastSyncedKey(reg.tableName);
  const since = forceFull ? new Date(0).toISOString() : (localStorage.getItem(key) ?? new Date(0).toISOString());
  const nowIso = new Date().toISOString();
  // Filtered on server_updated_at (server-assigned, monotonic) rather than the
  // client-supplied updated_at used for LWW — a client clock can't be trusted as
  // a pull cursor, and data pushed late (e.g. a catch-up sync) can carry an
  // updated_at far in the past relative to when it actually reached the server.
  const supabase = dataClient ?? await getSupabaseDataClient();
  const { data, error } = await supabase.from(reg.tableName).select("*").gte("server_updated_at", since);
  if (error) return { tableName: reg.tableName, rows: 0, outcomes: {}, error: error.message };
  const outcomes: Partial<Record<ApplyOutcome, number>> = {};
  for (const row of data ?? []) {
    const outcome = await applyRemoteRow(reg, row as Record<string, unknown>);
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
  }
  localStorage.setItem(key, nowIso);
  return { tableName: reg.tableName, rows: data?.length ?? 0, outcomes, error: null };
}

const subscribedChannels = new Set<string>();

function subscribeRealtime(reg: RegisteredTable): void {
  if (!currentUserId || !dataClient) return;
  const topic = `${reg.tableName}-${currentUserId}`;
  if (subscribedChannels.has(topic)) return; // defense in depth against double-start races
  subscribedChannels.add(topic);
  const channel = dataClient
    .channel(topic)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: reg.tableName, filter: `user_id=eq.${currentUserId}` },
      (payload: { new: Record<string, unknown> | null; old: Record<string, unknown> | null }) => {
        const row = payload.new ?? payload.old;
        if (row) void applyRemoteRow(reg, row);
      },
    )
    .subscribe();
  realtimeChannels.push(channel);
}

// ===== 他人と一緒に編集している旅行(supabase/sql/034_trip_members.sql) =====
// 共有された旅行の行は、持ち主の user_id のままサーバーにある。参加中の人は RLS でそれを読み書きできるので、
// いつもの取り込み(reconcile)は、参加したあとの変更を自然に受け取る。足りないのは次の3つ。
//   * 参加より前の行(いつもの差分の取り込みのカーソルより古い) → 初めて見る旅行は、全部取る(backfill)。
//   * リアルタイム(いつもの購読は user_id が自分の行だけ)       → 共有がある時だけ、絞らない購読を足す。
//   * 外された・抜けた旅行                                       → この端末から片付ける(release)。
// 034 が流れていない・通信できない時は、何もしない。旅行も同期も今までどおり動く。

let refreshingShared: Promise<void> | null = null;
let sharedRefreshQueued = false;
let sharedRefreshTimer: ReturnType<typeof setTimeout> | undefined;

/** いまの参加状況をサーバーに確かめ、必要なら共有の旅行を取り込む／片付ける。重なって呼ばれても1回ずつ順に走る。 */
export function refreshSharedTrips(): Promise<void> {
  if (refreshingShared) {
    sharedRefreshQueued = true;
    return refreshingShared;
  }
  refreshingShared = (async () => {
    try {
      do {
        sharedRefreshQueued = false;
        await doRefreshSharedTrips();
      } while (sharedRefreshQueued);
    } catch (err) {
      console.error("[sync] failed to refresh the shared trips:", err);
    } finally {
      refreshingShared = null;
    }
  })();
  return refreshingShared;
}

function scheduleSharedRefresh(): void {
  // 招待された側の「招待が届きました」、持ち主側の「参加しました」を、画面にすぐ出す。
  notifyTripMembersChanged();
  clearTimeout(sharedRefreshTimer);
  sharedRefreshTimer = setTimeout(() => void refreshSharedTrips(), 300);
}

function sameOwners(a: ReadonlyMap<string, string>, b: ReadonlyMap<string, string>): boolean {
  if (a.size !== b.size) return false;
  for (const [tripId, owner] of a) if (b.get(tripId) !== owner) return false;
  return true;
}

async function doRefreshSharedTrips(): Promise<void> {
  const me = currentUserId;
  if (!me || !navigator.onLine) return;
  const client = dataClient ?? (await getSupabaseDataClient());
  const { data, error } = await client.from("trip_members").select("trip_id, owner_id").eq("member_id", me).eq("status", "accepted");
  // 034 がまだ無い／通信できない時。「共有が無くなった」と取り違えて、端末の旅行を片付けたりしない。
  if (error) return;
  if (currentUserId !== me) return; // 確かめている間に、別のアカウントに替わった

  const memberships = new Map<string, string>();
  for (const row of (data ?? []) as { trip_id: string; owner_id: string }[]) memberships.set(row.trip_id, row.owner_id);
  const changed = !sameOwners(memberships, sharedOwners);
  sharedOwners = memberships;
  if (changed) writeSharedOwners(memberships);

  const seen = readSeenSharedTrips();
  const plan = planSharedTrips(memberships, seen);
  for (const tripId of plan.backfill) {
    if (await backfillSharedTrip(client, tripId)) seen.add(tripId);
  }
  for (const tripId of plan.release) {
    await releaseSharedTrip(tripId, me);
    seen.delete(tripId);
  }
  if (plan.backfill.length > 0 || plan.release.length > 0) writeSeenSharedTrips(seen);

  if (memberships.size > 0) subscribeSharedRealtime();
  subscribeMembershipRealtime();
}

/** 共有の旅行を、過去ぶんまで全部取り込む。全部取れた時だけ true(途中で失敗したら、次の機会にもう一度)。 */
async function backfillSharedTrip(client: SupabaseClient, tripId: string): Promise<boolean> {
  const byName = new Map(registered.map((reg) => [reg.tableName, reg]));
  const trip = await client.from("trips").select("*").eq("id", tripId);
  if (trip.error) return false;
  const children = await Promise.all(TRIP_CHILD_TABLES.map((name) => client.from(name).select("*").eq("trip_id", tripId)));
  if (children.some((result) => result.error)) return false;
  const expenseIndex = TRIP_CHILD_TABLES.indexOf("trip_expenses");
  const expenseIds = ((children[expenseIndex].data ?? []) as { id: string }[]).map((row) => row.id);
  const currencies = expenseIds.length > 0 ? await client.from("trip_expense_currencies").select("*").in("expense_id", expenseIds) : null;
  if (currencies?.error) return false;

  const apply = async (tableName: string, rows: unknown[] | null | undefined) => {
    const reg = byName.get(tableName);
    if (!reg) return;
    for (const row of rows ?? []) await applyRemoteRow(reg, row as Record<string, unknown>);
  };
  await apply("trips", trip.data);
  for (const [index, name] of TRIP_CHILD_TABLES.entries()) await apply(name, children[index].data);
  await apply("trip_expense_currencies", currencies?.data);
  return true;
}

/** 共有が終わった旅行を、この端末から片付ける(サーバーには何も送らない)。
 * 自分の旅行は絶対に消さない — 持ち主が自分(または不明)の旅行は、何があっても触らない。 */
async function releaseSharedTrip(tripId: string, me: string): Promise<void> {
  const byName = new Map(registered.map((reg) => [reg.tableName, reg]));
  const trips = byName.get("trips");
  const local = trips ? ((await trips.table.get(tripId)) as SyncableRow | undefined) : undefined;
  if (local && (!local.userId || local.userId === me)) return;

  const removed: { table: string; rowId: string }[] = [];
  await withSyncSuppressed(async () => {
    const ids = async (reg: RegisteredTable, field: string, values: string | string[]): Promise<string[]> => {
      const clause = reg.table.where(field);
      const keys = Array.isArray(values) ? await clause.anyOf(values).primaryKeys() : await clause.equals(values).primaryKeys();
      return keys as string[];
    };
    const drop = async (reg: RegisteredTable, keys: string[]) => {
      if (keys.length === 0) return;
      await reg.table.bulkDelete(keys);
      for (const rowId of keys) removed.push({ table: reg.tableName, rowId });
    };
    let expenseIds: string[] = [];
    for (const name of TRIP_CHILD_TABLES) {
      const reg = byName.get(name);
      if (!reg) continue;
      const keys = await ids(reg, "tripId", tripId);
      if (name === "trip_expenses") expenseIds = keys;
      await drop(reg, keys);
    }
    const currencies = byName.get("trip_expense_currencies");
    if (currencies && expenseIds.length > 0) await drop(currencies, await ids(currencies, "expenseId", expenseIds));
    if (trips && local) {
      await trips.table.delete(tripId);
      removed.push({ table: "trips", rowId: tripId });
    }
  });

  // 送り待ちが残っていると、権限のない書き込みを繰り返し試して「送れない変更」に見えてしまう。
  // 抑止の旗(withSyncSuppressed)は、同時に走るリアルタイムの反映と重なると途中で戻ることがあるので、少し後にもう一度掃除する。
  const purge = async () => {
    for (const { table, rowId } of removed) {
      try {
        await db.syncQueue.where("[table+rowId]").equals([table, rowId]).delete();
      } catch (err) {
        console.error("[sync] failed to drop a queued change of a released trip:", err);
      }
    }
  };
  await purge();
  setTimeout(() => void purge(), 500);
}

/** 共有の旅行の変更を、リアルタイムで受け取る。絞り込み無しの購読だが、サーバーの RLS が
 * 「自分が見てよい行」だけを流してくる。自分の行は、いつもの購読が受け取っているので二重に反映しない。 */
function subscribeSharedRealtime(): void {
  if (!currentUserId || !dataClient) return;
  for (const reg of registered) {
    if (!(SHARED_TRIP_TABLES as readonly string[]).includes(reg.tableName)) continue;
    const topic = `${reg.tableName}-shared-${currentUserId}`;
    if (subscribedChannels.has(topic)) continue;
    subscribedChannels.add(topic);
    const channel = dataClient
      .channel(topic)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: reg.tableName },
        (payload: { new: Record<string, unknown> | null; old: Record<string, unknown> | null }) => {
          const row = payload.new ?? payload.old;
          if (row && row.user_id !== currentUserId) void applyRemoteRow(reg, row);
        },
      )
      .subscribe();
    realtimeChannels.push(channel);
  }
}

/** 招待が届いた・参加された・外された、を受け取る。034 が無い間は購読しない(無い表を購読して再接続を繰り返さないため)。 */
function subscribeMembershipRealtime(): void {
  if (!currentUserId || !dataClient) return;
  const topic = `trip_members-${currentUserId}`;
  if (subscribedChannels.has(topic)) return;
  subscribedChannels.add(topic);
  const channel = dataClient
    .channel(topic)
    .on("postgres_changes", { event: "*", schema: "public", table: "trip_members" }, () => scheduleSharedRefresh())
    .subscribe();
  realtimeChannels.push(channel);
}

async function startSessionOnce(userId: string, accessToken: string): Promise<void> {
  dataClient = await getSupabaseDataClient();
  await dataClient.realtime.setAuth(accessToken);
  if (currentUserId === userId) return; // already started; token was refreshed above
  stopSession();
  currentUserId = userId;
  // 共有された旅行の行を、最初の送信から持ち主の名前で送れるように、前回確かめた状態を先に読んでおく。
  sharedOwners = readSharedOwners();
  // syncNow()と同じ並列パターン(Promise.all)に揃える — 以前は登録テーブルを1つずつ
  // 直列でreconcileしていたため、テーブル数ぶんのネットワーク往復が積み重なり、
  // App.tsxの起動ゲート(syncReadyになるまで画面が真っ白)を毎回大きく引き延ばしていた
  // (新しいタブを開くたびに再発生するため、特にGmailメール詳細ページで顕著だった)。
  await Promise.all(registered.map((reg) => reconcile(reg)));
  for (const reg of registered) subscribeRealtime(reg);
  await drainQueue();
  // 起動を待たせない(画面は、この関数が終わるまで出ない)。共有の旅行は、取れ次第 Dexie に入って画面が追いつく。
  void refreshSharedTrips();
}

export function startSession(userId: string, accessToken: string): Promise<void> {
  sessionStart = sessionStart.catch(() => undefined).then(() => startSessionOnce(userId, accessToken));
  return sessionStart;
}

export function stopSession(): void {
  currentUserId = null;
  sharedOwners = new Map();
  clearTimeout(sharedRefreshTimer);
  for (const channel of realtimeChannels) dataClient?.removeChannel(channel);
  realtimeChannels.length = 0;
  subscribedChannels.clear();
}

function ensureLifecycleListeners(): void {
  if (lifecycleListenersAttached) return;
  lifecycleListenersAttached = true;
  window.addEventListener("online", () => {
    void drainQueue();
    for (const reg of registered) void reconcile(reg);
    void refreshSharedTrips();
  });

  // Mobile browsers routinely suspend background tabs, which silently drops the
  // Realtime WebSocket without an error — re-sync whenever the app is brought
  // back to the foreground so changes made elsewhere while away show up right away.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void syncNow();
  });
}

/** Enrolls a Dexie table in the PC/スマホ同期 pipeline: local writes get queued
 * and pushed to the matching Supabase table, and remote changes (via Realtime,
 * plus a reconciliation pull on reconnect) get applied back with last-write-wins.
 * Loaded and called by syncRuntime only after Auth has restored a session. */
export function registerSyncedTable<T extends SyncableRow>(table: EntityTable<T, "id">, tableName: string): void {
  if (registeredNames.has(tableName)) return;
  registeredNames.add(tableName);
  const reg: RegisteredTable = { table: table as unknown as EntityTable<SyncableRow, "id">, tableName };
  registered.push(reg);

  (table.hook as any)(
    "creating",
    function (this: { onsuccess?: (primKey: string) => void }, _primKey: string, obj: SyncableRow) {
      if (applyingRemoteChange) return;
      obj.deviceId = getDeviceId();
      if (currentUserId) obj.userId = currentUserId;
      this.onsuccess = (primKey) => enqueueAfterCommit(tableName, primKey, "upsert");
    },
  );

  (table.hook as any)(
    "updating",
    function (this: { onsuccess?: () => void }, _modifications: Partial<SyncableRow>, primKey: string) {
      if (applyingRemoteChange) return undefined;
      this.onsuccess = () => enqueueAfterCommit(tableName, primKey, "upsert");
      return { deviceId: getDeviceId() };
    },
  );

  (table.hook as any)("deleting", function (this: { onsuccess?: () => void }, primKey: string) {
    if (applyingRemoteChange) return;
    this.onsuccess = () => enqueueAfterCommit(tableName, primKey, "delete");
  });

  ensureLifecycleListeners();
  if (currentUserId) {
    void reconcile(reg);
    subscribeRealtime(reg);
  }
}

/** Manually pulls remote changes and pushes any queued local ones. Realtime
 * normally keeps devices in sync live, but mobile browsers can silently drop
 * the WebSocket connection while backgrounded, so this gives users a way to
 * force a refresh instead of waiting for the next natural trigger. No-op
 * when signed out. */
export async function syncNow(): Promise<string> {
  if (!currentUserId) return "ログインしていません";
  // A manual tap is infrequent and explicit, so always pull the full table rather
  // than trusting the incremental watermark — cheap at personal-app data volumes,
  // and it's the one guaranteed way to recover if the watermark ever gets stuck
  // ahead of data it hasn't actually seen (as happened once already).
  const results = await Promise.all(registered.map((reg) => reconcile(reg, true)));
  await refreshSharedTrips();
  const queuedBefore = await db.syncQueue.count();
  await drainQueue();
  const remaining = await db.syncQueue.toArray();
  return describeSyncResult(results, queuedBefore, remaining);
}

/** 同期ボタンのお知らせ。以前は全テーブルの内訳(skipped-echo 等)を1行に並べていて、
 * 成功しているのに「エラーが出た」と読まれた(2026-09-21)。うまくいった時は短く、
 * うまくいかなかった所だけ中身を出す。 */
export function describeSyncResult(results: ReconcileResult[], queuedBefore: number, remaining: SyncQueueEntry[]): string {
  const problems: string[] = [];
  for (const r of results) {
    if (r.error) problems.push(`${syncTableLabel(r.tableName)}を受け取れませんでした（${r.error}）`);
  }
  for (const p of summarizeSyncProblems(remaining)) {
    problems.push(`${p.label}の変更${p.count}件を送れませんでした：${p.message}（${p.detail}）`);
  }
  const unsentOther = remaining.filter((e) => !e.lastError).length;
  if (unsentOther > 0) problems.push(`まだ送れていない変更が${unsentOther}件あります（電波が戻ると送ります）`);
  if (problems.length > 0) return problems.join(" / ");

  const received = results.reduce(
    (sum, r) => sum + (r.outcomes.added ?? 0) + (r.outcomes.updated ?? 0) + (r.outcomes.deleted ?? 0),
    0,
  );
  const sent = queuedBefore - remaining.length;
  const parts = [received > 0 ? `受け取り${received}件` : "", sent > 0 ? `送信${sent}件` : ""].filter(Boolean);
  return parts.length > 0 ? `同期しました（${parts.join("・")}）` : "同期しました（変更はありませんでした）";
}
