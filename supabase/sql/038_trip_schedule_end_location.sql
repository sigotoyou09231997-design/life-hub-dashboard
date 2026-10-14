-- LIFE HUB: 日程の「移動」に、出発地と目的地(2026-10-14、要望の受信箱「日程で経路の場合、出発地と目的地を入れられるといい」)。
--
-- 【この1本で何ができるようになるか】
-- * 予定: 移動の「目的地」(end_location)。「場所」(location)は、移動では出発地として使う(これまでの場所は、そのまま出発地になる)。
--   目的地を入れると、日程に「出発地 → 目的地」と出て、ルート・1日の経路にも、出発地と目的地の2つの場所が入る。
-- * 共有したしおり(get_shared_trip)も、目的地を出す(031 のものに、目的地を足しただけ)。
--
-- 【実行の順番】**アプリを出す前に、このSQLを流す。** 同期する表に欄を足すので、流す前に
-- アプリを出すと、ビルド前の確認(scripts/check-prod-schema.mjs)がデプロイを止める。
-- 欄は空のままでよく、今ある行には何も起きない(目的地が空なら、これまでどおり出発地だけ)。

alter table public.trip_schedule add column if not exists end_location text;

-- ===== 共有したしおり(031 の get_shared_trip に、予定の目的地を足したもの) =====
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
        'endLocation', x.end_location,
        'memo', x.memo,
        'type', x.type,
        'transportMode', x.transport_mode,
        'address', x.address,
        'phone', x.phone,
        'url', x.url,
        'openingHours', x.opening_hours,
        'checkInTime', x.check_in_time,
        'checkOutTime', x.check_out_time,
        'sortOrder', x.sort_order
      ) order by x.date, x.start_time nulls first, x.sort_order nulls last, x.created_at)
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

-- 確かめ: 1 と出れば、欄はある。
select count(*) as added_columns
from information_schema.columns
where table_schema = 'public' and table_name = 'trip_schedule' and column_name = 'end_location';
