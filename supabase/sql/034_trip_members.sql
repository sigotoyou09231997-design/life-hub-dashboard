-- LIFE HUB: 旅行を、ほかのアカウントと「一緒に編集」できるようにする(メールアドレスで招待)。
--
-- 【今までとの違い】
-- 023 の共有リンクは「見るだけ」で、ログインも要らない。これは**ログインしているほかの人が、
-- 同じ旅行を一緒に直せる**もの。共有するのは、旅行本体・日程・持ち物・ルート・費用(通貨の内訳を含む)。
-- 日記(diary_entries)は今までどおり、誰にも共有しない(この SQL は日記の表に一切さわらない)。
--
-- 名前の注意: trips.members(030)は割り勘に使う「参加者の名前」の一覧で、これとは別のもの。
-- ここで作る trip_members は、**ログインしている別のアカウント**を旅行に招く仕組みの表。
--
-- 【仕組み】
--   1. 持ち主が、旅行を開いてメールアドレスを入れる(招待)。招待の行は trip_members に「承認待ち」で入る。
--   2. 招待された人が、そのメールアドレスでログインすると、アプリに「参加する／断る」が出る。
--   3. 参加すると「参加中」になり、持ち主の旅行の行を読み書きできるようになる(下の RLS)。
--   4. 持ち主は、いつでも外せる。参加した人は、いつでも抜けられる。外れた瞬間から、読めも書けもしない。
--
-- 旅行のデータの行は、**持ち主の user_id のまま**置く。参加した人が足した予定も、user_id は持ち主。
-- こうしておくと、持ち主の端末は今までの絞り込み(user_id が自分)のままで、参加した人の変更も受け取れる。
-- 参加した人が書く時は、RLS が「user_id が持ち主であること」を確かめる(他人の名前では書けない)。
--
-- 【参加した人にできないこと】
--   * 旅行そのものを消す(deleted_at を入れる更新は通らない)。抜けるだけ。
--   * 持ち主を変える(user_id を書き換える更新は通らない)。
--   * 招待する・外す・共有リンクを作る(持ち主だけ。招待の表は関数ごしにしか書けない)。
--
-- 【なりすまし対策】
-- 招待はメールアドレス宛て。ほかの人のアドレスで登録しただけの人が、招待を横取りできないように、
-- 「アドレスの確認が済んでいる(auth.users.email_confirmed_at)人」の本当のアドレスだけで照合する。
-- JWT に入っているアドレスは使わない(確認済みかどうかが分からないため)。
--
-- 【実行の順番】このSQLを先に流す。流すまでは、アプリの「一緒に編集」を開いても
-- 「まだ使えません」と出るだけで、旅行も同期も今までどおり動く(アプリ側は 034 が無くても落ちない作り)。
-- 021/022 と違って、流したあとにアプリ側でやることは無い。
--
-- 【新しい表を足したので】028 の決まりどおり、同じ SQL の中で "oauth clients blocked" を足している
-- (ChatGPT など OAuth で接続したアプリのトークンは、この表を読むことも書くこともできない)。

-- ===== 招待と参加者の表 =====
-- 1行 = 「この旅行に、このメールアドレスを招いた」。承認すると member_id が入って accepted になる。
-- 抜ける・外す・断る＝この行を消す(同じ人を、もう一度招き直せる)。
create table if not exists public.trip_members (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null,
  -- 旅行の持ち主。
  owner_id uuid not null,
  -- 招待した時の、持ち主のメールアドレス(参加した人の画面に「◯◯さんの旅行」と出す用)。
  owner_email text not null default '',
  -- 招待したメールアドレス。小文字・前後の空白なしにそろえて入れる(下の check)。
  invited_email text not null,
  -- 参加した人。承認待ちの間は null。
  member_id uuid,
  status text not null default 'pending',
  -- 招待された人は、承認するまで旅行そのものを読めない。何の旅行への招待かが分かるように、
  -- 招待した時点の旅行の名前・行き先・日付だけを、この行に控えておく。
  trip_name text not null default '',
  trip_destination text not null default '',
  trip_start_date date,
  trip_end_date date,
  invited_at timestamptz not null default now(),
  accepted_at timestamptz,
  constraint trip_members_status_check check (status in ('pending', 'accepted')),
  constraint trip_members_email_normalized check (invited_email = lower(btrim(invited_email))),
  constraint trip_members_accepted_has_member check ((status = 'accepted') = (member_id is not null))
);
create unique index if not exists trip_members_trip_email_key on public.trip_members (trip_id, invited_email);
create index if not exists trip_members_member_id_idx on public.trip_members (member_id) where member_id is not null;
create index if not exists trip_members_invited_email_idx on public.trip_members (invited_email);
create index if not exists trip_members_owner_id_idx on public.trip_members (owner_id);

-- ===== 判定用の小さな関数 =====
-- どれも security definer(RLS の中で表を引くと、RLS が RLS を呼んで終わらなくなるため)。
-- 返すのは「自分についての真偽・自分に関係する id」だけ。

-- いまログインしている人の、確認済みのメールアドレス(小文字)。確認が済んでいなければ空。
create or replace function public.trip_invite_email()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v text;
begin
  select lower(btrim(u.email)) into v
  from auth.users u
  where u.id = auth.uid() and u.email_confirmed_at is not null;
  return coalesce(v, '');
end
$$;

-- この旅行に、参加中の人として入っているか(持ち主は含まない)。
create or replace function public.is_trip_member(p_trip_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.trip_members m
    where m.trip_id = p_trip_id and m.member_id = auth.uid() and m.status = 'accepted'
  )
$$;

-- 旅行の持ち主(旅行が無ければ null)。参加した人の書き込みが「持ち主の名前」で入るかの確認に使う。
create or replace function public.trip_owner_of(p_trip_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select t.user_id from public.trips t where t.id = p_trip_id
$$;

-- 費用(trip_expenses)がどの旅行のものか。通貨の内訳(trip_expense_currencies)は trip_id を持たないので、これで辿る。
create or replace function public.expense_trip_of(p_expense_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select e.trip_id from public.trip_expenses e where e.id = p_expense_id
$$;

-- 共有されている旅行の行は、必ず持ち主の user_id で入っているか。
-- 共有されていない旅行(参加者が1人もいない旅行)は何も確かめない — 今までの書き込みには、一切影響しない。
create or replace function public.trip_row_owner_ok(p_trip_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when exists (select 1 from public.trip_members m where m.trip_id = p_trip_id and m.status = 'accepted')
      then p_user_id is not distinct from (select t.user_id from public.trips t where t.id = p_trip_id)
    else true
  end
$$;

-- 行の持ち主(user_id)は、あとから書き換えられない。
-- RLS の with check は「どれか1つのポリシーを通ればよい」ので、既存の「自分の行だけ」(user_id が自分)を
-- 参加者が通ってしまい、参加者が user_id を自分に書き換えて旅行を乗っ取れる。RLS では「更新前の値」を
-- 見られないので、トリガーで止める。持ち主の端末の同期は user_id を変えない(upsert でも同じ値)ので、影響しない。
create or replace function public.keep_row_owner()
returns trigger
language plpgsql
as $$
begin
  if new.user_id is distinct from old.user_id then
    raise exception 'row_owner_locked';
  end if;
  return new;
end
$$;

revoke all on function public.trip_invite_email() from public, anon;
revoke all on function public.is_trip_member(uuid) from public, anon;
revoke all on function public.trip_owner_of(uuid) from public, anon;
revoke all on function public.expense_trip_of(uuid) from public, anon;
revoke all on function public.trip_row_owner_ok(uuid, uuid) from public, anon;
grant execute on function public.trip_invite_email() to authenticated;
grant execute on function public.is_trip_member(uuid) to authenticated;
grant execute on function public.trip_owner_of(uuid) to authenticated;
grant execute on function public.expense_trip_of(uuid) to authenticated;
grant execute on function public.trip_row_owner_ok(uuid, uuid) to authenticated;

-- ===== trip_members: 読めるのは関係する人だけ。書くのは下の関数だけ =====
-- 書き込み用のポリシーは1つも作らない(= 表に直接は、誰も書けない)。招待・承認・外すは、必ず関数を通る。
alter table public.trip_members enable row level security;
drop policy if exists "trip_members readable by people involved" on public.trip_members;
create policy "trip_members readable by people involved" on public.trip_members for select to authenticated
  using (
    owner_id = auth.uid()
    or member_id = auth.uid()
    -- 自分宛ての承認待ち(確認済みのアドレスで照合)
    or (status = 'pending' and invited_email = public.trip_invite_email())
    -- 同じ旅行に参加中の人の一覧(承認待ちの人のアドレスは、持ち主だけが見える)
    or (status = 'accepted' and public.is_trip_member(trip_id))
  );

drop policy if exists "oauth clients blocked" on public.trip_members;
create policy "oauth clients blocked" on public.trip_members as restrictive for all to authenticated
  using ((auth.jwt() ->> 'client_id') is null) with check ((auth.jwt() ->> 'client_id') is null);

-- 参加の増減を、画面にすぐ出す(招待された側に「招待が届きました」、持ち主に「参加しました」)。
do $$
begin
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'trip_members'
  ) then
    alter publication supabase_realtime add table public.trip_members;
  end if;
end
$$;

-- ===== 旅行の表: 参加中の人にも、読み書きを許す =====
-- 既存の「user manages own …」(持ち主が全部できる)は、そのまま。ここに**足す**だけ(ポリシーは OR で効く)。
-- ChatGPT など OAuth のトークンの制限(028 の restrictive)は、これらの上にも変わらず掛かる。

-- trips: 参加中の人は、読める・直せる。消せない(deleted_at を入れる更新は通さない)。持ち主も変えられない。
drop policy if exists "trip members read shared trips" on public.trips;
create policy "trip members read shared trips" on public.trips for select to authenticated
  using (public.is_trip_member(id));
drop policy if exists "trip members edit shared trips" on public.trips;
create policy "trip members edit shared trips" on public.trips for update to authenticated
  using (public.is_trip_member(id))
  with check (public.is_trip_member(id) and user_id = public.trip_owner_of(id) and deleted_at is null);
-- 同期は upsert で送るため、行が既にあっても INSERT の確認(with check)が先に通る必要がある。
-- 旅行が無ければ is_trip_member が偽なので、参加した人が新しい旅行をここから作ることはできない。
drop policy if exists "trip members upsert shared trips" on public.trips;
create policy "trip members upsert shared trips" on public.trips for insert to authenticated
  with check (public.is_trip_member(id) and user_id = public.trip_owner_of(id) and deleted_at is null);

-- 日程・費用・持ち物・ルート: 参加中の人は、読める・足せる・直せる(消すのも deleted_at を入れる更新)。ただし行は持ち主の名前で。
do $$
declare
  t text;
begin
  foreach t in array array['trip_schedule', 'trip_expenses', 'trip_packing_items', 'trip_route_places']
  loop
    if to_regclass('public.' || t) is null then continue; end if;
    -- 消すのは deleted_at を入れる更新(アプリはそうしか消さない)。行そのものの削除(DELETE)は、参加者には許さない
    -- (行ごと消えると、ほかの端末が「消えた」ことを知れないため)。
    execute format('drop policy if exists "trip members manage shared %1$s" on public.%1$I', t);
    execute format('drop policy if exists "trip members read shared %1$s" on public.%1$I', t);
    execute format('drop policy if exists "trip members add shared %1$s" on public.%1$I', t);
    execute format('drop policy if exists "trip members edit shared %1$s" on public.%1$I', t);
    execute format(
      'create policy "trip members read shared %1$s" on public.%1$I for select to authenticated using (public.is_trip_member(trip_id))',
      t
    );
    execute format(
      'create policy "trip members add shared %1$s" on public.%1$I for insert to authenticated '
      'with check (public.is_trip_member(trip_id) and user_id = public.trip_owner_of(trip_id))',
      t
    );
    execute format(
      'create policy "trip members edit shared %1$s" on public.%1$I for update to authenticated '
      'using (public.is_trip_member(trip_id)) '
      'with check (public.is_trip_member(trip_id) and user_id = public.trip_owner_of(trip_id))',
      t
    );
    -- 「自分の行だけ」の既存ポリシー(user_id が自分なら通る)で、参加者が自分の名前の行を共有の旅行に差し込めてしまう。
    -- 制限つき(restrictive = ほかのポリシーに「加えて」満たす)で、共有されている旅行の行は持ち主の名前だけ、にする。
    execute format('drop policy if exists "shared trip rows keep owner on insert" on public.%I', t);
    execute format(
      'create policy "shared trip rows keep owner on insert" on public.%I as restrictive for insert to authenticated '
      'with check (public.trip_row_owner_ok(trip_id, user_id))',
      t
    );
    execute format('drop policy if exists "shared trip rows keep owner on update" on public.%I', t);
    execute format(
      'create policy "shared trip rows keep owner on update" on public.%I as restrictive for update to authenticated '
      'using (true) with check (public.trip_row_owner_ok(trip_id, user_id))',
      t
    );
    execute format('drop trigger if exists %1$I on public.%2$I', t || '_keep_owner', t);
    execute format('create trigger %1$I before update on public.%2$I for each row execute function public.keep_row_owner()', t || '_keep_owner', t);
  end loop;
end
$$;

-- trips 本体も、持ち主は書き換えられない(上の理由と同じ)。
drop trigger if exists trips_keep_owner on public.trips;
create trigger trips_keep_owner before update on public.trips for each row execute function public.keep_row_owner();

-- 費用の通貨の内訳(021)は、trip_id を持たず expense_id だけ。費用から旅行を辿って確かめる。
do $$
begin
  if to_regclass('public.trip_expense_currencies') is not null then
    drop policy if exists "trip members manage shared trip_expense_currencies" on public.trip_expense_currencies;
    drop policy if exists "trip members read shared trip_expense_currencies" on public.trip_expense_currencies;
    drop policy if exists "trip members add shared trip_expense_currencies" on public.trip_expense_currencies;
    drop policy if exists "trip members edit shared trip_expense_currencies" on public.trip_expense_currencies;
    create policy "trip members read shared trip_expense_currencies" on public.trip_expense_currencies for select to authenticated
      using (public.is_trip_member(public.expense_trip_of(expense_id)));
    create policy "trip members add shared trip_expense_currencies" on public.trip_expense_currencies for insert to authenticated
      with check (
        public.is_trip_member(public.expense_trip_of(expense_id))
        and user_id = public.trip_owner_of(public.expense_trip_of(expense_id))
      );
    create policy "trip members edit shared trip_expense_currencies" on public.trip_expense_currencies for update to authenticated
      using (public.is_trip_member(public.expense_trip_of(expense_id)))
      with check (
        public.is_trip_member(public.expense_trip_of(expense_id))
        and user_id = public.trip_owner_of(public.expense_trip_of(expense_id))
      );
    drop policy if exists "shared trip rows keep owner on insert" on public.trip_expense_currencies;
    create policy "shared trip rows keep owner on insert" on public.trip_expense_currencies as restrictive for insert to authenticated
      with check (public.trip_row_owner_ok(public.expense_trip_of(expense_id), user_id));
    drop policy if exists "shared trip rows keep owner on update" on public.trip_expense_currencies;
    create policy "shared trip rows keep owner on update" on public.trip_expense_currencies as restrictive for update to authenticated
      using (true) with check (public.trip_row_owner_ok(public.expense_trip_of(expense_id), user_id));
    drop trigger if exists trip_expense_currencies_keep_owner on public.trip_expense_currencies;
    create trigger trip_expense_currencies_keep_owner before update on public.trip_expense_currencies
      for each row execute function public.keep_row_owner();
  end if;
end
$$;

-- ===== 招待・承認・外す(関数) =====
-- エラーは message の短い英語の印で返す。アプリがこれを見て、日本語の文に直す(src/lib/tripMembers.ts)。
--   login_required / not_allowed / trip_not_found / invalid_email / self_invite / too_many_members / invite_not_found

-- 持ち主が、メールアドレスで招く。同じアドレスをもう一度招いても、行は増えない。
create or replace function public.invite_trip_member(p_trip_id uuid, p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_trip public.trips%rowtype;
  v_row public.trip_members%rowtype;
begin
  if v_uid is null then raise exception 'login_required'; end if;
  if (auth.jwt() ->> 'client_id') is not null then raise exception 'not_allowed'; end if;

  -- 持ち主の、消えていない旅行だけ。サーバーにまだ届いていない旅行(端末にだけある)は、ここで弾かれる。
  select * into v_trip from public.trips where id = p_trip_id and user_id = v_uid and deleted_at is null;
  if not found then raise exception 'trip_not_found'; end if;

  if length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'invalid_email';
  end if;
  if v_email = public.trip_invite_email() then raise exception 'self_invite'; end if;
  if (select count(*) from public.trip_members m where m.trip_id = p_trip_id) >= 10 then
    raise exception 'too_many_members';
  end if;

  insert into public.trip_members (trip_id, owner_id, owner_email, invited_email, trip_name, trip_destination, trip_start_date, trip_end_date)
  values (p_trip_id, v_uid, public.trip_invite_email(), v_email, v_trip.name, v_trip.destination, v_trip.start_date, v_trip.end_date)
  on conflict (trip_id, invited_email) do nothing
  returning * into v_row;

  if v_row.id is null then
    select * into v_row from public.trip_members m where m.trip_id = p_trip_id and m.invited_email = v_email;
    return jsonb_build_object('id', v_row.id, 'status', v_row.status, 'alreadyInvited', true);
  end if;
  return jsonb_build_object('id', v_row.id, 'status', v_row.status, 'alreadyInvited', false);
end
$$;

-- 招かれた人が、参加する(true)／断る(false)。自分宛て(確認済みのアドレス)の承認待ちだけ。
create or replace function public.respond_trip_invite(p_trip_id uuid, p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text := public.trip_invite_email();
  v_row public.trip_members%rowtype;
begin
  if v_uid is null then raise exception 'login_required'; end if;
  if (auth.jwt() ->> 'client_id') is not null then raise exception 'not_allowed'; end if;
  if v_email = '' then raise exception 'invite_not_found'; end if;

  select * into v_row from public.trip_members m
  where m.trip_id = p_trip_id and m.status = 'pending' and m.invited_email = v_email;
  if not found then raise exception 'invite_not_found'; end if;

  if coalesce(p_accept, false) then
    -- 旅行が消されていたら、参加させない。
    if not exists (select 1 from public.trips t where t.id = p_trip_id and t.deleted_at is null) then
      delete from public.trip_members m where m.id = v_row.id;
      raise exception 'trip_not_found';
    end if;
    update public.trip_members m set status = 'accepted', member_id = v_uid, accepted_at = now() where m.id = v_row.id;
    return jsonb_build_object('tripId', p_trip_id, 'status', 'accepted');
  end if;

  delete from public.trip_members m where m.id = v_row.id;
  return jsonb_build_object('tripId', p_trip_id, 'status', 'declined');
end
$$;

-- 参加した人が、自分から抜ける。
create or replace function public.leave_trip(p_trip_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_count integer;
begin
  if v_uid is null then raise exception 'login_required'; end if;
  if (auth.jwt() ->> 'client_id') is not null then raise exception 'not_allowed'; end if;
  delete from public.trip_members m where m.trip_id = p_trip_id and m.member_id = v_uid;
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

-- 持ち主が、参加者を外す／承認待ちの招待を取り消す。
create or replace function public.remove_trip_member(p_member_row_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_count integer;
begin
  if v_uid is null then raise exception 'login_required'; end if;
  if (auth.jwt() ->> 'client_id') is not null then raise exception 'not_allowed'; end if;
  delete from public.trip_members m where m.id = p_member_row_id and m.owner_id = v_uid;
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

revoke all on function public.invite_trip_member(uuid, text) from public, anon;
revoke all on function public.respond_trip_invite(uuid, boolean) from public, anon;
revoke all on function public.leave_trip(uuid) from public, anon;
revoke all on function public.remove_trip_member(uuid) from public, anon;
grant execute on function public.invite_trip_member(uuid, text) to authenticated;
grant execute on function public.respond_trip_invite(uuid, boolean) to authenticated;
grant execute on function public.leave_trip(uuid) to authenticated;
grant execute on function public.remove_trip_member(uuid) to authenticated;

-- ===== 確かめ方(読むだけ) =====
-- select count(*) from public.trip_members;                         -- 招待の数
-- select policyname from pg_policies where tablename = 'trips';     -- "trip members …" が3つ増えていれば成功
