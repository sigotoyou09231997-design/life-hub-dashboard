-- LIFE HUB: Gmailバックグラウンドプッシュ通知のためのSupabaseテーブル追加
-- 002_full_sync_tables.sql と同じRLSパターン(auth.uid() = user_id)、FK制約なしの方針を踏襲するが、
-- これらは汎用同期エンジン(src/lib/sync.ts)の対象ではないため server_updated_at トリガーや
-- Realtime publication への追加は行わない(定期実行の netlify/functions/checkGmailAndNotify.ts が
-- service_role キーで直接読み書きする専用テーブル)。

create table public.gmail_server_accounts (
  id uuid primary key,
  user_id uuid not null,
  email text not null,
  refresh_token text not null,
  last_checked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, email)
);
create index gmail_server_accounts_user_id_idx on public.gmail_server_accounts (user_id);
alter table public.gmail_server_accounts enable row level security;
create policy "user manages own gmail_server_accounts" on public.gmail_server_accounts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table public.push_subscriptions (
  id uuid primary key,
  user_id uuid not null,
  device_id text not null,
  endpoint text not null unique,
  p256dh text not null,
  auth_key text not null,
  created_at timestamptz not null default now()
);
create index push_subscriptions_user_id_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
create policy "user manages own push_subscriptions" on public.push_subscriptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
