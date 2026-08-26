-- LIFE HUB: ルートの場所に「何日目か」を持たせる。
--
-- ルート画面(src/components/trips/TripRouteView.tsx)を日にちで切り替えられるようにする。
-- 場所が増えるほど横一列が長くなり、その日に回るぶんだけを見たくなるため。日付は
-- 任意で、決めていない場所は「日付なし」として今まで通り出る。
--
-- 【実行の順番】汎用同期エンジン(src/lib/sync.ts)は行の全項目をそのまま upsert するため、
-- この列が無い状態で日付を付けると、ルートの場所の同期が失敗する。必ずアプリの更新より
-- 先に実行すること。列を足すだけなので、古いアプリのままでも害はない。
alter table public.trip_route_places add column if not exists date text;
