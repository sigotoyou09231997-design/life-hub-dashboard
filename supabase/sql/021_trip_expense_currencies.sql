-- LIFE HUB: 海外旅行の支出を「現地通貨でいくら払ったか」まで端末間で揃える。
--
-- 【なぜ trip_expenses に列を足さないのか】
-- 2026-09-04 の保留メモでは trip_expenses に currency / original_amount / exchange_rate の
-- 3列を足す案を出していたが、その後の実装で**端末内の別テーブル**(tripExpenseCurrencies)に
-- 持つ形になった(src/types/index.ts の TripExpenseCurrency)。理由は2つ:
--   1. 円の金額(trip_expenses.amount)は今までどおりで、合計・予算・予算超過の通知が
--      どれも amount を見たままでよい。通貨の内訳は「付いていれば見る」だけの別物。
--   2. 通貨の行が付くのは海外旅行の支出だけで、大多数の行は3列とも空になる。
-- アプリ側がもう別テーブルの形で動いているので、Supabase 側もその形に合わせる。
-- 実行しても既存の trip_expenses には一切触らない(新しいテーブルを1つ足すだけ)。
--
-- 【実行の順番】このSQLを流しても、アプリはすぐには同期を始めない。
-- 流し終えたら知らせてもらい、そのあとで src/lib/syncRuntime.ts に
--   module.registerSyncedTable(db.tripExpenseCurrencies, "trip_expense_currencies");
-- の1行を足す(2段階目)。逆順にすると、列の無いテーブルへ upsert して同期が失敗する。
-- 流す前・流した直後のどちらでも、通貨の内訳は端末の中で今までどおり動く。

-- 002_full_sync_tables.sql の他テーブルと同じ作法:
--   id は uuid の主キー(端末側で採番したUUIDをそのまま入れる)
--   user_id / device_id / created_at / updated_at / deleted_at / server_updated_at
--   RLS で自分の行だけ、server_updated_at はトリガで打ち直し、realtime に載せる
create table if not exists public.trip_expense_currencies (
  id uuid primary key,
  user_id uuid not null,
  device_id text not null,
  -- trip_expenses.id。支出1件につき通貨の行は1つだけ(アプリ側で1つに保っている)。
  -- 外部キー制約は付けない — 同期は行ごとに届くので、支出より先に通貨の行が着いた時に
  -- 弾かれると、そのまま二度と入らなくなる(他のテーブルも同じ理由で付けていない)。
  expense_id uuid not null,
  -- ISOの通貨コード("EUR" など)。
  currency text not null,
  -- 現地通貨で払った金額。
  original_amount numeric not null,
  -- 1通貨あたりの円。
  exchange_rate numeric not null,
  -- 'api'(自動取得) か 'manual'(手で入れ直した)。カードの実際のレートは公表値と
  -- 違うことが多いので、上書きしたものを区別して残している。
  rate_source text not null default 'api',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default now()
);
create index if not exists trip_expense_currencies_user_id_idx on public.trip_expense_currencies (user_id);
create index if not exists trip_expense_currencies_expense_id_idx on public.trip_expense_currencies (expense_id);
create index if not exists trip_expense_currencies_server_updated_at_idx on public.trip_expense_currencies (server_updated_at);
alter table public.trip_expense_currencies enable row level security;
drop policy if exists "user manages own trip_expense_currencies" on public.trip_expense_currencies;
create policy "user manages own trip_expense_currencies" on public.trip_expense_currencies for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop trigger if exists trip_expense_currencies_set_server_updated_at on public.trip_expense_currencies;
create trigger trip_expense_currencies_set_server_updated_at before insert or update on public.trip_expense_currencies for each row execute function set_server_updated_at();
alter publication supabase_realtime add table public.trip_expense_currencies;
