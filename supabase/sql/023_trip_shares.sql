-- LIFE HUB: 旅行のしおりを、ログインしていない人にもリンクで見せられるようにする。
--
-- 【この1本で何ができるようになるか】
-- 旅行詳細の「共有」から共有を始めると、合鍵(token)つきのURLが1本出る。
--   https://<公開サイト>/share/trip/<token>
-- そのURLを開いた人は、ログインせずに その旅行の日程・持ち物・ルート(＋設定で費用)を
-- 見るだけできる。編集はできない。共有をやめると、そのURLは即座に見られなくなる。
--
-- 【他のテーブルと作りが違う理由】
-- 002_full_sync_tables.sql から続く同期用のテーブルは、どれも
--   device_id / deleted_at / server_updated_at ＋ 差分同期のトリガ ＋ realtime公開
-- を持っている。このテーブルはそれを**どれも持たない**。理由は、共有の入り切りが
-- 端末内(Dexie)を経由しない — 旅行詳細から Supabase を直接読み書きするため。
--   * 端末に置いて同期に載せると、「OFFにしたのに、まだ送信できていない端末の都合で
--     しばらく見られたまま」が起き得る。共有をやめた瞬間に切れることを優先した。
--   * 同期の送信列(sync_queue)にも載らないので、このテーブルが原因で他のテーブルの
--     送信が止まることがない(021 の時に踏みかけた事故)。
-- そのぶん、共有の入り切りはオンラインの時だけできる(画面にもそう出している)。
--
-- 【実行の順番】このSQLを先に流す。流すまでは、アプリの「共有」を開いても
-- 「共有の設定を読めませんでした」と出るだけで、他の機能には影響しない。
-- 021/022 と違って、流したあとにアプリ側でやることは無い(2段階目は不要)。

-- ===== 共有の合鍵 =====
-- 旅行1件につき1行まで(trip_id に一意索引)。共有をやめる＝この行を消す、なので
-- 「やめたのに古いURLがまだ生きている」状態が残らない。もう一度共有する時は
-- 新しい token で入れ直す(使い回さない)。
create table if not exists public.trip_shares (
  id uuid primary key,
  user_id uuid not null,
  trip_id uuid not null,
  -- 合鍵。端末側で crypto.randomUUID() を2つ繋いだ32文字×2(src/lib/tripShare.ts)。
  -- これを知っている人だけが下の関数で中身を読める。
  token text not null unique,
  -- 費用(誰がいくら払ったか)を共有に含めるか。既定は含めない。
  -- 日記はトグルも作らない — 常に共有しない(2026-09-04の指示)。
  include_expenses boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists trip_shares_trip_id_key on public.trip_shares (trip_id);
create index if not exists trip_shares_user_id_idx on public.trip_shares (user_id);

-- 本人以外はこの表そのものを読めない(合鍵の一覧が漏れないように)。
-- 共有リンクの人は、下の関数ごしにしか触れない。
alter table public.trip_shares enable row level security;
drop policy if exists "user manages own trip_shares" on public.trip_shares;
create policy "user manages own trip_shares" on public.trip_shares for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ===== 合鍵で中身を読む =====
-- security definer にしているので、この関数の中だけは RLS を越えて持ち主の行を読める。
-- 代わりに、外に出す項目をここで1つずつ選んでいる:
--   * 日記(diary_entries)は入れない — 書いた場所の緯度経度まで持っているため。
--   * user_id / device_id / 内部のid も返さない。
--   * 費用は include_expenses が true の時だけ。
-- token を知らない限り1行も返らない(where token = p_token)。存在しない token・
-- 共有をやめたあとの token では null が返り、画面は「共有は終了しました」と出す。
create or replace function public.get_shared_trip(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'includeExpenses', s.include_expenses,
    'trip', (
      select jsonb_build_object(
        'name', t.name,
        'destination', t.destination,
        'startDate', t.start_date,
        'endDate', t.end_date,
        'memo', t.memo,
        'status', t.status
      )
      from public.trips t
      where t.id = s.trip_id and t.user_id = s.user_id and t.deleted_at is null
    ),
    'schedule', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', x.date,
        'endDate', x.end_date,
        'startTime', x.start_time,
        'endTime', x.end_time,
        'title', x.title,
        'location', x.location,
        'memo', x.memo,
        'type', x.type
      ) order by x.date, x.start_time nulls first, x.created_at)
      from public.trip_schedule x
      where x.trip_id = s.trip_id and x.user_id = s.user_id and x.deleted_at is null
    ), '[]'::jsonb),
    'packing', coalesce((
      select jsonb_agg(jsonb_build_object(
        'title', x.title,
        'category', x.category,
        'checked', x.checked
      ) order by x.created_at)
      from public.trip_packing_items x
      where x.trip_id = s.trip_id and x.user_id = s.user_id and x.deleted_at is null
    ), '[]'::jsonb),
    'route', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', x.name,
        'address', x.address,
        'sortOrder', x.sort_order,
        'date', x.date,
        'memo', x.memo,
        'visited', x.visited
      ) order by x.sort_order)
      from public.trip_route_places x
      where x.trip_id = s.trip_id and x.user_id = s.user_id and x.deleted_at is null
    ), '[]'::jsonb),
    -- 費用。含めない設定なら、問い合わせごと行わずに空で返す。
    -- 現地通貨の内訳(021)が付いている支出は、それも一緒に出す — 同行者と
    -- 割り勘を確かめる時に「€45(6,750円)」まで見えた方が分かるため。
    'expenses', case when s.include_expenses then coalesce((
      select jsonb_agg(jsonb_build_object(
        'title', x.title,
        'amount', x.amount,
        'category', x.category,
        'paidDate', x.paid_date,
        'paid', x.paid,
        'memo', x.memo,
        'currency', c.currency,
        'originalAmount', c.original_amount
      ) order by x.paid_date nulls last, x.created_at)
      from public.trip_expenses x
      left join public.trip_expense_currencies c
        on c.expense_id = x.id and c.user_id = s.user_id and c.deleted_at is null
      where x.trip_id = s.trip_id and x.user_id = s.user_id and x.deleted_at is null
    ), '[]'::jsonb) else '[]'::jsonb end
  )
  from public.trip_shares s
  where s.token = p_token;
$$;

-- ログインしていない人(anon)から呼べるようにする。これが共有リンクの入り口。
revoke all on function public.get_shared_trip(text) from public;
grant execute on function public.get_shared_trip(text) to anon, authenticated;
