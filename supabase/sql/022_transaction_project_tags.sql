-- LIFE HUB: 個人開発の案件タグ(確定申告用の年間集計)を端末間で揃える。
--
-- 【なぜ transactions に列を足さないのか】
-- 2026-09-04 の保留メモでは transactions に project_tag 列を足す案を出していたが、
-- その後の実装で**端末内の別テーブル**(transactionProjectTags)に持つ形になった
-- (src/types/index.ts の TransactionProjectTag)。タグが付くのは個人開発に関わる
-- 収支だけで、家計の大多数の行は空になるため。アプリ側がもう別テーブルの形で
-- 動いているので、Supabase 側もその形に合わせる。
-- 実行しても既存の transactions には一切触らない(新しいテーブルを1つ足すだけ)。
--
-- タグは1件の収支につき1つ(2026-09-04の本人の回答)。自由入力の文字列で、
-- 決まった一覧は持たない(過去に使ったタグを候補に出すだけ)。
--
-- 【実行の順番】このSQLを流しても、アプリはすぐには同期を始めない。
-- 流し終えたら知らせてもらい、そのあとで src/lib/syncRuntime.ts に
--   module.registerSyncedTable(db.transactionProjectTags, "transaction_project_tags");
-- の1行を足す(2段階目)。逆順にすると、テーブルの無いところへ upsert して同期が失敗する。
-- 流す前・流した直後のどちらでも、案件タグと年間集計は端末の中で今までどおり動く。

-- 002_full_sync_tables.sql の他テーブルと同じ作法(021 と同じ)。
create table if not exists public.transaction_project_tags (
  id uuid primary key,
  user_id uuid not null,
  device_id text not null,
  -- transactions.id。収支1件につきタグの行は1つだけ(アプリ側で1つに保っている)。
  -- 外部キー制約は付けない — 021 と同じ理由(行の到着順で弾かれないようにするため)。
  transaction_id uuid not null,
  -- 案件の名前。
  tag text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default now()
);
create index if not exists transaction_project_tags_user_id_idx on public.transaction_project_tags (user_id);
create index if not exists transaction_project_tags_transaction_id_idx on public.transaction_project_tags (transaction_id);
create index if not exists transaction_project_tags_server_updated_at_idx on public.transaction_project_tags (server_updated_at);
alter table public.transaction_project_tags enable row level security;
drop policy if exists "user manages own transaction_project_tags" on public.transaction_project_tags;
create policy "user manages own transaction_project_tags" on public.transaction_project_tags for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop trigger if exists transaction_project_tags_set_server_updated_at on public.transaction_project_tags;
create trigger transaction_project_tags_set_server_updated_at before insert or update on public.transaction_project_tags for each row execute function set_server_updated_at();
alter publication supabase_realtime add table public.transaction_project_tags;
