import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * 同期の列名は sync.ts の camelToSnake が「アプリ側の項目名から機械的に」作る。
 * つまり Supabase 側の列名と項目名が1文字でも食い違うと、その行は
 *   「そんな列は無い」／「not null の列が埋まっていない」
 * で upsert に失敗する。しかも drainQueue は1件失敗するとそこで break するので、
 * **他のテーブルぶんの送信まで止まる**。
 *
 * 2026-09-04 に実際にこれをやりかけた: 021 が exchange_rate という列を作ったのに
 * アプリ側は rate という名前で持っていて、そのまま登録するところだった。
 * SQL は人が本番で流すもの＝あとから直せないので、ここで食い違いを止める。
 */

function camelToSnake(key: string): string {
  return key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
}

function sqlPath(name: string): string {
  return fileURLToPath(new URL(`../../supabase/sql/${name}`, import.meta.url));
}

interface Column {
  name: string;
  notNull: boolean;
  hasDefault: boolean;
}

/** `create table ... (...)` の中身から列を拾う(制約行・コメント行は落とす)。 */
function columnsOf(file: string, table: string): Column[] {
  const sql = readFileSync(sqlPath(file), "utf8").replace(/--[^\n]*/g, "");
  const body = new RegExp(`create table if not exists public\\.${table}\\s*\\(([\\s\\S]*?)\\n\\);`).exec(sql);
  if (!body) throw new Error(`${file} に ${table} の create table が見つからない`);
  return body[1]
    .split(",\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({
      name: line.split(/\s+/)[0],
      notNull: /\bnot null\b/.test(line),
      hasDefault: /\bdefault\b/.test(line),
    }));
}

/** sync.ts が全テーブルに必ず足すもの(registerSyncedTable のフックと drainQueue)。 */
const ALWAYS_SUPPLIED = ["id", "user_id", "device_id", "deleted_at", "server_updated_at"];

/**
 * アプリが実際に持っている項目。types/index.ts の interface は実行時に読めないので
 * ここに写す。片方だけ直すと下の検査で落ちるので、写し忘れは気づける。
 */
const LOCAL_FIELDS: Record<string, { file: string; fields: string[] }> = {
  trip_expense_currencies: {
    file: "021_trip_expense_currencies.sql",
    // types/index.ts の TripExpenseCurrency
    fields: ["id", "expenseId", "currency", "originalAmount", "exchangeRate", "rateSource", "createdAt", "updatedAt"],
  },
  transaction_project_tags: {
    file: "022_transaction_project_tags.sql",
    // types/index.ts の TransactionProjectTag
    fields: ["id", "transactionId", "tag", "createdAt", "updatedAt"],
  },
};

describe("同期テーブルの列名が、アプリ側の項目名と噛み合っている", () => {
  for (const [table, { file, fields }] of Object.entries(LOCAL_FIELDS)) {
    const columns = columnsOf(file, table);
    const columnNames = columns.map((c) => c.name);
    const sent = fields.map(camelToSnake);

    it(`${table}: アプリが送る列は、すべて Supabase 側にある`, () => {
      expect(columnNames).toEqual(expect.arrayContaining(sent));
    });

    it(`${table}: 埋めないと弾かれる列(not null で既定値なし)を、アプリが必ず送っている`, () => {
      const required = columns
        .filter((c) => c.notNull && !c.hasDefault && !ALWAYS_SUPPLIED.includes(c.name))
        .map((c) => c.name);
      expect(sent).toEqual(expect.arrayContaining(required));
    });
  }
});
