// 本番の Supabase に、アプリが同期で送る列が全部あるかを、ビルドの前に確かめる。
//
// 同期(src/lib/sync.ts)は行の項目を camelCase → snake_case にしてそのまま upsert する。
// アプリに項目を足したのに、その列を作る supabase/sql を本番で流し忘れると、その行は
// 「そんな列は無い」で弾かれる。2026-09-21 に 017/018 の流し忘れで実際に3週間以上
// 同期が止まった。SQL は人が流すものなので、流す前のアプリを出さないようにここで止める。
//
// 表の定義は公開鍵では読めない(PostgREST の / は secret キーが要る)ので、列ごとに
// `select=<列>&limit=0` を投げる。無い列は 42703、無い表は PGRST205/42P01 で返る。
// RLS があるので中身は1行も返らない。
//
// 止めるのは「無い」と確定した時だけ。鍵が無い・通信できない時は警告だけ出して通す
// (Supabase の一時的な不調でデプロイできなくなる方が困るため)。
//
//   node scripts/check-prod-schema.mjs         ← npm run build の最初に走る
//   SKIP_PROD_SCHEMA_CHECK=1 npm run build     ← どうしても飛ばす時

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** sync.ts が全テーブルに必ず付けて送る列。 */
const ALWAYS_SENT = ["id", "user_id", "device_id", "deleted_at"];

function camelToSnake(key) {
  return key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
}

function interfaceFields(typesSource, name) {
  const match = new RegExp(`export interface ${name}\\b[^{]*\\{([\\s\\S]*?)\\n\\}`).exec(typesSource);
  if (!match) return null;
  const body = match[1].replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  // 2文字下げの行だけが自分の項目。入れ子の型({ ... })の中身は拾わない。
  return [...body.matchAll(/^ {2}(\w+)\??:/gm)].map((m) => m[1]);
}

/** 同期に登録されているテーブルごとに、送りうる列の一覧を作る。 */
export function expectedColumns(root = ROOT) {
  const runtime = readFileSync(join(root, "src/lib/syncRuntime.ts"), "utf8");
  const schema = readFileSync(join(root, "src/db/schema.ts"), "utf8");
  const types = readFileSync(join(root, "src/types/index.ts"), "utf8");
  const tables = [];
  for (const [, dexieName, tableName] of runtime.matchAll(/registerSyncedTable\(db\.(\w+),\s*"(\w+)"\)/g)) {
    const iface = new RegExp(`\\b${dexieName}!:\\s*EntityTable<(\\w+)`).exec(schema)?.[1];
    if (!iface) throw new Error(`src/db/schema.ts で db.${dexieName} の型が見つからない`);
    const fields = interfaceFields(types, iface);
    if (!fields) throw new Error(`src/types/index.ts に interface ${iface} が見つからない`);
    const columns = [...new Set([...fields.map(camelToSnake), ...ALWAYS_SENT])];
    tables.push({ tableName, iface, columns });
  }
  return tables;
}

/** その列を作っている SQL ファイルを探す(案内用)。 */
function sqlFileFor(root, tableName, column) {
  const dir = join(root, "supabase/sql");
  if (!existsSync(dir)) return null;
  const pattern = new RegExp(`${tableName}[\\s\\S]*?\\b${column}\\b`);
  return readdirSync(dir).filter((f) => f.endsWith(".sql")).sort().find((f) => pattern.test(readFileSync(join(dir, f), "utf8"))) ?? null;
}

function loadEnv(root) {
  const env = { url: process.env.VITE_SUPABASE_URL, key: process.env.VITE_SUPABASE_ANON_KEY };
  const file = join(root, ".env");
  if ((!env.url || !env.key) && existsSync(file)) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const m = /^\s*(VITE_SUPABASE_URL|VITE_SUPABASE_ANON_KEY)\s*=\s*"?([^"\s]*)"?/.exec(line);
      if (m && m[1] === "VITE_SUPABASE_URL") env.url ||= m[2];
      if (m && m[1] === "VITE_SUPABASE_ANON_KEY") env.key ||= m[2];
    }
  }
  return env;
}

/** "ok" | "missing-column" | "missing-table" | "unknown:<理由>" */
async function probe(env, tableName, column) {
  try {
    const res = await fetch(`${env.url}/rest/v1/${tableName}?select=${column}&limit=0`, {
      headers: { apikey: env.key, Authorization: `Bearer ${env.key}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) return "ok";
    const body = await res.text();
    if (/"42703"/.test(body)) return "missing-column";
    if (/"PGRST205"|"42P01"/.test(body)) return "missing-table";
    return `unknown:HTTP ${res.status} ${body.slice(0, 120)}`;
  } catch (err) {
    return `unknown:${err instanceof Error ? err.message : String(err)}`;
  }
}

async function main() {
  if (process.env.SKIP_PROD_SCHEMA_CHECK === "1") {
    console.log("[本番の列チェック] SKIP_PROD_SCHEMA_CHECK=1 なので飛ばします");
    return;
  }
  const env = loadEnv(ROOT);
  if (!env.url || !env.key) {
    console.warn("[本番の列チェック] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY が無いので飛ばします");
    return;
  }

  const tables = expectedColumns();
  const missing = [];
  const unknown = [];
  await Promise.all(
    tables.map(async ({ tableName, columns }) => {
      const tableState = await probe(env, tableName, "id");
      if (tableState === "missing-table") {
        missing.push({ tableName, column: null });
        return;
      }
      if (tableState !== "ok") {
        unknown.push(`${tableName}: ${tableState.slice("unknown:".length)}`);
        return;
      }
      for (const column of columns) {
        const state = await probe(env, tableName, column);
        if (state === "missing-column") missing.push({ tableName, column });
        else if (state !== "ok") unknown.push(`${tableName}.${column}: ${state.slice("unknown:".length)}`);
      }
    }),
  );

  if (unknown.length > 0) {
    console.warn(`[本番の列チェック] 確かめられなかった所があります(止めずに続けます):\n  ${unknown.slice(0, 5).join("\n  ")}`);
  }
  if (missing.length === 0) {
    const count = tables.reduce((n, t) => n + t.columns.length, 0);
    console.log(`[本番の列チェック] OK — ${tables.length}テーブル・${count}列すべて本番にあります`);
    return;
  }

  console.error("\n[本番の列チェック] 本番の Supabase に、同期で送る列/表がありません。このまま出すと同期が止まります。");
  for (const { tableName, column } of missing) {
    const file = sqlFileFor(ROOT, tableName, column ?? "create table");
    const what = column ? `${tableName}.${column}（列）` : `${tableName}（表ごと）`;
    console.error(`  - ${what}${file ? `  ← supabase/sql/${file} を本番で流す` : "  ← これを作る SQL がまだ無い"}`);
  }
  console.error(
    "\n先に Supabase の SQL Editor で上の SQL を流してから、もう一度ビルドしてください。" +
      "\n(新しい表の場合は、流すまで src/lib/syncRuntime.ts に registerSyncedTable を足さない)\n",
  );
  process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
