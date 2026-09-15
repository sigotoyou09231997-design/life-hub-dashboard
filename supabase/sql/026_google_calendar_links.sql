-- LIFE HUB: Googleカレンダーから取り込んだ予定と、Google側の予定のつながりを端末間で揃える。
--
-- 【なぜ要るか】
-- 依頼「Googleカレンダーと双方向で同期したい」の第2段(LIFE HUB → Google の書き出し)の前提。
-- 第1段(Google → LIFE HUB の取り込み)は、このSQLが無くても動く — 取り込んだ予定は
-- 普通の予定として calendar_events に入り、idをアドレスとGoogle側のidから毎回同じ値で
-- 作るので、PCとスマホの両方で取り込んでも2件にならない。
--
-- 書き出しでは「どの予定がGoogleから来たか・Googleのどの予定と対なのか」を、どの端末でも
-- 知っている必要がある。知らない端末が、Googleから来た予定を「LIFE HUBで足した予定」と
-- 取り違えてGoogleへ書き出すと、Googleカレンダーに同じ予定が2件できてしまう。
-- そのつながりが、いまは取り込んだ端末の中(Dexie の googleCalendarLinks)にしか無い。
--
-- 【実行しても既存のデータには触らない】新しいテーブルを1つ足すだけ。
--
-- 【実行の順番】021/022/024/025 と同じ2段構え。流し終えたら知らせてもらい、そのあとで
-- src/lib/syncRuntime.ts に
--   module.registerSyncedTable(db.googleCalendarLinks, "google_calendar_links");
-- の1行を足し、書き出し(第2段)を作る。逆順にすると、テーブルの無いところへ upsert して
-- 同期が失敗し、送信の待ち行列がそこで止まって**他のテーブルぶんまで送れなくなる**。

-- 002_full_sync_tables.sql の他テーブルと同じ作法(021/022/024/025 と同じ)。
create table if not exists public.google_calendar_links (
  id uuid primary key,
  user_id uuid not null,
  device_id text not null,
  -- calendar_events.id。外部キーは張らない(025 と同じく、届く順番が決まっていないため)。
  event_id uuid not null,
  -- どのGoogleアカウントのカレンダーから来たか。
  account_email text not null,
  google_event_id text not null,
  -- Google側の最終更新時刻(RFC3339 の文字列のまま)。書き出しで、どちらが新しいかを見る。
  google_updated text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default now()
);
create index if not exists google_calendar_links_user_id_idx on public.google_calendar_links (user_id);
create index if not exists google_calendar_links_event_id_idx on public.google_calendar_links (event_id);
create index if not exists google_calendar_links_server_updated_at_idx on public.google_calendar_links (server_updated_at);
alter table public.google_calendar_links enable row level security;
drop policy if exists "user manages own google_calendar_links" on public.google_calendar_links;
create policy "user manages own google_calendar_links" on public.google_calendar_links for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop trigger if exists google_calendar_links_set_server_updated_at on public.google_calendar_links;
create trigger google_calendar_links_set_server_updated_at before insert or update on public.google_calendar_links for each row execute function set_server_updated_at();
alter publication supabase_realtime add table public.google_calendar_links;
