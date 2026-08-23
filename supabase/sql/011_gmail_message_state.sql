-- LIFE HUB: メールの「既読」「送信済み」だけを端末間で共有するテーブル。
-- 004_blocked_senders.sql と同じ方針(汎用同期エンジン src/lib/sync.ts の対象外、
-- クライアントから直接 upsert/select する専用テーブル)。
--
-- ローカルのDexie syncedEmails は端末ごとのキャッシュで、行のIDも accountId も端末ごとの
-- ローカルUUID。そのため、どの端末でも同じ値になる Gmail のメッセージID
-- (gmail_message_id) と連携先アカウントのアドレス(account_email)で管理する。
--
-- 件名・本文・スニペット・AI下書きは意図的に持たない — メールの中身をクラウドに置かずに、
-- 「どれを読んだか」「どれに返信済みか」だけを揃えるためのテーブル。
create table public.gmail_message_state (
  id uuid primary key,
  user_id uuid not null,
  account_email text not null,
  gmail_message_id text not null,
  -- 未読に戻した場合は null。「まだ同期していない」ではなく「未読である」を表す。
  read_at timestamptz,
  -- このメールにこのアプリ経由で返信済みかどうか。ローカルの status とは違い
  -- sent かどうかだけを持つ(AI下書きの有無は端末ごとなので共有しない)。
  sent boolean not null default false,
  -- 端末間の競合はこの時刻の新しい方を採用する(last-write-wins)。
  updated_at timestamptz not null default now(),
  unique (user_id, account_email, gmail_message_id)
);
create index gmail_message_state_lookup_idx
  on public.gmail_message_state (user_id, account_email);
alter table public.gmail_message_state enable row level security;
create policy "user manages own gmail_message_state" on public.gmail_message_state
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
