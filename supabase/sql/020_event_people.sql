-- LIFE HUB: カレンダーの予定に「誰の予定か」の印を付けられるようにする。
--
-- 仕事/プライベート/重要/その他 のカテゴリ(calendar_events.category)とは別の軸。
-- カテゴリは固定の4つだが、こちらは名前も色も本人が決めるので、専用のテーブルを持つ。
-- 予定の側は person_ids(そのテーブルのidの配列)だけを持つ — 名前を変えても、
-- 予定を1件ずつ付け直さなくて済むようにするため。1件の予定に何人でも付けられる。
--
-- アカウント(accounts)とは別物。アカウントを切り替えると端末内のDBごと入れ替わるため、
-- 1つのカレンダーに家族の予定を並べて色分けする用途には使えない。だから予定そのものに持たせる。
--
-- 【実行の順番】汎用同期エンジン(src/lib/sync.ts)は行の全項目をそのまま upsert するため、
-- person_ids 列が無い状態でアプリだけ更新すると、印を付けた予定の同期が失敗する。必ず
-- アプリの更新より先に実行すること。列とテーブルを足すだけなので、古いアプリのままでも害はない。

-- ===== 予定側: 誰の予定かの印 =====
-- notes.tags と同じく text[]。既定を '{}' にしておくと、古い行も「誰のとも決めていない
-- 予定」として何も書き換えずにそのまま読める。
alter table public.calendar_events add column if not exists person_ids text[] not null default '{}';

-- ===== 人の一覧 =====
-- 002_full_sync_tables.sql の他テーブルと同じ作法:
--   id は uuid の主キー(端末側で採番したUUIDをそのまま入れる)
--   user_id / device_id / created_at / updated_at / deleted_at / server_updated_at
--   RLS で自分の行だけ、server_updated_at はトリガで打ち直し、realtime に載せる
-- color はパレットの色id(src/lib/eventPeople.ts の PERSON_COLORS)。色そのもの(#rrggbb)を
-- 入れないのは、あとでパレットの色味を調整した時に、入っている行を書き換えずに追従させるため。
create table if not exists public.event_people (
  id uuid primary key,
  user_id uuid not null,
  device_id text not null,
  name text not null,
  color text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default now()
);
create index if not exists event_people_user_id_idx on public.event_people (user_id);
create index if not exists event_people_server_updated_at_idx on public.event_people (server_updated_at);
alter table public.event_people enable row level security;
drop policy if exists "user manages own event_people" on public.event_people;
create policy "user manages own event_people" on public.event_people for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop trigger if exists event_people_set_server_updated_at on public.event_people;
create trigger event_people_set_server_updated_at before insert or update on public.event_people for each row execute function set_server_updated_at();
alter publication supabase_realtime add table public.event_people;
