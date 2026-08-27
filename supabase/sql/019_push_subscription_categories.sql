-- LIFE HUB: プッシュ通知のカテゴリごとON/OFFを持たせる。
--
-- push_subscriptionsは元々Gmail新着通知とアプリ更新通知の両方に共用されており、
-- 端末が購読していれば無条件に両方届いていた。設定画面でカテゴリごとに止められる
-- ようにするため、「この端末で止めているカテゴリ」を配列で持つ列を足す。
-- 値は 'gmail' / 'app_update' / 'events' / 'tasks' / 'fixed_costs' のいずれか。
-- null・空配列は「すべて有効」(今までどおり)を意味する — 既存の購読は列を足しても
-- 挙動が変わらない。
alter table public.push_subscriptions add column if not exists disabled_categories text[];
