-- LIFE HUB: サブスク管理(お金管理の「サブスク」タブ、2026-10-12・参考: App Store の「サブスクBOX」)の
-- 付け足しを、端末間で揃える。
--
-- 【なぜ要るか】
-- 固定費をサブスクとして扱うために、年払い・請求の月・契約を始めた日・無料体験が終わる日・
-- 解約した日・どのサービスか(アイコンの色)を持つようにした。いまはそれが登録した端末の中
-- (Dexie の subscriptionDetails)にしか無いので、PCで「年払い」にしたものがスマホでは毎月払いに
-- 見える。このテーブルが入ると、どの端末でも同じに見える。
-- サーバーの支払日通知(netlify/functions/checkRemindersAndNotify.ts)と使いすぎ予測
-- (checkBudgetAndNotify.ts)も、このテーブルを読んで年払い・無料体験を正しく数えるようになる
-- (テーブルが無いうちは、どちらもいままでどおり「毎月払い」として数える)。
--
-- 固定費の行(fixed_costs)に列を足さずに別テーブルにしたのは、足した列が本番に無いうちに
-- アプリが送ると fixed_costs の同期そのものが止まるため(021/022/025 と同じ判断)。
--
-- 【実行しても既存のデータには触らない】新しいテーブルを1つ足すだけ。
-- 流す前・流した直後のどちらでも、サブスクの画面は登録した端末の中で今までどおり動く。
--
-- 【実行の順番】025/026 と同じ2段構え。このSQLを流しても、アプリはすぐには同期を始めない。
-- 流し終えたら知らせてもらい、そのあとで src/lib/syncRuntime.ts に
--   module.registerSyncedTable(db.subscriptionDetails, "subscription_details");
-- の1行を足す(2段階目)。逆順にすると、テーブルの無いところへ upsert して同期が失敗し、
-- 送信の待ち行列がそこで止まって**他のテーブルぶんまで送れなくなる**。

-- 002_full_sync_tables.sql の他テーブルと同じ作法(021/022/025 と同じ)。
create table if not exists public.subscription_details (
  id uuid primary key,
  user_id uuid not null,
  device_id text not null,
  -- fixed_costs.id。外部キーは張らない — 同期は行ごとに届く順番が決まっていないので、
  -- 固定費より先にこの行が届くと拒否されて待ち行列が止まるため。
  fixed_cost_id uuid not null,
  -- 'monthly' か 'yearly'。
  cycle text not null default 'monthly',
  -- 年払いの請求月(1〜12)。日は fixed_costs.due_day。
  billing_month integer,
  -- 「人気サービスから追加」のお手本の名前(src/lib/subscriptionTemplates.ts)。
  service_key text,
  -- 日付は他の表(tasks.due_date など)と同じ date。アプリは YYYY-MM-DD の文字列で読み書きする。
  start_date date,
  trial_end_date date,
  cancelled_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default now()
);
create index if not exists subscription_details_user_id_idx on public.subscription_details (user_id);
create index if not exists subscription_details_fixed_cost_id_idx on public.subscription_details (fixed_cost_id);
create index if not exists subscription_details_server_updated_at_idx on public.subscription_details (server_updated_at);
alter table public.subscription_details enable row level security;
drop policy if exists "user manages own subscription_details" on public.subscription_details;
create policy "user manages own subscription_details" on public.subscription_details for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop trigger if exists subscription_details_set_server_updated_at on public.subscription_details;
create trigger subscription_details_set_server_updated_at before insert or update on public.subscription_details for each row execute function set_server_updated_at();
alter publication supabase_realtime add table public.subscription_details;

-- ChatGPT など OAuth で接続したアプリのトークンは、この表に触れない(028・029 と同じ決まり)。
drop policy if exists "oauth clients blocked" on public.subscription_details;
create policy "oauth clients blocked" on public.subscription_details as restrictive for all to authenticated
  using ((auth.jwt() ->> 'client_id') is null) with check ((auth.jwt() ->> 'client_id') is null);
