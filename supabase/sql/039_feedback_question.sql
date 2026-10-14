-- LIFE HUB: 保留にした依頼に、送った人への質問(選ぶボタン)を付けて、答えを持ち主に返す(2026-10-14、
-- 持ち主「これから保留にしたやつで、質問者に質問を送って、質問者がボタンを押したらその回答がこっちに送信されるようにして欲しい」)。
--
-- 【流れ】
--   1. 持ち主の Mac: node scripts/feedback-inbox.mjs --hold <id> "質問" --option "A" --option "B" …
--      → 依頼が「保留中」になり、質問とボタンの選択肢(2〜6つ)が付く。
--   2. 送った人: アプリの「修正」を開くと、保留中の依頼に質問とボタンが出る。ボタンを押すと、答えが送られて、依頼は「対応待ち」に戻る。
--   3. 持ち主: 見張り(scripts/feedback-watch.mjs)に「回答が届いた」が出る。それを見て、直す。
--
-- 【この SQL がすること】
--   * 列を足す: question_options(選択肢。文字の配列)・answer(押された答え)・answered_at(いつ)。
--   * app_feedback_ask(持ち主の Mac から。質問つきで保留中にする)を足す。
--   * app_feedback_answer(送った人が、ボタンを押した時。自分が送った・保留中・選択肢にある答え、の時だけ)を足す。
--   * app_feedback_inbox(Mac の見張り)に、質問・選択肢・答えを出す(033 のものに足しただけ)。
--
-- 【この SQL が触らないもの】既存の行・app_feedback_set_status・app_feedback_hold(質問なしの保留中は今までどおり)・画像・権限の決まり
-- (送った人が自分の依頼の行を更新できるようにはしない。答えは、下の関数だけを通る)。
-- 【実行の順番】先にこの SQL を流す(アプリより先)。流す前でも、アプリは何も変わらない(質問のボタンが出ないだけ)。

alter table public.app_feedback add column if not exists question_options jsonb;
alter table public.app_feedback add column if not exists answer text;
alter table public.app_feedback add column if not exists answered_at timestamptz;
alter table public.app_feedback drop constraint if exists app_feedback_answer_length;
alter table public.app_feedback add constraint app_feedback_answer_length check (answer is null or char_length(answer) <= 60);
alter table public.app_feedback drop constraint if exists app_feedback_question_options_shape;
alter table public.app_feedback add constraint app_feedback_question_options_shape
  check (question_options is null or (jsonb_typeof(question_options) = 'array' and jsonb_array_length(question_options) between 2 and 6));

-- 質問つきで保留中にする。選択肢は2〜6つ、1つ60字まで(前後の空白を落とし、空・重複は除く)。質問(理由)は300字まで。
create or replace function public.app_feedback_ask(p_code text, p_id uuid, p_note text, p_options jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 300), '');
  v_options jsonb;
begin
  if not exists (
    select 1 from public.app_feedback_read_codes
    where code_hash = encode(sha256(convert_to(coalesce(p_code, ''), 'utf8')), 'hex')
  ) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_code');
  end if;
  if p_options is null or jsonb_typeof(p_options) <> 'array' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_options');
  end if;
  select coalesce(jsonb_agg(opt order by first_pos), '[]'::jsonb) into v_options
  from (
    select left(btrim(value), 60) as opt, min(ordinality) as first_pos
    from jsonb_array_elements_text(p_options) with ordinality as t(value, ordinality)
    where btrim(value) <> ''
    group by left(btrim(value), 60)
  ) cleaned;
  if jsonb_array_length(v_options) < 2 or jsonb_array_length(v_options) > 6 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_options');
  end if;
  update public.app_feedback
    set status = 'hold', resolved_at = null, working_at = null, estimate_minutes = null,
        status_note = v_note, question_options = v_options, answer = null, answered_at = null
    where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.app_feedback_ask(text, uuid, text, jsonb) from public;
grant execute on function public.app_feedback_ask(text, uuid, text, jsonb) to anon, authenticated;

-- 送った人が、質問のボタンを押した時。自分が送った依頼で、保留中で、選択肢にある答えの時だけ。
-- 答えを書き、依頼を「対応待ち」に戻す(見張りに、もう一度流れる)。ログインしていない人(共有リンクから送った人)は使えない。
create or replace function public.app_feedback_answer(p_id uuid, p_answer text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.app_feedback%rowtype;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'reason', 'not_signed_in');
  end if;
  select * into v_row from public.app_feedback where id = p_id and sender_id = auth.uid();
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_row.status <> 'hold' or v_row.question_options is null then
    return jsonb_build_object('ok', false, 'reason', 'not_asking');
  end if;
  if p_answer is null or not (v_row.question_options ? p_answer) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_answer');
  end if;
  update public.app_feedback
    set answer = p_answer, answered_at = now(), status = 'new', resolved_at = null
    where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.app_feedback_answer(uuid, text) from public;
grant execute on function public.app_feedback_answer(uuid, text) to authenticated;

-- ===== 持ち主の Mac から読む: 033 の一覧に、質問(statusNote)・選択肢・答えを足したもの =====
create or replace function public.app_feedback_inbox(p_code text, p_include_resolved boolean default false)
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
  return jsonb_build_object('ok', true, 'items', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', f.id, 'via', f.via, 'senderName', f.sender_name, 'tripName', f.trip_name, 'page', f.page,
      'message', f.message, 'appVersion', f.app_version, 'status', f.status, 'createdAt', f.created_at,
      'imageCount', f.image_count,
      'statusNote', f.status_note, 'questionOptions', f.question_options, 'answer', f.answer, 'answeredAt', f.answered_at
    ) order by f.created_at)
    from public.app_feedback f
    where p_include_resolved or f.status = 'new'
  ), '[]'::jsonb));
end;
$$;
revoke all on function public.app_feedback_inbox(text, boolean) from public;
grant execute on function public.app_feedback_inbox(text, boolean) to anon, authenticated;

-- 確かめ方(読むだけ): select status, question_options, answer from public.app_feedback where question_options is not null;
