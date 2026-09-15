-- LIFE HUB: メールから作った予定と、元のメールのつながりを端末間で揃える。
--
-- 【なぜ要るか】
-- 依頼「予定に元メールへのリンクを残したい」。Gmail の「予定にする」で作った予定の
-- 編集画面に「元のメールを開く」を出すため、どのメールから作ったかを覚えておく。
-- いまはそれが作った端末の中(Dexie の eventMailLinks)にしか無いので、PCで作った
-- 予定をスマホで開くとリンクが出ない。このテーブルが入ると、どの端末でも出る。
--
-- 予定の行(calendar_events)に列を足さずに別テーブルにしたのは、足した列が本番に
-- 無いうちにアプリが送ると calendar_events の同期そのものが止まるため(021/022 と同じ判断)。
--
-- 【実行しても既存のデータには触らない】新しいテーブルを1つ足すだけ。
-- 流す前・流した直後のどちらでも、リンクは作った端末の中で今までどおり動く。
--
-- 【実行の順番】021/022/024 と同じ2段構え。このSQLを流しても、アプリはすぐには同期を始めない。
-- 流し終えたら知らせてもらい、そのあとで src/lib/syncRuntime.ts に
--   module.registerSyncedTable(db.eventMailLinks, "event_mail_links");
-- の1行を足す(2段階目)。逆順にすると、テーブルの無いところへ upsert して同期が失敗し、
-- 送信の待ち行列がそこで止まって**他のテーブルぶんまで送れなくなる**。

-- 002_full_sync_tables.sql の他テーブルと同じ作法(021/022/024 と同じ)。
create table if not exists public.event_mail_links (
  id uuid primary key,
  user_id uuid not null,
  device_id text not null,
  -- calendar_events.id。外部キーは張らない — 同期は行ごとに届く順番が決まっていないので、
  -- 予定より先にこの行が届くと拒否されて待ち行列が止まるため。
  event_id uuid not null,
  -- メールは端末ごとのidではなく、受け取ったアドレスとGmail側のidで指す。
  -- 別の端末や、受信トレイから外れて端末から消えたメールでも Gmail で開けるように。
  account_email text not null,
  gmail_message_id text not null,
  thread_id text,
  -- メールが端末に無くても、どのメールか分かるように件名と差出人だけ控える(本文は持たない)。
  subject text,
  sender text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default now()
);
create index if not exists event_mail_links_user_id_idx on public.event_mail_links (user_id);
create index if not exists event_mail_links_event_id_idx on public.event_mail_links (event_id);
create index if not exists event_mail_links_server_updated_at_idx on public.event_mail_links (server_updated_at);
alter table public.event_mail_links enable row level security;
drop policy if exists "user manages own event_mail_links" on public.event_mail_links;
create policy "user manages own event_mail_links" on public.event_mail_links for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop trigger if exists event_mail_links_set_server_updated_at on public.event_mail_links;
create trigger event_mail_links_set_server_updated_at before insert or update on public.event_mail_links for each row execute function set_server_updated_at();
alter publication supabase_realtime add table public.event_mail_links;
