-- LIFE HUB: 旅行の「行きたい場所」(ルート)を追加する。
-- クライアント側は同じコミットで Dexie v12 に tripRoutePlaces を作り、
-- src/lib/syncRuntime.ts の registerSyncedTable に trip_route_places を足している。
-- ここはそのサーバー側(Supabase)を作る。
--
-- 002_full_sync_tables.sql の他テーブルと同じ作法:
--   id は uuid の主キー(端末側で採番したUUIDをそのまま入れる)
--   user_id / device_id / created_at / updated_at / deleted_at / server_updated_at
--   RLS で自分の行だけ、server_updated_at はトリガで打ち直し、realtime に載せる
-- trip_id には外部キー制約を張らない(002の trip_schedule などと同じ) — 端末側が
-- 旅行本体より先に子行を送ってくることがあり、制約があるとその push が落ちるため。

create table public.trip_route_places (
  id uuid primary key,
  user_id uuid not null,
  device_id text not null,
  trip_id uuid not null,
  name text not null,
  address text not null,
  sort_order integer not null default 0,
  memo text,
  visited boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default now()
);
create index trip_route_places_user_id_idx on public.trip_route_places (user_id);
create index trip_route_places_server_updated_at_idx on public.trip_route_places (server_updated_at);
create index trip_route_places_trip_id_idx on public.trip_route_places (trip_id);
alter table public.trip_route_places enable row level security;
create policy "user manages own trip_route_places" on public.trip_route_places for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create trigger trip_route_places_set_server_updated_at before insert or update on public.trip_route_places for each row execute function set_server_updated_at();
alter publication supabase_realtime add table public.trip_route_places;
