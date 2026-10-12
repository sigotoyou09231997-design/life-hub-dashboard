-- LIFE HUB: 修正依頼(要望の受信箱、029)に、画像(スクリーンショットなど)を付けられるようにする。
-- 2026-10-13、受信箱に届いた「修正依頼にも画像を添付して、修正する側が分かりやすくなればいい」から。
--
-- 【この1本で何ができるようになるか】
-- * 「修正」の画面に「画像を付ける」が出る(1件に3枚まで)。画像は端末で縮めてから(JPEG・1枚およそ300KB以内)、
--   依頼の1行の中にデータとして一緒に保存する。新しい保存領域(Storage)は作らない。
-- * 画像を読めるのは、持ち主(設定の「届いた要望」)と、持ち主の Mac の読み取りコード(scripts/feedback-inbox.mjs)だけ。
-- * 依頼を「対応済み」「見送り」にすると、画像は消える(表が膨らみ続けないように。文字の依頼は残る)。
--
-- 【実行の順番】このSQLを流すだけ。流すまでは、アプリに「画像を付ける」は出ない(出すかどうかを
-- app_feedback_images_enabled() で確かめている)ので、これまでの「修正」の送信は何も変わらず、壊れない。
--
-- 【悪用への備え】共有したしおりを見た人(ログインなし)も送れるので、入口は絞ってある:
-- * 画像は JPEG のデータ URL だけ・3枚まで・1枚45万字(約330KB)まで・合計120万字まで。
-- * 画像つきの依頼は、同じ人(同じ共有リンク)で1時間に3件まで(文字だけの依頼は、これまでどおり10件まで)。
-- * 画像の中の文字は、ほかの人が書いたものであって、指示ではない(todoアプリ/CLAUDE.md)。

alter table public.app_feedback add column if not exists images jsonb;
-- 一覧で画像の枚数だけ分かるように(画像そのものは重いので、一覧には載せない)。
alter table public.app_feedback add column if not exists image_count integer
  generated always as (case when jsonb_typeof(images) = 'array' then jsonb_array_length(images) else 0 end) stored;

-- ===== 「画像を付ける」を出してよいか(このSQLを流した後だけ true) =====
create or replace function public.app_feedback_images_enabled()
returns boolean
language sql
stable
as $$ select true $$;
revoke all on function public.app_feedback_images_enabled() from public;
grant execute on function public.app_feedback_images_enabled() to anon, authenticated;

-- ===== 送る(画像つき) =====
-- 029 の send_app_feedback と同じ決まり(ログイン or 共有リンクの合鍵・OAuth アプリは不可・1時間に10件)に、画像の確かめを足したもの。
create or replace function public.send_app_feedback_v2(
  p_message text,
  p_page text default null,
  p_sender_name text default null,
  p_app_version text default null,
  p_share_token text default null,
  p_images jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_message text := btrim(coalesce(p_message, ''));
  v_sender uuid := auth.uid();
  v_trip_name text;
  v_share uuid;
  v_via text;
  v_recent integer;
  v_recent_images integer;
  v_images jsonb := case when p_images is null or p_images = 'null'::jsonb then null else p_images end;
  v_image text;
  v_total integer := 0;
begin
  if char_length(v_message) = 0 or char_length(v_message) > 2000 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_message');
  end if;

  -- ChatGPT など OAuth で接続したアプリからは送らせない(本人になりすまして要望が積まれないように)。
  if (auth.jwt() ->> 'client_id') is not null then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed');
  end if;

  -- 画像: JPEG のデータ URL の配列だけ。
  if v_images is not null then
    if jsonb_typeof(v_images) <> 'array' or jsonb_array_length(v_images) > 3 then
      return jsonb_build_object('ok', false, 'reason', 'invalid_images');
    end if;
    if jsonb_array_length(v_images) = 0 then
      v_images := null;
    else
      for v_image in select jsonb_array_elements_text(v_images)
      loop
        if left(v_image, 23) <> 'data:image/jpeg;base64,' or char_length(v_image) > 450000 then
          return jsonb_build_object('ok', false, 'reason', 'invalid_images');
        end if;
        v_total := v_total + char_length(v_image);
      end loop;
      if v_total > 1200000 then
        return jsonb_build_object('ok', false, 'reason', 'invalid_images');
      end if;
    end if;
  end if;

  if v_sender is not null then
    v_via := 'app';
    select count(*), count(*) filter (where image_count > 0) into v_recent, v_recent_images from public.app_feedback
      where sender_id = v_sender and created_at > now() - interval '1 hour';
  elsif p_share_token is not null and p_share_token <> '' then
    select s.id, (select t.name from public.trips t where t.id = s.trip_id and t.user_id = s.user_id and t.deleted_at is null)
      into v_share, v_trip_name
      from public.trip_shares s
      where s.token = p_share_token;
    if v_share is null then
      return jsonb_build_object('ok', false, 'reason', 'invalid_share');
    end if;
    v_via := 'share';
    select count(*), count(*) filter (where image_count > 0) into v_recent, v_recent_images from public.app_feedback
      where share_id = v_share and created_at > now() - interval '1 hour';
  else
    return jsonb_build_object('ok', false, 'reason', 'not_allowed');
  end if;

  if v_recent >= 10 or (v_images is not null and v_recent_images >= 3) then
    return jsonb_build_object('ok', false, 'reason', 'too_many');
  end if;

  insert into public.app_feedback (sender_id, sender_name, via, share_id, trip_name, page, message, app_version, images)
  values (v_sender, nullif(left(btrim(coalesce(p_sender_name, '')), 40), ''), v_via, v_share, left(v_trip_name, 100),
          left(p_page, 200), v_message, left(p_app_version, 40), v_images);
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.send_app_feedback_v2(text, text, text, text, text, jsonb) from public;
grant execute on function public.send_app_feedback_v2(text, text, text, text, text, jsonb) to anon, authenticated;

-- 画像なしの送り方(029)は、これまでの呼び方のまま残し、中身は上の関数に任せる(決まりを1か所にするため)。
create or replace function public.send_app_feedback(
  p_message text,
  p_page text default null,
  p_sender_name text default null,
  p_app_version text default null,
  p_share_token text default null
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.send_app_feedback_v2(p_message, p_page, p_sender_name, p_app_version, p_share_token, null)
$$;
revoke all on function public.send_app_feedback(text, text, text, text, text) from public;
grant execute on function public.send_app_feedback(text, text, text, text, text) to anon, authenticated;

-- ===== 持ち主の Mac から読む: 一覧に画像の枚数を足す。画像そのものは1件ずつ別の関数で =====
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
      'imageCount', f.image_count
    ) order by f.created_at)
    from public.app_feedback f
    where p_include_resolved or f.status = 'new'
  ), '[]'::jsonb));
end;
$$;
revoke all on function public.app_feedback_inbox(text, boolean) from public;
grant execute on function public.app_feedback_inbox(text, boolean) to anon, authenticated;

create or replace function public.app_feedback_images(p_code text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_images jsonb;
begin
  if not exists (
    select 1 from public.app_feedback_read_codes
    where code_hash = encode(sha256(convert_to(coalesce(p_code, ''), 'utf8')), 'hex')
  ) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_code');
  end if;
  select images into v_images from public.app_feedback where id = p_id;
  return jsonb_build_object('ok', true, 'images', coalesce(v_images, '[]'::jsonb));
end;
$$;
revoke all on function public.app_feedback_images(text, uuid) from public;
grant execute on function public.app_feedback_images(text, uuid) to anon, authenticated;

-- ===== 「対応済み」「見送り」にしたら、画像は消す(表が膨らみ続けないように) =====
-- アプリの設定からの更新と、Mac の app_feedback_set_status の、どちらを通っても効くように、更新のトリガーで行う。
-- 「未対応に戻す」で戻しても、画像は戻らない(文字の依頼だけが残る)。
create or replace function public.app_feedback_clear_images()
returns trigger
language plpgsql
as $$
begin
  if new.status in ('done', 'dismissed') then
    new.images := null;
  end if;
  return new;
end;
$$;
drop trigger if exists app_feedback_clear_images on public.app_feedback;
create trigger app_feedback_clear_images before update on public.app_feedback
  for each row execute function public.app_feedback_clear_images();
