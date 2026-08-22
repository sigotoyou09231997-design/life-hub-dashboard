-- LIFE HUB: 日記・目標・習慣の廃止にともなう後片付け。
-- クライアント側は同じコミットで画面・型・Dexieのテーブル(v11で削除)まで消しており、
-- src/lib/syncRuntime.ts の registerSyncedTable からも goals / habits / habit_logs を外した。
-- ここはその3テーブルのサーバー側(Supabase)を落とす。
--
-- 注意: 実行すると保存済みの目標・習慣の記録は復元できない。必要なら実行前に
-- Supabaseのダッシュボードから該当テーブルをCSVで書き出しておくこと。
-- (日記 diaryEntries は端末内のDexieだけに保存していた機能で、Supabase側の
--  テーブルは元から存在しない。)

-- publicationからの除外はdrop tableで自動的に行われるため、drop tableだけでよい。
-- habit_logs.habit_id は外部キー制約ではないので、順序の制約もない。
drop table if exists public.habit_logs;
drop table if exists public.habits;
drop table if exists public.goals;
