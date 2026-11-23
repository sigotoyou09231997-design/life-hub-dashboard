-- LIFE HUB: メールの「既読」「重要」(011_gmail_message_state.sql)を、他の端末へその場で流す(2026-11-23)。
--
-- これまでは各端末が聞きに行った時(画面を開いた・戻った・1分ごと)にしか揃わなかった。
-- 本人「即時にしたい」。予定などの表と同じく、Supabase のリアルタイムの配信に載せる
-- (src/lib/gmailMessageState.ts の subscribeMessageStates が受け取る)。
-- 誰の行が届くかは RLS("user manages own gmail_message_state")のとおり、本人の行だけ。
--
-- 足すだけ・何度流しても同じ(既に載っていれば何もしない)。
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'gmail_message_state'
  ) then
    alter publication supabase_realtime add table public.gmail_message_state;
  end if;
end $$;
