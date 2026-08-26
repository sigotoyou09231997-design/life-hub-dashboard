-- LIFE HUB: 旅行の日程に「終了時刻(到着時刻)」を持たせる。
--
-- 新幹線や飛行機の予約メールには到着時刻まで書かれていることが多く、日程表に
-- 「10:05〜13:20」と出せると当日の動きが分かる(src/components/gmail/MailPlanImport.tsx)。
-- 予定(calendar_events)は元から end_time を持っており、そちらに合わせる形。
--
-- 【実行の順番】汎用同期エンジン(src/lib/sync.ts)は行の全項目をそのまま upsert するため、
-- この列が無い状態でアプリだけ更新すると、旅行の日程の同期がすべて失敗する。必ずアプリの
-- 更新より先に実行すること。列を足すだけなので、古いアプリのままでも害はない。
alter table public.trip_schedule add column if not exists end_time text;
