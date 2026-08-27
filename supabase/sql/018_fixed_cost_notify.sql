-- LIFE HUB: 固定費の支払日リマインダー用の列を追加。
--
-- notify_days_before: 支払日の何日前に通知するか(0=当日)。未設定なら通知しない。
-- last_notified_month: 直近で通知を送った月(YYYY-MM)。毎月の支払日ごとに1回だけ
-- 通知するための印で、netlify/functions/checkRemindersAndNotify.tsが更新する。
--
-- 【実行の順番】汎用同期エンジン(src/lib/sync.ts)は行の全項目をそのまま upsert するため、
-- この列が無い状態でアプリだけ更新すると、固定費の同期が失敗する。必ずアプリの更新より
-- 先に実行すること。列を足すだけなので、古いアプリのままでも害はない。
alter table public.fixed_costs add column if not exists notify_days_before int;
alter table public.fixed_costs add column if not exists last_notified_month text;
