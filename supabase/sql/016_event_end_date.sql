-- LIFE HUB: 予定と旅行の日程に「終了日」を持たせる。
--
-- 宿泊や出張のように何日かにまたがるものを、日数ぶん別々の予定として並べるのではなく
-- 「9/27〜9/29の1件」として入れられるようにする(src/lib/eventSpan.ts)。
-- end_date が無い行は、今までどおり date の1日で終わる予定として読む。古い行を
-- 書き換える必要はない。
--
-- 【実行の順番】汎用同期エンジン(src/lib/sync.ts)は行の全項目をそのまま upsert するため、
-- この列が無い状態でアプリだけ更新すると、予定と旅行の日程の同期がすべて失敗する。必ず
-- アプリの更新より先に実行すること。列を足すだけなので、古いアプリのままでも害はない。
alter table public.calendar_events add column if not exists end_date date;
alter table public.trip_schedule add column if not exists end_date date;
