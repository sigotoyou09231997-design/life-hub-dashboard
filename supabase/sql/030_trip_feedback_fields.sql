-- LIFE HUB: 要望の受信箱に届いた5件(2026-10-11)のうち、欄を足す必要がある4件ぶん。
--
-- 【この1本で何ができるようになるか】
-- * 予定: 移動なら「何で移動するか」(transport_mode)。住所・電話番号・URL・営業時間、
--   ホテルならチェックイン・チェックアウトの時刻。
-- * 持ち物: 並び順(sort_order)。長押しして指で動かして並べ替えられるようにする。
-- * 旅行: 参加している人(members、名前の配列)。
-- * 費用: 誰が払ったか(paid_by、参加者の名前)と、どの予定の費用か(schedule_id)。
-- * 共有したしおり(get_shared_trip)にも、上の項目を出す。
--
-- 【実行の順番】**アプリを出す前に、このSQLを流す。** 同期する表に欄を足すので、流す前に
-- アプリを出すと、ビルド前の確認(scripts/check-prod-schema.mjs)がデプロイを止める
-- (止めないと、新しい欄を持つ予定だけ同期できなくなる)。どの欄も空のままでよく、
-- 今ある行には何も起きない。

-- ===== 予定 =====
alter table public.trip_schedule add column if not exists transport_mode text;
alter table public.trip_schedule add column if not exists address text;
alter table public.trip_schedule add column if not exists phone text;
alter table public.trip_schedule add column if not exists url text;
alter table public.trip_schedule add column if not exists opening_hours text;
alter table public.trip_schedule add column if not exists check_in_time text;
alter table public.trip_schedule add column if not exists check_out_time text;

-- ===== 持ち物 =====
alter table public.trip_packing_items add column if not exists sort_order integer;

-- ===== 旅行・費用 =====
alter table public.trips add column if not exists members jsonb;
alter table public.trip_expenses add column if not exists paid_by text;
alter table public.trip_expenses add column if not exists schedule_id uuid;

-- ===== 共有したしおり(023 の get_shared_trip に、上の項目を足したもの) =====
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
        'status', t.status,
        'members', t.members
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
        'type', x.type,
        'transportMode', x.transport_mode,
        'address', x.address,
        'phone', x.phone,
        'url', x.url,
        'openingHours', x.opening_hours,
        'checkInTime', x.check_in_time,
        'checkOutTime', x.check_out_time
      ) order by x.date, x.start_time nulls first, x.created_at)
      from public.trip_schedule x
      where x.trip_id = s.trip_id and x.user_id = s.user_id and x.deleted_at is null
    ), '[]'::jsonb),
    'packing', coalesce((
      select jsonb_agg(jsonb_build_object(
        'title', x.title,
        'category', x.category,
        'checked', x.checked,
        'sortOrder', x.sort_order
      ) order by x.sort_order nulls last, x.created_at)
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
    'expenses', case when s.include_expenses then coalesce((
      select jsonb_agg(jsonb_build_object(
        'title', x.title,
        'amount', x.amount,
        'category', x.category,
        'paidDate', x.paid_date,
        'paid', x.paid,
        'memo', x.memo,
        'paidBy', x.paid_by,
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

revoke all on function public.get_shared_trip(text) from public;
grant execute on function public.get_shared_trip(text) to anon, authenticated;

-- 確かめ: 11 と出れば、足す欄はすべてある。
select count(*) as added_columns
from information_schema.columns
where table_schema = 'public'
  and (table_name, column_name) in (
    ('trip_schedule', 'transport_mode'), ('trip_schedule', 'address'), ('trip_schedule', 'phone'),
    ('trip_schedule', 'url'), ('trip_schedule', 'opening_hours'), ('trip_schedule', 'check_in_time'),
    ('trip_schedule', 'check_out_time'), ('trip_packing_items', 'sort_order'), ('trips', 'members'),
    ('trip_expenses', 'paid_by'), ('trip_expenses', 'schedule_id')
  );
