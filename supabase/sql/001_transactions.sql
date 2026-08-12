-- 既存のtransactionsテーブルの定義を記録用に書き起こしたもの(2026-08-11に手動で作成済み、実行不要)。
-- PC/スマホ同期機能の最初のテーブルで、以降の同期対象テーブルはすべてこの構造を踏襲する。

create or replace function public.set_server_updated_at()
returns trigger
language plpgsql
as $function$
begin
  new.server_updated_at = now();
  return new;
end;
$function$;

create table public.transactions (
  id uuid primary key,
  user_id uuid not null,
  device_id text not null,
  type text not null,
  amount numeric not null,
  category text not null,
  method text,
  store text,
  memo text,
  date date not null,
  is_fixed boolean not null default false,
  external_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default now()
);
create index transactions_user_id_idx on public.transactions (user_id);
create index transactions_server_updated_at_idx on public.transactions (server_updated_at);
alter table public.transactions enable row level security;
create policy "user manages own transactions" on public.transactions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create trigger transactions_set_server_updated_at before insert or update on public.transactions for each row execute function set_server_updated_at();
alter publication supabase_realtime add table public.transactions;
