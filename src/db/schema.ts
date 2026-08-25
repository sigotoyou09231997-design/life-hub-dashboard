import Dexie, { type EntityTable, type Transaction as DexieTransaction } from "dexie";
import { BOOT_DB_NAME, DEFAULT_DB_NAME } from "../lib/accounts";
import type {
  Transaction,
  FixedCost,
  CalendarEvent,
  Task,
  Note,
  Settings,
  PayPayLedgerEntry,
  SalaryEntry,
  Trip,
  TripScheduleItem,
  TripExpense,
  TripPackingItem,
  TripRoutePlace,
  DiaryEntry,
  GmailAccount,
  SyncedEmail,
  DraftReply,
  BlockedSender,
} from "../types";

/** Local-only outbox for the PC/スマホ同期機能: one row per (table, rowId) pending push to Supabase. */
export interface SyncQueueEntry {
  id?: number;
  table: string;
  rowId: string;
  op: "upsert" | "delete";
  queuedAt: number;
}

interface TableSchema {
  name: string;
  /** Dexie index string, excluding the primary key. */
  indexes: string;
  fks: { field: string; refTable: string }[];
  /** True for tables whose type carries `updatedAt` — these get it auto-stamped
   * on every create/update, independent of whether sync is registered for them
   * yet (see the hook loop at the bottom of the constructor). */
  hasUpdatedAt: boolean;
}

/** The app's runtime table list: drives the UUID/updatedAt hooks at the bottom of
 * the constructor. Adding a table here does not enroll it in sync (see
 * src/lib/sync.ts's registerSyncedTable calls). */
const TABLE_SCHEMAS: TableSchema[] = [
  { name: "transactions", indexes: "type, date, category, externalId", fks: [], hasUpdatedAt: true },
  { name: "fixedCosts", indexes: "", fks: [], hasUpdatedAt: true },
  { name: "calendarEvents", indexes: "date", fks: [], hasUpdatedAt: true },
  {
    name: "tasks",
    indexes: "dueDate, parentTaskId",
    fks: [{ field: "parentTaskId", refTable: "tasks" }],
    hasUpdatedAt: true,
  },
  { name: "notes", indexes: "*tags", fks: [], hasUpdatedAt: true },
  { name: "settings", indexes: "", fks: [], hasUpdatedAt: false },
  { name: "paypayTransactions", indexes: "externalId, importedAt", fks: [], hasUpdatedAt: true },
  { name: "salaries", indexes: "month", fks: [], hasUpdatedAt: true },
  { name: "trips", indexes: "", fks: [], hasUpdatedAt: true },
  { name: "tripSchedule", indexes: "tripId", fks: [{ field: "tripId", refTable: "trips" }], hasUpdatedAt: true },
  { name: "tripExpenses", indexes: "tripId", fks: [{ field: "tripId", refTable: "trips" }], hasUpdatedAt: true },
  { name: "tripPackingItems", indexes: "tripId", fks: [{ field: "tripId", refTable: "trips" }], hasUpdatedAt: true },
  { name: "gmailAccounts", indexes: "email", fks: [], hasUpdatedAt: false },
  {
    name: "syncedEmails",
    indexes: "accountId, gmailMessageId, receivedAt, status, [accountId+gmailMessageId]",
    fks: [{ field: "accountId", refTable: "gmailAccounts" }],
    hasUpdatedAt: false,
  },
  {
    name: "draftReplies",
    indexes: "emailId, accountId, status",
    fks: [
      { field: "emailId", refTable: "syncedEmails" },
      { field: "accountId", refTable: "gmailAccounts" },
    ],
    hasUpdatedAt: true,
  },
];

/** 日記・目標・習慣で使っていた、v11で削除済みのテーブル。もう画面も型も無いが、
 * v6-v9のUUID移行チェーンはこの4つを含んだ当時の形のまま再現しないといけない —
 * ここから外すと、v8で主キーを文字列idに作り直した実DBに対して、Dexieがv1の
 * `++id`(自動採番の数値)を突き合わせて「主キーの変更は未サポート」で開けなくなる。
 * v11の削除もチェーンを最後まで通ってからでないと効かないため、履歴として残す。 */
const RETIRED_TABLE_SCHEMAS: TableSchema[] = [
  { name: "diaryEntries", indexes: "date", fks: [], hasUpdatedAt: true },
  { name: "goals", indexes: "deadline", fks: [], hasUpdatedAt: true },
  { name: "habits", indexes: "", fks: [], hasUpdatedAt: true },
  {
    name: "habitLogs",
    indexes: "habitId, date, [habitId+date]",
    fks: [{ field: "habitId", refTable: "habits" }],
    hasUpdatedAt: true,
  },
];

/** v6-v9のUUID移行チェーンが見るテーブル一覧(当時存在した全テーブル)。 */
const MIGRATION_TABLE_SCHEMAS: TableSchema[] = [...TABLE_SCHEMAS, ...RETIRED_TABLE_SCHEMAS];

/** UUID移行チェーン(v6-v9)が済んだ後に足したテーブル。TABLE_SCHEMASには入れられない —
 * あの配列はMIGRATION_TABLE_SCHEMASを通じてチェーンにも流れ込むので、加えると新規
 * インストール時にv6がまだ作られていないテーブルを読みにいって開けなくなる。主キーは
 * 最初からUUID文字列なので移行そのものが要らず、フックだけここから登録する。 */
const POST_MIGRATION_TABLE_SCHEMAS: TableSchema[] = [
  { name: "blockedSenders", indexes: "accountId, email, [accountId+email]", fks: [], hasUpdatedAt: false },
  { name: "tripRoutePlaces", indexes: "tripId", fks: [], hasUpdatedAt: true },
  { name: "diaryEntries", indexes: "date", fks: [], hasUpdatedAt: true },
];

/** UUID採番・updatedAt付与のフックを張る対象(移行の有無は関係なく全テーブル)。 */
const HOOKED_TABLE_SCHEMAS: TableSchema[] = [...TABLE_SCHEMAS, ...POST_MIGRATION_TABLE_SCHEMAS];

function withStringId(indexes: string): string {
  return indexes ? `id, ${indexes}` : "id";
}

/** Reads every row of every migrating table twice: once to mint a UUID per
 * old numeric id, once more to write the row (with FK fields remapped
 * through the id maps built in the first pass) into the parallel `_v2`
 * table. Both passes must run to completion across ALL tables before any
 * row is written, since FKs can point at rows that sort later in the list
 * (e.g. tasks.parentTaskId points back into tasks itself). */
async function migrateToUuidIds(tx: DexieTransaction): Promise<void> {
  const idMaps = new Map<string, Map<number, string>>();

  for (const schema of MIGRATION_TABLE_SCHEMAS) {
    const rows: Record<string, unknown>[] = await tx.table(schema.name).toArray();
    const map = new Map<number, string>();
    for (const row of rows) {
      map.set(row.id as number, crypto.randomUUID());
    }
    idMaps.set(schema.name, map);
  }

  for (const schema of MIGRATION_TABLE_SCHEMAS) {
    const rows: Record<string, unknown>[] = await tx.table(schema.name).toArray();
    if (rows.length === 0) continue;
    const remapped = rows.map((row) => {
      const newRow: Record<string, unknown> = { ...row, id: idMaps.get(schema.name)!.get(row.id as number) };
      for (const fk of schema.fks) {
        const oldValue = row[fk.field] as number | undefined;
        newRow[fk.field] = oldValue != null ? (idMaps.get(fk.refTable)!.get(oldValue) ?? null) : oldValue;
      }
      return newRow;
    });
    await tx.table(`${schema.name}_v2`).bulkAdd(remapped);
  }
}

export class LifeHubDB extends Dexie {
  transactions!: EntityTable<Transaction, "id">;
  fixedCosts!: EntityTable<FixedCost, "id">;
  calendarEvents!: EntityTable<CalendarEvent, "id">;
  tasks!: EntityTable<Task, "id">;
  notes!: EntityTable<Note, "id">;
  settings!: EntityTable<Settings, "id">;
  paypayTransactions!: EntityTable<PayPayLedgerEntry, "id">;
  salaries!: EntityTable<SalaryEntry, "id">;
  trips!: EntityTable<Trip, "id">;
  tripSchedule!: EntityTable<TripScheduleItem, "id">;
  tripExpenses!: EntityTable<TripExpense, "id">;
  tripPackingItems!: EntityTable<TripPackingItem, "id">;
  tripRoutePlaces!: EntityTable<TripRoutePlace, "id">;
  diaryEntries!: EntityTable<DiaryEntry, "id">;
  gmailAccounts!: EntityTable<GmailAccount, "id">;
  syncedEmails!: EntityTable<SyncedEmail, "id">;
  draftReplies!: EntityTable<DraftReply, "id">;
  blockedSenders!: EntityTable<BlockedSender, "id">;
  syncQueue!: EntityTable<SyncQueueEntry, "id">;

  /** DB名はアカウントごとに変える(src/lib/accounts.ts)。同じ端末で2つのアカウントを
   * 持てるようにするための唯一の仕掛けで、画面側は今まで通り db をそのまま読むだけでよい。 */
  constructor(dbName: string = DEFAULT_DB_NAME) {
    super(dbName);

    // Note: IndexedDB key paths cannot be boolean, so flags like isFixed/active/
    // completed/pinned are intentionally left un-indexed and filtered in JS.
    this.version(1).stores({
      transactions: "++id, type, date, category",
      fixedCosts: "++id",
      calendarEvents: "++id, date",
      tasks: "++id, dueDate, parentTaskId",
      notes: "++id, *tags",
      diaryEntries: "++id, date",
      goals: "++id, deadline",
      habits: "++id",
      habitLogs: "++id, habitId, date, [habitId+date]",
      settings: "++id",
    });

    this.version(2).stores({
      transactions: "++id, type, date, category, externalId",
      paypayTransactions: "++id, externalId, importedAt",
    });

    this.version(3).stores({
      salaries: "++id, month",
    });

    this.version(4).stores({
      trips: "++id",
      tripSchedule: "++id, tripId",
      tripExpenses: "++id, tripId",
      tripPackingItems: "++id, tripId",
    });

    // Gmail連携用。refreshTokenとメール本文を含むため、バックアップ書き出し(backup.ts)の対象からは意図的に除外する。
    this.version(5).stores({
      gmailAccounts: "++id, email",
      syncedEmails: "++id, accountId, gmailMessageId, receivedAt, status, [accountId+gmailMessageId]",
      draftReplies: "++id, emailId, accountId, status",
    });

    // v6-v9: PC/スマホ同期機能の前提として、全テーブルの主キーを端末ごとの連番整数(++id)から
    // 端末間で衝突しないUUID文字列へ移行する。Dexieは1バージョン内でのキー仕様変更(型変更含む)を
    // サポートしないため、並行テーブル(_v2)へコピー→旧テーブル削除→本来の名前で再作成→_v2削除、
    // という4バージョンの連続移行にする(ユーザーには初回起動時の一瞬の処理として見えるだけ)。
    const v2Stores: Record<string, string> = { syncQueue: "++id, [table+rowId]" };
    for (const schema of MIGRATION_TABLE_SCHEMAS) {
      v2Stores[`${schema.name}_v2`] = withStringId(schema.indexes);
    }
    this.version(6)
      .stores(v2Stores)
      .upgrade((tx) => migrateToUuidIds(tx));

    const dropOriginals: Record<string, null> = {};
    for (const schema of MIGRATION_TABLE_SCHEMAS) dropOriginals[schema.name] = null;
    this.version(7).stores(dropOriginals);

    const recreatedStores: Record<string, string> = {};
    for (const schema of MIGRATION_TABLE_SCHEMAS) recreatedStores[schema.name] = withStringId(schema.indexes);
    this.version(8)
      .stores(recreatedStores)
      .upgrade(async (tx) => {
        for (const schema of MIGRATION_TABLE_SCHEMAS) {
          const rows = await tx.table(`${schema.name}_v2`).toArray();
          if (rows.length) await tx.table(schema.name).bulkAdd(rows);
        }
      });

    const dropV2: Record<string, null> = {};
    for (const schema of MIGRATION_TABLE_SCHEMAS) dropV2[`${schema.name}_v2`] = null;
    this.version(9).stores(dropV2);

    // ブロックした送信者(このアプリ内でのみ受信一覧から除外、Gmail本体には影響しない)。
    // TABLE_SCHEMASには加えない — その配列はMIGRATION_TABLE_SCHEMAS経由でv6-v9のUUID
    // 移行チェーンにも流れ込んでおり、
    // 追加すると新規インストール時にそのチェーンがこのテーブルをまだ存在しない時点で
    // 参照してしまう。UUID採番フックはこのテーブル専用に個別登録する。
    this.version(10).stores({
      blockedSenders: "id, accountId, email, [accountId+email]",
    });

    // 日記・目標・習慣を廃止(画面ごと削除)したので、その4テーブルを落として端末から
    // データも消す。移行チェーン(v6-v9)は当時の形のままRETIRED_TABLE_SCHEMASを含めて
    // 走らせ、最後にここで削除する — チェーンから外すとDexieが主キーの不一致を見て
    // DBごと開けなくなる(RETIRED_TABLE_SCHEMASのコメント参照)。
    this.version(11).stores({
      diaryEntries: null,
      goals: null,
      habits: null,
      habitLogs: null,
    });

    // 旅行の「行きたい場所」(ルート)。v10のblockedSendersと同じくTABLE_SCHEMASには
    // 加えず、ここで作ってPOST_MIGRATION_TABLE_SCHEMAS側からフックを張る。
    this.version(12).stores({
      tripRoutePlaces: "id, tripId",
    });

    // 日記を作り直す。v11で一度落とした同じ名前のテーブルだが、中身は別物
    // (本文と気分に加えて、書いた場所の緯度経度を持つ)。v11の削除より後の
    // バージョンで作るので、古い端末でも「落としてから作る」の順で流れる。
    this.version(13).stores({
      diaryEntries: "id, date",
    });

    // UUID移行後は主キーが自動採番されないため、明示的にidを渡さなかった.add()呼び出しに
    // UUIDを補うフックを全テーブルへ登録する(Dexie公式が示すUUID主キーの標準パターン)。
    for (const schema of HOOKED_TABLE_SCHEMAS) {
      this.table(schema.name).hook("creating", (_primKey, obj: { id?: string }) => {
        if (!obj.id) obj.id = crypto.randomUUID();
      });
    }

    // updatedAtはLWW同期の判定に使うため、同期対象になり得るテーブルでは常にDB層で付与する
    // (まだsrc/lib/sync.tsのregisterSyncedTableを呼んでいないテーブルの.add()/.update()呼び出し
    // 側を書き換えずに済ませるため)。
    for (const schema of HOOKED_TABLE_SCHEMAS.filter((s) => s.hasUpdatedAt)) {
      this.table(schema.name).hook("creating", (_primKey, obj: { updatedAt?: number }) => {
        if (obj.updatedAt === undefined) obj.updatedAt = Date.now();
      });
      (this.table(schema.name).hook as any)(
        "updating",
        function (modifications: Record<string, unknown>, _primKey: unknown, _obj: unknown, _transaction: unknown) {
          if (modifications.updatedAt === undefined) return { updatedAt: Date.now() };
          return undefined;
        },
      );
    }
  }
}

export const db = new LifeHubDB(BOOT_DB_NAME);

export async function ensureDefaultSettings(): Promise<Settings> {
  const existing = await db.settings.toCollection().first();
  if (existing) return existing;

  const defaults: Settings = {
    monthlyIncome: 0,
    savingsGoalMonthly: 0,
    paypayBalance: 0,
    paypayBalanceUpdatedAt: 0,
    autoDraftEnabled: false,
  };
  const id = await db.settings.add(defaults);
  return { ...defaults, id };
}
