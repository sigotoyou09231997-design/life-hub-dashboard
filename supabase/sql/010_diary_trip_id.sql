-- LIFE HUB: 日記を旅行に紐づけられるようにする。
-- 旅行詳細に「日記」タブを足し、そこから書いた日記はその旅行の日として残る。
-- 端末側は索引を張らない追加の任意フィールドなので Dexie のバージョンは上げていない
-- (索引の無い追加フィールドは IndexedDB では移行不要 — 既存の行は tripId 無しのまま
--  読めて、旅行の外で書いた日記として扱われる)。
--
-- 旅行を削除しても日記は消さず、紐づけだけ外す(書いたものを消さないため)。
-- そのため外部キー制約は張らない。

alter table public.diary_entries add column if not exists trip_id uuid;
create index if not exists diary_entries_trip_id_idx on public.diary_entries (trip_id);
