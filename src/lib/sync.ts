import type { EntityTable } from "dexie";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { db } from "../db/schema";
import { getDeviceId } from "./deviceId";

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
let authListenerAttached = false;

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
  return `lifeHubLastSynced:${tableName}`;
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
          await supabase.from(entry.table).update({ deleted_at: new Date().toISOString() }).eq("id", entry.rowId);
        } else {
          const row = await reg.table.get(entry.rowId);
          if (row) {
            const { error } = await supabase.from(entry.table).upsert(rowToSnake({ ...row, userId: currentUserId, deletedAt: null }));
            if (error) throw error;
          }
        }
        await db.syncQueue.delete(entry.id);
      } catch (err) {
        console.error("[sync] failed to push a queued change, will retry later:", err);
        break; // network/RLS error — leave the rest queued, retry on the next trigger
      }
    }
  } finally {
    draining = false;
  }
}

async function applyRemoteRow(reg: RegisteredTable, remoteRow: Record<string, unknown>): Promise<void> {
  const camel = rowToCamel(remoteRow) as SyncableRow & { deletedAt?: number | string | null };
  if (!camel.id) return;
  if (camel.deviceId && camel.deviceId === getDeviceId()) return; // echo of our own write

  applyingRemoteChange = true;
  try {
    if (camel.deletedAt) {
      await reg.table.delete(camel.id);
      return;
    }
    const local = await reg.table.get(camel.id);
    if (local && (local.updatedAt ?? 0) > (camel.updatedAt ?? 0)) return; // local wins (LWW)

    const { deletedAt: _deletedAt, ...rest } = camel;
    if (local) {
      await reg.table.update(camel.id, rest);
    } else {
      await reg.table.add(rest as SyncableRow);
    }
  } finally {
    applyingRemoteChange = false;
  }
}

async function reconcile(reg: RegisteredTable): Promise<void> {
  if (!currentUserId) return;
  const key = lastSyncedKey(reg.tableName);
  const since = localStorage.getItem(key) ?? new Date(0).toISOString();
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase.from(reg.tableName).select("*").gte("updated_at", since);
  if (error) return;
  for (const row of data ?? []) {
    await applyRemoteRow(reg, row as Record<string, unknown>);
  }
  localStorage.setItem(key, nowIso);
}

const subscribedChannels = new Set<string>();

function subscribeRealtime(reg: RegisteredTable): void {
  if (!currentUserId) return;
  const topic = `${reg.tableName}-${currentUserId}`;
  if (subscribedChannels.has(topic)) return; // defense in depth against double-start races
  subscribedChannels.add(topic);
  const channel = supabase
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

async function startSession(userId: string): Promise<void> {
  if (currentUserId === userId) return; // already started for this user
  currentUserId = userId;
  for (const reg of registered) {
    await reconcile(reg);
    subscribeRealtime(reg);
  }
  await drainQueue();
}

function stopSession(): void {
  currentUserId = null;
  for (const channel of realtimeChannels) supabase.removeChannel(channel);
  realtimeChannels.length = 0;
  subscribedChannels.clear();
}

function ensureAuthListener(): void {
  if (authListenerAttached) return;
  authListenerAttached = true;

  // onAuthStateChange fires once immediately with the current session on subscribe
  // (event "INITIAL_SESSION"), then again on every future change — a separate
  // getSession() call here would race it and start the session twice.
  supabase.auth.onAuthStateChange((_event, session) => {
    const userId = session?.user.id ?? null;
    if (userId === currentUserId) return;
    stopSession();
    if (userId) void startSession(userId);
  });

  window.addEventListener("online", () => {
    void drainQueue();
    for (const reg of registered) void reconcile(reg);
  });
}

/** Enrolls a Dexie table in the PC/スマホ同期 pipeline: local writes get queued
 * and pushed to the matching Supabase table, and remote changes (via Realtime,
 * plus a reconciliation pull on reconnect) get applied back with last-write-wins.
 * A no-op until a Supabase session exists — call this unconditionally at startup;
 * it starts itself the moment the user signs in and tears down on sign-out. */
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

  ensureAuthListener();
  if (currentUserId) {
    void reconcile(reg);
    subscribeRealtime(reg);
  }
}
