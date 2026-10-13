-- LIFE HUB: 修正依頼に「かかる時間の目安」(分)を足す。
--
-- 【なぜ要るか】
-- 「修正中」と出ても、あとどれくらいかかるのかが分からなかった(2026-10-14、本人「修正にどれくらいかかるか時間も出して、
-- ゲージ表示もあると便利」)。直し始める時に、これまでの実績(scripts/estimate-fix.mjs)から目安の分数を出して、一緒に付ける。
-- アプリは、修正中の依頼に「目安 約○分・経過 ○分」と、経過の割合のゲージを出す。
--
-- 【この SQL がすること】
--   * estimate_minutes(目安の分。1〜600)の列を足す。
--   * 修正中にして目安を付ける関数 app_feedback_start を足す(scripts/feedback-inbox.mjs --working <id> --estimate <分>)。
--   * app_feedback_set_status を入れ替える: 未対応・保留中・修正中(目安なし)にしたら、目安は消す(いまの状態と食い違う古い目安を残さない)。
--     対応済み・見送りにしても、目安は残す(あとから、目安と実際を比べられるように)。
--
-- 【この SQL が触らないもの】既存の行・app_feedback_inbox(Mac の見張り)・画像を消す仕組み(033)・035/036 の働き。
-- 【実行の順番】035 → 036 → この SQL。先に、この SQL を流す(アプリより先)。流す前でも、アプリは何も変わらない(目安とゲージが出ないだけ)。流したあとにアプリ側でやることは無い。

-- 035(working_at)と 036(status_note)が先に流れていること。流れていないと、下の app_feedback_set_status が実行時に落ちて、状態が変えられなくなる。
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'app_feedback' and column_name = 'working_at')
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'app_feedback' and column_name = 'status_note') then
    raise exception '先に 035_feedback_working.sql と 036_feedback_hold.sql を流してください(working_at / status_note の列がありません)';
  end if;
end
$$;

alter table public.app_feedback add column if not exists estimate_minutes integer;
alter table public.app_feedback drop constraint if exists app_feedback_estimate_range;
alter table public.app_feedback add constraint app_feedback_estimate_range check (estimate_minutes is null or estimate_minutes between 1 and 600);

create or replace function public.app_feedback_set_status(p_code text, p_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.app_feedback_read_codes
    where code_hash = encode(sha256(convert_to(coalesce(p_code, ''), 'utf8')), 'hex')
  ) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_code');
  end if;
  if p_status not in ('new', 'working', 'hold', 'done', 'dismissed') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_status');
  end if;
  update public.app_feedback
    set status = p_status,
        resolved_at = case when p_status in ('new', 'working', 'hold') then null else now() end,
        working_at = case p_status when 'working' then now() when 'new' then null else working_at end,
        status_note = case when p_status = 'hold' then status_note else null end,
        -- 目安は、いま進めている間だけ意味がある。未対応・保留中・目安なしの修正中にしたら消す。終わったあと(対応済み・見送り)は、実績と比べるために残す。
        estimate_minutes = case when p_status in ('new', 'hold', 'working') then null else estimate_minutes end
    where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.app_feedback_set_status(text, uuid, text) from public;
grant execute on function public.app_feedback_set_status(text, uuid, text) to anon, authenticated;

-- 修正中にして、かかる時間の目安(分)を付ける。分は1〜600に収める(範囲の外は、端に寄せる)。
create or replace function public.app_feedback_start(p_code text, p_id uuid, p_minutes integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_minutes integer := case when p_minutes is null then null else least(greatest(p_minutes, 1), 600) end;
begin
  if not exists (
    select 1 from public.app_feedback_read_codes
    where code_hash = encode(sha256(convert_to(coalesce(p_code, ''), 'utf8')), 'hex')
  ) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_code');
  end if;
  update public.app_feedback
    set status = 'working', resolved_at = null, working_at = now(), status_note = null, estimate_minutes = v_minutes
    where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.app_feedback_start(text, uuid, integer) from public;
grant execute on function public.app_feedback_start(text, uuid, integer) to anon, authenticated;

-- 確かめ方(読むだけ): select status, estimate_minutes, working_at from public.app_feedback where status = 'working';
