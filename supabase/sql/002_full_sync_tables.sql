-- LIFE HUB: 全データ同期のためのSupabaseテーブル追加
-- transactions と同じパターン(RLS: auth.uid() = user_id、set_server_updated_at()トリガー、Realtime公開)を
-- 他13テーブルに複製する。FK制約はあえて付けない(オフライン端末が親行より先に子行をpushした場合に
-- pushそのものが失敗するのを避けるため) — インデックスのみ張る。

-- ===== fixed_costs =====
create table public.fixed_costs (
  id uuid primary key,
  user_id uuid not null,
  device_id text not null,
  title text not null,
  category text not null,
  amount numeric not null,
  due_day int not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default now()
);
create index fixed_costs_user_id_idx on public.fixed_costs (user_id);
create index fixed_costs_server_updated_at_idx on public.fixed_costs (server_updated_at);
alter table public.fixed_costs enable row level security;
create policy "user manages own fixed_costs" on public.fixed_costs for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create trigger fixed_costs_set_server_updated_at before insert or update on public.fixed_costs for each row execute function set_server_updated_at();
alter publication supabase_realtime add table public.fixed_costs;

-- ===== calendar_events =====
create table public.calendar_events (
  id uuid primary key,
  user_id uuid not null,
  device_id text not null,
  title text not null,
  date date not null,
  start_time text,
  end_time text,
  all_day boolean,
  location text,
  memo text,
  category text,
  notify_minutes_before int,
  notified_at bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default now()
);
create index calendar_events_user_id_idx on public.calendar_events (user_id);
create index calendar_events_server_updated_at_idx on public.calendar_events (server_updated_at);
alter table public.calendar_events enable row level security;
create policy "user manages own calendar_events" on public.calendar_events for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create trigger calendar_events_set_server_updated_at before insert or update on public.calendar_events for each row execute function set_server_updated_at();
alter publication supabase_realtime add table public.calendar_events;

-- ===== tasks =====
create table public.tasks (
  id uuid primary key,
  user_id uuid not null,
  device_id text not null,
  title text not null,
  priority text not null,
  due_date date,
  due_time text,
  category text,
  notify_minutes_before int,
  notified_at bigint,
  completed boolean not null default false,
  completed_at bigint,
  parent_task_id uuid,
  repeat text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default now()
);
create index tasks_user_id_idx on public.tasks (user_id);
create index tasks_server_updated_at_idx on public.tasks (server_updated_at);
create index tasks_parent_task_id_idx on public.tasks (parent_task_id);
alter table public.tasks enable row level security;
create policy "user manages own tasks" on public.tasks for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create trigger tasks_set_server_updated_at before insert or update on public.tasks for each row execute function set_server_updated_at();
alter publication supabase_realtime add table public.tasks;

-- ===== notes =====
create table public.notes (
  id uuid primary key,
  user_id uuid not null,
  device_id text not null,
  type text,
  title text not null,
  body text not null,
  tags text[] not null default '{}',
  category text,
  pinned boolean not null default false,
  checklist_items jsonb,
  shopping_items jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default now()
);
create index notes_user_id_idx on public.notes (user_id);
create index notes_server_updated_at_idx on public.notes (server_updated_at);
alter table public.notes enable row level security;
create policy "user manages own notes" on public.notes for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create trigger notes_set_server_updated_at before insert or update on public.notes for each row execute function set_server_updated_at();
alter publication supabase_realtime add table public.notes;

-- ===== goals =====
create table public.goals (
  id uuid primary key,
  user_id uuid not null,
  device_id text not null,
  title text not null,
  deadline date,
  progress int not null default 0,
  category text,
  target_amount numeric,
  current_amount numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default now()
);
create index goals_user_id_idx on public.goals (user_id);
create index goals_server_updated_at_idx on public.goals (server_updated_at);
alter table public.goals enable row level security;
create policy "user manages own goals" on public.goals for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create trigger goals_set_server_updated_at before insert or update on public.goals for each row execute function set_server_updated_at();
alter publication supabase_realtime add table public.goals;

-- ===== habits =====
create table public.habits (
  id uuid primary key,
  user_id uuid not null,
  device_id text not null,
  title text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default now()
);
create index habits_user_id_idx on public.habits (user_id);
create index habits_server_updated_at_idx on public.habits (server_updated_at);
alter table public.habits enable row level security;
create policy "user manages own habits" on public.habits for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create trigger habits_set_server_updated_at before insert or update on public.habits for each row execute function set_server_updated_at();
alter publication supabase_realtime add table public.habits;

-- ===== habit_logs =====
create table public.habit_logs (
  id uuid primary key,
  user_id uuid not null,
  device_id text not null,
  habit_id uuid not null,
  date date not null,
  done boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default now()
);
create index habit_logs_user_id_idx on public.habit_logs (user_id);
create index habit_logs_server_updated_at_idx on public.habit_logs (server_updated_at);
create index habit_logs_habit_id_idx on public.habit_logs (habit_id);
alter table public.habit_logs enable row level security;
create policy "user manages own habit_logs" on public.habit_logs for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create trigger habit_logs_set_server_updated_at before insert or update on public.habit_logs for each row execute function set_server_updated_at();
alter publication supabase_realtime add table public.habit_logs;

-- ===== salaries =====
create table public.salaries (
  id uuid primary key,
  user_id uuid not null,
  device_id text not null,
  month text not null,
  payday int not null,
  amount numeric not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default now()
);
create index salaries_user_id_idx on public.salaries (user_id);
create index salaries_server_updated_at_idx on public.salaries (server_updated_at);
alter table public.salaries enable row level security;
create policy "user manages own salaries" on public.salaries for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create trigger salaries_set_server_updated_at before insert or update on public.salaries for each row execute function set_server_updated_at();
alter publication supabase_realtime add table public.salaries;

-- ===== trips =====
create table public.trips (
  id uuid primary key,
  user_id uuid not null,
  device_id text not null,
  name text not null,
  destination text not null,
  start_date date not null,
  end_date date not null,
  memo text,
  status text not null,
  budget numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default now()
);
create index trips_user_id_idx on public.trips (user_id);
create index trips_server_updated_at_idx on public.trips (server_updated_at);
alter table public.trips enable row level security;
create policy "user manages own trips" on public.trips for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create trigger trips_set_server_updated_at before insert or update on public.trips for each row execute function set_server_updated_at();
alter publication supabase_realtime add table public.trips;

-- ===== trip_schedule =====
create table public.trip_schedule (
  id uuid primary key,
  user_id uuid not null,
  device_id text not null,
  trip_id uuid not null,
  date date not null,
  start_time text,
  title text not null,
  location text,
  memo text,
  type text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default now()
);
create index trip_schedule_user_id_idx on public.trip_schedule (user_id);
create index trip_schedule_server_updated_at_idx on public.trip_schedule (server_updated_at);
create index trip_schedule_trip_id_idx on public.trip_schedule (trip_id);
alter table public.trip_schedule enable row level security;
create policy "user manages own trip_schedule" on public.trip_schedule for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create trigger trip_schedule_set_server_updated_at before insert or update on public.trip_schedule for each row execute function set_server_updated_at();
alter publication supabase_realtime add table public.trip_schedule;

-- ===== trip_expenses =====
create table public.trip_expenses (
  id uuid primary key,
  user_id uuid not null,
  device_id text not null,
  trip_id uuid not null,
  title text not null,
  amount numeric not null,
  category text not null,
  paid_date date,
  paid boolean not null default false,
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default now()
);
create index trip_expenses_user_id_idx on public.trip_expenses (user_id);
create index trip_expenses_server_updated_at_idx on public.trip_expenses (server_updated_at);
create index trip_expenses_trip_id_idx on public.trip_expenses (trip_id);
alter table public.trip_expenses enable row level security;
create policy "user manages own trip_expenses" on public.trip_expenses for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create trigger trip_expenses_set_server_updated_at before insert or update on public.trip_expenses for each row execute function set_server_updated_at();
alter publication supabase_realtime add table public.trip_expenses;

-- ===== trip_packing_items =====
create table public.trip_packing_items (
  id uuid primary key,
  user_id uuid not null,
  device_id text not null,
  trip_id uuid not null,
  title text not null,
  category text not null,
  checked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default now()
);
create index trip_packing_items_user_id_idx on public.trip_packing_items (user_id);
create index trip_packing_items_server_updated_at_idx on public.trip_packing_items (server_updated_at);
create index trip_packing_items_trip_id_idx on public.trip_packing_items (trip_id);
alter table public.trip_packing_items enable row level security;
create policy "user manages own trip_packing_items" on public.trip_packing_items for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create trigger trip_packing_items_set_server_updated_at before insert or update on public.trip_packing_items for each row execute function set_server_updated_at();
alter publication supabase_realtime add table public.trip_packing_items;

-- ===== paypay_transactions =====
create table public.paypay_transactions (
  id uuid primary key,
  user_id uuid not null,
  device_id text not null,
  external_id text not null,
  date date not null,
  amount numeric not null,
  content text not null,
  counterparty text not null,
  imported_at bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default now()
);
create index paypay_transactions_user_id_idx on public.paypay_transactions (user_id);
create index paypay_transactions_server_updated_at_idx on public.paypay_transactions (server_updated_at);
alter table public.paypay_transactions enable row level security;
create policy "user manages own paypay_transactions" on public.paypay_transactions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create trigger paypay_transactions_set_server_updated_at before insert or update on public.paypay_transactions for each row execute function set_server_updated_at();
alter publication supabase_realtime add table public.paypay_transactions;
