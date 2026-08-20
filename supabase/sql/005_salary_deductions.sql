-- 給与CSV取込機能: SalaryEntryに追加した grossAmount(総支給額)・deductions(控除内訳)を
-- 同期できるようにするカラム追加。汎用同期エンジン(src/lib/sync.ts)はcamelCase<->snake_case
-- を単純なキー変換のみで扱うため、ローカル型に生やしたフィールドに対応する列がここに無いと
-- upsertがPostgRESTのスキーマエラーで失敗し、同期キュー全体が詰まる。
--
-- deductionsは { label: string; amount: number }[] という構造化配列なので、
-- 002_full_sync_tables.sql の notes.checklist_items / notes.shopping_items と同じ方針でjsonbにする。

alter table public.salaries
  add column gross_amount numeric,
  add column deductions jsonb;
