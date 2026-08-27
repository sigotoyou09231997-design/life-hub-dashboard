-- LIFE HUB: 予定(CalendarEvent)に繰り返し設定を持たせる。
--
-- Taskのrepeat("none"/"daily"/"weekly"/"monthly")と同じ考え方で、繰り返す予定の
-- 将来の回はこの行を増やさずその都度計算で出す(src/lib/eventSpan.ts の
-- occursOn/spanDayIndex)。repeat_untilは繰り返しの最終日で、無ければ開始日から
-- 約2年間を上限として続ける。
--
-- 【実行の順番】汎用同期エンジン(src/lib/sync.ts)は行の全項目をそのまま upsert するため、
-- この列が無い状態でアプリだけ更新すると、繰り返しを設定した予定の同期が失敗する。必ず
-- アプリの更新より先に実行すること。列を足すだけなので、古いアプリのままでも害はない。
alter table public.calendar_events add column if not exists repeat text;
alter table public.calendar_events add column if not exists repeat_until date;
