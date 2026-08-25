-- LIFE HUB: 同じ予定を複数のアカウントに入れた時、それらを1つのまとまりとして
-- 結び付けるためのID(src/lib/crossAccountEvents.ts)。
--
-- これが無いと、片方で予定を直しても、入れた先のアカウントのどれが対応する予定なのか
-- 分からない。そのため編集のたびに相手側へ「新しく1件」足すしかなく、行き来して直すと
-- 相手のスケジュールに同じ予定が積み上がっていた(2026-08-25)。
--
-- 行そのものはアカウントごとに別の持ち主(user_id)のままで、RLSも今までどおり user_id で
-- 効く。link_id はその行どうしが「同じ予定」であることだけを表す。
--
-- 【実行の順番】汎用同期エンジン(src/lib/sync.ts)は行の全項目をそのまま upsert するため、
-- この列が無い状態でアプリだけ更新すると、予定の同期がすべて失敗する。必ずアプリの更新より
-- 先に実行すること。列を足すだけなので、古いアプリのままでも害はない。
alter table public.calendar_events add column if not exists link_id uuid;

-- 相手のアカウントの予定を link_id で引くので索引を張る。
create index if not exists calendar_events_link_id_idx on public.calendar_events (link_id);
