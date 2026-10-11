-- LIFE HUB: 自分以外の人が「ここ直した方がいい」を送れる、要望の受信箱。
--
-- 【この1本で何ができるようになるか】
-- * LIFE HUB にログインして使っている人は、設定の「直してほしいことを送る」から書ける。
-- * 共有した「しおり」(/share/trip/<token>)を見ている人も、そのページの下から書ける。
--   ログインは要らないが、**その共有リンクの合鍵を持っている人だけ**が送れる(誰でもは送れない)。
-- * 届いた要望は、アプリの持ち主(app_feedback_owner の1人)だけが、設定の「届いた要望」で読める。
-- * 持ち主の Mac からも、読み取りコードで読める(scripts/feedback-inbox.mjs)。Claude Code が
--   その場で直すため。コードで**できるのは、届いた要望を読むことと「対応済み」の印を付けることだけ**。
--
-- 【他のテーブルと作りが違う理由】023_trip_shares.sql・027 と同じ。同期用の列もトリガも realtime も
-- 持たない。アプリが Supabase を直接読み書きする(端末の Dexie を経由しない)。
--
-- 【実行の順番】このSQLを流す → 下の「持ち主を決める」を、自分のメールアドレスに直して流す。
-- 流すまでは、アプリの「直してほしいことを送る」が「準備中」と出るだけで、他の機能には影響しない。

-- ===== 持ち主(要望を受け取る人) =====
-- 1行だけ。アプリを作っている人が1人で受け取る。
create table if not exists public.app_feedback_owner (
  id text primary key default 'owner' check (id = 'owner'),
  user_id uuid not null
);
alter table public.app_feedback_owner enable row level security;
-- ログインしている人は「自分が持ち主か」だけ確かめられる(設定に受信箱を出すかどうか)。
drop policy if exists "signed-in users read app_feedback_owner" on public.app_feedback_owner;
create policy "signed-in users read app_feedback_owner" on public.app_feedback_owner for select to authenticated using (true);

-- ===== 要望 =====
create table if not exists public.app_feedback (
  id uuid primary key default gen_random_uuid(),
  -- ログインして送った人。共有リンクから送った時は null。
  sender_id uuid,
  -- 送った人の名乗り(任意)。持ち主が「誰からか」分かるように。
  sender_name text,
  -- 'app' = ログインして設定から / 'share' = 共有したしおりのページから
  via text not null check (via in ('app', 'share')),
  -- 共有リンクから送った時の、その共有(trip_shares.id)と旅行の名前(どのしおりを見て書いたか)。
  share_id uuid,
  trip_name text,
  -- どの画面で書いたか(アプリの道筋。「/trips/…」「/settings」など)。
  page text,
  message text not null check (char_length(message) between 1 and 2000),
  app_version text,
  status text not null default 'new' check (status in ('new', 'done', 'dismissed')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists app_feedback_created_idx on public.app_feedback (created_at desc);

alter table public.app_feedback enable row level security;
-- 持ち主はすべて読める・印を付けられる・消せる。送った人は自分が送ったものだけ読める。
-- **入れる方法は下の関数だけ**(連投の上限と、共有リンクの確かめを、そこで必ず通すため)。
drop policy if exists "owner and sender read app_feedback" on public.app_feedback;
create policy "owner and sender read app_feedback" on public.app_feedback for select to authenticated
  using (auth.uid() = sender_id or auth.uid() = (select user_id from public.app_feedback_owner where id = 'owner'));
drop policy if exists "owner updates app_feedback" on public.app_feedback;
create policy "owner updates app_feedback" on public.app_feedback for update to authenticated
  using (auth.uid() = (select user_id from public.app_feedback_owner where id = 'owner'))
  with check (auth.uid() = (select user_id from public.app_feedback_owner where id = 'owner'));
drop policy if exists "owner deletes app_feedback" on public.app_feedback;
create policy "owner deletes app_feedback" on public.app_feedback for delete to authenticated
  using (auth.uid() = (select user_id from public.app_feedback_owner where id = 'owner'));

-- ===== 送る =====
-- ログインしている人、または共有リンクの合鍵を持っている人だけ。1時間に10件まで(同じ人・同じ共有リンクごと)。
create or replace function public.send_app_feedback(
  p_message text,
  p_page text default null,
  p_sender_name text default null,
  p_app_version text default null,
  p_share_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_message text := btrim(coalesce(p_message, ''));
  v_sender uuid := auth.uid();
  v_trip_name text;
  v_share uuid;
  v_via text;
  v_recent integer;
begin
  if char_length(v_message) = 0 or char_length(v_message) > 2000 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_message');
  end if;

  -- ChatGPT など OAuth で接続したアプリからは送らせない(本人になりすまして要望が積まれないように)。
  if (auth.jwt() ->> 'client_id') is not null then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed');
  end if;

  if v_sender is not null then
    v_via := 'app';
    select count(*) into v_recent from public.app_feedback
      where sender_id = v_sender and created_at > now() - interval '1 hour';
  elsif p_share_token is not null and p_share_token <> '' then
    select s.id, (select t.name from public.trips t where t.id = s.trip_id and t.user_id = s.user_id and t.deleted_at is null)
      into v_share, v_trip_name
      from public.trip_shares s
      where s.token = p_share_token;
    if v_share is null then
      return jsonb_build_object('ok', false, 'reason', 'invalid_share');
    end if;
    v_via := 'share';
    select count(*) into v_recent from public.app_feedback
      where share_id = v_share and created_at > now() - interval '1 hour';
  else
    return jsonb_build_object('ok', false, 'reason', 'not_allowed');
  end if;

  if v_recent >= 10 then
    return jsonb_build_object('ok', false, 'reason', 'too_many');
  end if;

  insert into public.app_feedback (sender_id, sender_name, via, share_id, trip_name, page, message, app_version)
  values (v_sender, nullif(left(btrim(coalesce(p_sender_name, '')), 40), ''), v_via, v_share, left(v_trip_name, 100),
          left(p_page, 200), v_message, left(p_app_version, 40));
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.send_app_feedback(text, text, text, text, text) from public;
grant execute on function public.send_app_feedback(text, text, text, text, text) to anon, authenticated;

-- ===== 持ち主の Mac から読む(読み取りコード) =====
-- コードそのものは置かず、SHA-256 の値だけを置く(027 の送信コードと同じ)。作り直せば古いコードは使えない。
create table if not exists public.app_feedback_read_codes (
  id text primary key default 'owner' check (id = 'owner'),
  code_hash text not null unique,
  created_at timestamptz not null default now()
);
alter table public.app_feedback_read_codes enable row level security;
-- 誰も直接は読み書きできない(SQL エディタで持ち主が入れる。下の関数だけが照らし合わせる)。

create or replace function public.app_feedback_inbox(p_code text, p_include_resolved boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.app_feedback_read_codes
    where code_hash = encode(sha256(convert_to(coalesce(p_code, ''), 'utf8')), 'hex')
  ) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_code');
  end if;
  return jsonb_build_object('ok', true, 'items', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', f.id, 'via', f.via, 'senderName', f.sender_name, 'tripName', f.trip_name, 'page', f.page,
      'message', f.message, 'appVersion', f.app_version, 'status', f.status, 'createdAt', f.created_at
    ) order by f.created_at)
    from public.app_feedback f
    where p_include_resolved or f.status = 'new'
  ), '[]'::jsonb));
end;
$$;
revoke all on function public.app_feedback_inbox(text, boolean) from public;
grant execute on function public.app_feedback_inbox(text, boolean) to anon, authenticated;

create or replace function public.app_feedback_set_status(p_code text, p_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.app_feedback_read_codes
    where code_hash = encode(sha256(convert_to(coalesce(p_code, ''), 'utf8')), 'hex')
  ) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_code');
  end if;
  if p_status not in ('new', 'done', 'dismissed') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_status');
  end if;
  update public.app_feedback
    set status = p_status, resolved_at = case when p_status = 'new' then null else now() end
    where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.app_feedback_set_status(text, uuid, text) from public;
grant execute on function public.app_feedback_set_status(text, uuid, text) to anon, authenticated;

grant select on public.app_feedback_owner to authenticated;
grant select, update, delete on public.app_feedback to authenticated;

-- ===== ChatGPT など OAuth で接続したアプリのトークンは、どの表にも触れない(028 と同じ決まり) =====
do $$
declare
  t text;
begin
  foreach t in array array['app_feedback_owner', 'app_feedback', 'app_feedback_read_codes']
  loop
    execute format('drop policy if exists "oauth clients blocked" on public.%I', t);
    execute format(
      'create policy "oauth clients blocked" on public.%I as restrictive for all to authenticated '
      'using ((auth.jwt() ->> ''client_id'') is null) with check ((auth.jwt() ->> ''client_id'') is null)',
      t
    );
  end loop;
end
$$;

-- ===== 持ち主を決める(1回だけ。メールアドレスを自分のものに直して流す) =====
-- insert into public.app_feedback_owner (id, user_id)
--   select 'owner', id from auth.users where email = '<自分のメールアドレス>'
--   on conflict (id) do update set user_id = excluded.user_id;
--
-- 読み取りコード(持ち主の Mac 用)は、Claude Code が作って、入れる SQL を渡す
-- (コードの値は Mac の todoアプリ/.feedback-code にだけ置く。git には入れない)。
