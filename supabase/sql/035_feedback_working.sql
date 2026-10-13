-- LIFE HUB: 修正依頼に「修正中」の状態を足す。
--
-- 【なぜ要るか】
-- 修正依頼(要望)を送っても、本当に直してくれているのか、アプリからは分からなかった
-- (2026-10-13、本人「本当に修正してるかわからないから、修正中ですみたいな機能が欲しい」)。
-- 状態は今まで「未対応(new)」「対応済み(done)」「見送り(dismissed)」の3つだけで、直している最中を表せなかった。
--   new(受け付け済み) → working(修正中) → done(対応済み) / dismissed(見送り)
-- 直し始めた時に、持ち主の Mac から scripts/feedback-inbox.mjs --working <id> で印を付ける。
-- アプリは、送った人の「修正」ボタン(と、持ち主の画面)に「修正中」を出す。
--
-- 【この SQL がすること】
--   * working_at(いつから修正中か)の列を足す。
--   * status の許す値に 'working' を足す(check の作り直し)。
--   * Mac から印を付ける関数 app_feedback_set_status が 'working' を受けるようにする。
--     working にしたら working_at を今にし、new に戻したら working_at を消す(対応済み・見送りは、いつから直していたかを残す)。
--
-- 【この SQL が触らないもの】
-- 既存の行は一切変えない。app_feedback_inbox(Mac の見張り)は変えない — 既定では今までどおり「未対応(new)」だけを返すので、
-- 修正中にした依頼が、見張りに何度も流れてくることはない(全部を見る --all では、修正中も出る)。
-- 画像を消す仕組み(033)は、対応済み・見送りの時だけ働く。修正中の間は、画像は残る。
--
-- 【実行の順番】先にこの SQL を流す。流す前でも、アプリは何も変わらない(「修正中」が出ないだけ)。
-- 流したあとにアプリ側でやることは無い。

alter table public.app_feedback add column if not exists working_at timestamptz;

alter table public.app_feedback drop constraint if exists app_feedback_status_check;
alter table public.app_feedback add constraint app_feedback_status_check check (status in ('new', 'working', 'done', 'dismissed'));

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
  if p_status not in ('new', 'working', 'done', 'dismissed') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_status');
  end if;
  update public.app_feedback
    set status = p_status,
        resolved_at = case when p_status in ('new', 'working') then null else now() end,
        working_at = case p_status when 'working' then now() when 'new' then null else working_at end
    where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.app_feedback_set_status(text, uuid, text) from public;
grant execute on function public.app_feedback_set_status(text, uuid, text) to anon, authenticated;

-- 確かめ方(読むだけ): select status, count(*) from public.app_feedback group by status;
