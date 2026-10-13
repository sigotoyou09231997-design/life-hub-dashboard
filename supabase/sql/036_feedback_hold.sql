-- LIFE HUB: 修正依頼に「保留中」の状態と、保留の理由の一言を足す。
--
-- 【なぜ要るか】
-- 直さずに保留にした依頼(意味が分からず聞き返している・本人の判断待ち、など)も、アプリでは「受け付け済み」のままで、
-- 送った人から見ると「やっているのか、止まっているのか」が分からなかった(2026-10-14、本人「保留中というラベルをつけたい」)。
--   new(受け付け済み) → working(修正中、035) / hold(保留中) → done(対応済み) / dismissed(見送り)
-- 保留にする時は、持ち主の Mac から scripts/feedback-inbox.mjs --hold <id> "理由" で印と理由を付ける。
-- アプリは、送った人の「修正」ボタンの一覧と、持ち主の受信箱に「保留中」と理由を出す。
--
-- 【この SQL がすること】
--   * status_note(保留の理由・聞きたいこと。300字まで)の列を足す。
--   * status の許す値に 'hold' を足す(check の作り直し)。
--   * Mac から印を付ける関数 app_feedback_set_status が 'hold' も受けるようにする(035 のものを入れ替える)。
--     hold 以外の状態にしたら、理由は消す。
--   * 理由つきで保留にする関数 app_feedback_hold を足す。
--
-- 【この SQL が触らないもの】
-- 既存の行は一切変えない。app_feedback_inbox(Mac の見張り)は変えない(既定では「未対応(new)」だけを返すので、
-- 保留にした依頼が、見張りに何度も流れてくることはない)。画像を消す仕組み(033)は、対応済み・見送りの時だけ働く。
--
-- 【実行の順番】先にこの SQL を流す。流す前でも、アプリは何も変わらない(「保留中」が出ないだけ)。流したあとにアプリ側でやることは無い。

alter table public.app_feedback add column if not exists status_note text;
alter table public.app_feedback drop constraint if exists app_feedback_status_note_length;
alter table public.app_feedback add constraint app_feedback_status_note_length check (status_note is null or char_length(status_note) <= 300);

alter table public.app_feedback drop constraint if exists app_feedback_status_check;
alter table public.app_feedback add constraint app_feedback_status_check check (status in ('new', 'working', 'hold', 'done', 'dismissed'));

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
        -- 保留の理由は、保留の間だけ。ほかの状態にしたら消す(古い理由が残って、いまの状態と食い違わないように)。
        status_note = case when p_status = 'hold' then status_note else null end
    where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.app_feedback_set_status(text, uuid, text) from public;
grant execute on function public.app_feedback_set_status(text, uuid, text) to anon, authenticated;

-- 保留中にする(理由つき)。理由は前後の空白を落とし、300字までに切る。空なら理由なしの保留中。
create or replace function public.app_feedback_hold(p_code text, p_id uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 300), '');
begin
  if not exists (
    select 1 from public.app_feedback_read_codes
    where code_hash = encode(sha256(convert_to(coalesce(p_code, ''), 'utf8')), 'hex')
  ) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_code');
  end if;
  update public.app_feedback
    set status = 'hold', resolved_at = null, status_note = v_note
    where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.app_feedback_hold(text, uuid, text) from public;
grant execute on function public.app_feedback_hold(text, uuid, text) to anon, authenticated;

-- 確かめ方(読むだけ): select status, count(*) from public.app_feedback group by status;
