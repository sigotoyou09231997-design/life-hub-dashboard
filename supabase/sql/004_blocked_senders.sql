-- LIFE HUB: ブロック中送信者をサーバー側のバックグラウンド通知(netlify/functions/checkGmailAndNotify.ts)
-- でも参照できるようにするテーブル。003_gmail_push_notifications.sql と同じ方針
-- (汎用同期エンジンsrc/lib/sync.tsの対象外、server_updated_atトリガー/Realtime publicationなし、
-- service_roleキーで直接読む専用テーブル)。
--
-- ローカルのDexie blockedSendersテーブル(端末ごと、gmailAccounts.id=ローカルUUIDキー)とは別物。
-- こちらはSupabaseログインユーザー(user_id) + 連携先Gmailアカウントのメールアドレス(account_email)
-- + ブロック対象送信者のメールアドレス(sender_email)で管理し、ブロック/解除のたびに
-- src/lib/blockedSenders.ts経由でクライアントから直接upsert/deleteする。

create table public.blocked_senders (
  id uuid primary key,
  user_id uuid not null,
  account_email text not null,
  sender_email text not null,
  created_at timestamptz not null default now(),
  unique (user_id, account_email, sender_email)
);
create index blocked_senders_user_id_idx on public.blocked_senders (user_id);
alter table public.blocked_senders enable row level security;
create policy "user manages own blocked_senders" on public.blocked_senders
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
