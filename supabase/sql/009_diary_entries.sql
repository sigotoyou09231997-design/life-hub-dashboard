-- LIFE HUB: 日記を作り直す。
-- 2026-08-23 に日記・目標・習慣をまとめて廃止した(007)が、日記だけ作り直す。
-- 当時の日記は端末内(Dexie)だけの機能でサーバー側テーブルが存在しなかったため、
-- ここが日記にとって最初のテーブルになる(007では触れていない)。
-- クライアント側は同じコミットで Dexie v13 に diaryEntries を作り、
-- src/lib/syncRuntime.ts の registerSyncedTable に diary_entries を足している。
--
-- 002_full_sync_tables.sql の他テーブルと同じ作法:
--   id は uuid の主キー(端末側で採番したUUIDをそのまま入れる)
--   user_id / device_id / created_at / updated_at / deleted_at / server_updated_at
--   RLS で自分の行だけ、server_updated_at はトリガで打ち直し、realtime に載せる
-- 位置は緯度経度をそのまま持つ(住所への変換は有料APIが要るので、地名は
-- place_label に自分で付けた文字を入れる)。

create table public.diary_entries (
  id uuid primary key,
  user_id uuid not null,
  device_id text not null,
  date date not null,
  body text not null,
  mood text,
  latitude double precision,
  longitude double precision,
  place_label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default now()
);
create index diary_entries_user_id_idx on public.diary_entries (user_id);
create index diary_entries_server_updated_at_idx on public.diary_entries (server_updated_at);
create index diary_entries_date_idx on public.diary_entries (date);
alter table public.diary_entries enable row level security;
create policy "user manages own diary_entries" on public.diary_entries for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create trigger diary_entries_set_server_updated_at before insert or update on public.diary_entries for each row execute function set_server_updated_at();
alter publication supabase_realtime add table public.diary_entries;
