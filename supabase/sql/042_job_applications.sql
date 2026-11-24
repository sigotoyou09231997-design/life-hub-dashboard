-- LIFE HUB: 就活タブの応募先(会社名・今の段階・次の予定)を端末間で揃える。
--
-- 【なぜ要るか】
-- 就活タブ(src/components/jobs/)の応募先は、これまで端末の中(Dexie の jobApplications)にしか無く、
-- PC で入れた応募先がスマホの就活タブに出なかった(2026-11-24、本人「ここに予定と就活中の会社を入れて欲しい」
-- とスマホの画面を送ってきたが、PC から入れても届かない作りだった)。
--
-- 【実行しても既存のデータには触らない】新しいテーブルを1つ足すだけ。
--
-- 【実行の順番】024 と同じ2段構え。このSQLを流し終えてから、src/lib/syncRuntime.ts に
--   module.registerSyncedTable(db.jobApplications, "job_applications");
-- を足す。逆順にすると、表の無いところへ送って同期の待ち行列が止まる。

create table if not exists public.job_applications (
  id uuid primary key,
  user_id uuid not null,
  device_id text not null,
  company_name text not null,
  -- 職種・ポジション。書かなくてよい。
  role text,
  -- applied / document / interview1 / interview2 / final / offer / rejected / declined
  -- (src/types/index.ts の JobApplicationStage)。値の制約は付けない — 段階を足した時に同期の行が拒否されて待ち行列が止まるため。
  stage text not null,
  -- 次の面接などの日(YYYY-MM-DD)と時刻(HH:mm)。
  next_date date,
  next_time text,
  memo text,
  -- 「予定に入れる」で作ったカレンダー予定のid。
  linked_event_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default now()
);
create index if not exists job_applications_user_id_idx on public.job_applications (user_id);
create index if not exists job_applications_server_updated_at_idx on public.job_applications (server_updated_at);
alter table public.job_applications enable row level security;
drop policy if exists "user manages own job_applications" on public.job_applications;
create policy "user manages own job_applications" on public.job_applications for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop trigger if exists job_applications_set_server_updated_at on public.job_applications;
create trigger job_applications_set_server_updated_at before insert or update on public.job_applications for each row execute function set_server_updated_at();
alter publication supabase_realtime add table public.job_applications;
