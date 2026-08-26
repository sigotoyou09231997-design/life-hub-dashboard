-- LIFE HUB: メールに付けた「重要」を端末間で揃えるための列
-- (011_gmail_message_state.sql の続き)。
--
-- 既読と同じ扱いにする: 値は「重要を付けた時刻」で、外したら null に戻す。
-- 競合は同じ updated_at による last-write-wins で解決する(src/lib/gmailMessageState.ts)。
--
-- 【実行の順番】アプリはこの列を含めて upsert / select するため、列が無いまま
-- アプリだけ更新すると、既読と重要の同期がまとめて失敗する。必ずアプリの更新より
-- 先に実行すること。列を足すだけなので、古いアプリのままでも害はない。
alter table public.gmail_message_state add column if not exists important_at timestamptz;
