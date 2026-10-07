-- LIFE HUB: ChatGPT などの「外のアプリ」(OAuth で接続したアプリ)が使うトークンの届く範囲を、DB の側で絞る。
--
-- 【なぜ要るか】
-- ChatGPT から LIFE HUB のアカウントにログイン(OAuth)して旅行・日程を作る機能(api/mcp.ts)では、
-- ChatGPT は「その人としてログインしたトークン」を持つ。Supabase のトークンは、そのままだと
-- **その人の行レベルの権限をまるごと**持つので、MCP サーバーが旅行のツールしか呼ばなくても、
-- トークン自体は日記・家計・Gmail の接続情報(gmail_server_accounts)まで読み書きできてしまう。
-- 同意画面に「旅行以外は対象外・消したり書き換えたりはしない」と書く以上、約束をアプリの
-- コードだけに任せず、**DB の側で本当に止まる**ようにする。
--
-- 【仕組み】
-- OAuth で発行されたトークンには client_id の印(claim)が付く。アプリ自身のログインのトークンには付かない。
-- そこで、制限つきポリシー(restrictive = 他のポリシーに「加えて」満たす必要がある)を足す:
--   * 旅行(trips)と日程(trip_schedule)以外の、RLS がある全部の表: client_id が付いたトークンは、
--     読むことも書くこともできない。
--   * 旅行と日程: 読む・足す(INSERT)はできるが、更新・削除はできない。
-- アプリ自身のトークンには client_id が無いので、これまでどおり。何も変わらない。
--
-- 【この SQL が触らないもの】
-- 表の中身(行)は一切変えない。ポリシーを足すだけ。流し直しても同じ結果(既存のものは作り直す)。
-- security definer の関数(get_shared_trip・receive_chatgpt_trip)は RLS を通らないので、影響を受けない。
--
-- 【実行の順番】ChatGPT から LIFE HUB に接続する機能を、自分以外が使い始める**前**に流す。
-- 流す前でも、アプリは何も変わらない。
-- 【新しい表を足す時】RLS を付けた表を足したら、この SQL の下のほうの DO ブロックを、もう一度流す
-- (表の一覧を調べて、同じポリシーを足す)。足し忘れを、リポジトリのテストが止める(supabase/__tests__/migrations.test.ts。
-- 本物の Postgres に、この SQL ごと流して確かめている)。
--
-- 【確かめ方】下の「確かめ方」のSQLを、SQL Editor で流す(読むだけ)。

-- ===== 旅行・日程以外の全部の表: OAuth のトークンは、何もできない =====
do $$
declare
  t record;
begin
  for t in
    select c.relname as name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and c.relrowsecurity
      and c.relname not in ('trips', 'trip_schedule')
  loop
    execute format('drop policy if exists "oauth clients blocked" on public.%I', t.name);
    execute format(
      'create policy "oauth clients blocked" on public.%I as restrictive for all to authenticated '
      'using ((auth.jwt() ->> ''client_id'') is null) with check ((auth.jwt() ->> ''client_id'') is null)',
      t.name
    );
  end loop;
end
$$;

-- ===== 旅行・日程: 読む・足すだけ。更新と削除は、OAuth のトークンではできない =====
drop policy if exists "oauth clients cannot update trips" on public.trips;
create policy "oauth clients cannot update trips" on public.trips as restrictive for update to authenticated
  using ((auth.jwt() ->> 'client_id') is null) with check ((auth.jwt() ->> 'client_id') is null);
drop policy if exists "oauth clients cannot delete trips" on public.trips;
create policy "oauth clients cannot delete trips" on public.trips as restrictive for delete to authenticated
  using ((auth.jwt() ->> 'client_id') is null);

drop policy if exists "oauth clients cannot update trip_schedule" on public.trip_schedule;
create policy "oauth clients cannot update trip_schedule" on public.trip_schedule as restrictive for update to authenticated
  using ((auth.jwt() ->> 'client_id') is null) with check ((auth.jwt() ->> 'client_id') is null);
drop policy if exists "oauth clients cannot delete trip_schedule" on public.trip_schedule;
create policy "oauth clients cannot delete trip_schedule" on public.trip_schedule as restrictive for delete to authenticated
  using ((auth.jwt() ->> 'client_id') is null);

-- ===== 確かめ方(読むだけ。流した後に、SQL Editor で) =====
-- 1) RLS があるのに、制限が付いていない表が無いこと(0行が正しい)。trips / trip_schedule は別の名前で付く。
--    select c.relname
--    from pg_class c join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public' and c.relkind in ('r','p') and c.relrowsecurity
--      and c.relname not in ('trips','trip_schedule')
--      and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname and p.policyname = 'oauth clients blocked');
-- 2) 旅行・日程に、更新・削除の制限が付いていること(4行が正しい)。
--    select tablename, policyname, cmd, permissive from pg_policies
--    where schemaname = 'public' and policyname like 'oauth clients cannot%' order by 1, 2;
-- 3) OAuth のトークンの真似をして、日記が読めないこと(0行が正しい)。**1つずつ**流す。
--    begin;
--      set local role authenticated;
--      select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000000","role":"authenticated","client_id":"test"}', true);
--      select count(*) from public.diary_entries;
--    rollback;
