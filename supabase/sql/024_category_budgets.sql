-- LIFE HUB: カテゴリ別予算(「食費は月3万円まで」)を端末間で揃える。
--
-- 【なぜ要るか】
-- 「使いすぎ予測アラート」(このままだと給料日までに食費が超えそう)は、いま
-- アプリを開いた時にしか出せない — 予測に要る CategoryBudget が端末の中
-- (Dexie の categoryBudgets)にしか無く、通知を送るサーバー
-- (netlify/functions/checkBudgetAndNotify.ts)からは見えないため。
-- 判定に使う給与・固定費・支出はすでに Supabase にあるので、足りないのは上限だけ。
-- このテーブルが入ると、開いていない日でも Web Push で先に知らせられる。
--
-- 【実行しても既存のデータには触らない】新しいテーブルを1つ足すだけ。
-- 流す前・流した直後のどちらでも、カテゴリ予算と画面の予測は端末の中で今までどおり動く。
--
-- 【実行の順番】021/022 と同じ2段構え。このSQLを流しても、アプリはすぐには同期を始めない。
-- 流し終えたら知らせてもらい、そのあとで src/lib/syncRuntime.ts に
--   module.registerSyncedTable(db.categoryBudgets, "category_budgets");
-- の1行を足す(2段階目)。逆順にすると、テーブルの無いところへ upsert して同期が失敗し、
-- 送信の待ち行列がそこで止まって**他のテーブルぶんまで送れなくなる**。
-- 通知の側(checkBudgetAndNotify.ts)はもう入っているが、行が1件も無いうちは
-- 何も送らないので、流す前でも害はない。

-- 002_full_sync_tables.sql の他テーブルと同じ作法(021/022 と同じ)。
create table if not exists public.category_budgets (
  id uuid primary key,
  user_id uuid not null,
  device_id text not null,
  -- 支出のカテゴリ名(src/lib/categories.ts の EXPENSE_CATEGORIES と同じ文字列)。
  -- 一意制約は付けない — 端末側も1カテゴリ1行をアプリで保っているだけで、
  -- ここで弾くと同期の行が拒否されて待ち行列が止まるため。
  category text not null,
  -- 1か月あたりの上限(円)。集計は給料日から次の給料日までの1期で見る
  -- (src/lib/categoryBudget.ts)。
  monthly_amount numeric not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default now()
);
create index if not exists category_budgets_user_id_idx on public.category_budgets (user_id);
create index if not exists category_budgets_server_updated_at_idx on public.category_budgets (server_updated_at);
alter table public.category_budgets enable row level security;
drop policy if exists "user manages own category_budgets" on public.category_budgets;
create policy "user manages own category_budgets" on public.category_budgets for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop trigger if exists category_budgets_set_server_updated_at on public.category_budgets;
create trigger category_budgets_set_server_updated_at before insert or update on public.category_budgets for each row execute function set_server_updated_at();
alter publication supabase_realtime add table public.category_budgets;
