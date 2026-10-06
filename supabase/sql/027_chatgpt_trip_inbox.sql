-- LIFE HUB: ChatGPT(専用GPT)で作った旅程を、LIFE HUB の「受信箱」へ直接送れるようにする。
--
-- 【この1本で何ができるようになるか】
-- 日程タブの「ChatGPTで旅程を作ってもらう」で「送信コード」を作る。そのコードを専用GPTに伝えると、
-- GPT が旅程を LIFE HUB へ送り(api/receiveTripPlan.ts)、日程タブの「写真・文章から追加・更新」の
-- いちばん上に「ChatGPTから届いた旅程」として並ぶ。**届いた旅程はそのまま日程に入らない** —
-- 今までと同じ確認画面を通して、本人が入れる(日付や時刻の読み違いをそのまま信じて動かないため)。
--
-- 【なぜ「送信コード」か】
-- 専用GPT はリンクで友人・家族にも配れるが、GPT の設定(接続の鍵)は配った全員で1つしか持てない。
-- だから鍵では「誰の LIFE HUB か」を見分けられない。そこで人ごとのコードを作り、会話の最初に
-- GPT へ伝えてもらう。コードで**できるのは、その人の受信箱へ旅程を置くことだけ**。
-- 日程・日記・費用などは読めず、受信箱の中身も読めない(読むのは本人のログインだけ)。
-- 流出したら、作り直せば古いコードは即座に使えなくなる。
--   * コードは乱数100bit(src/lib/chatgptInbox.ts)。当てずっぽうでは当たらない。
--   * 表にはコードそのものを置かず、SHA-256 の値だけを置く。
--
-- 【他のテーブルと作りが違う理由】023_trip_shares.sql と同じ。同期用のテーブルが持つ
-- device_id / deleted_at / server_updated_at / 差分同期のトリガ / realtime を、**どれも持たない**。
-- 受信箱は端末(Dexie)を経由せず、アプリが Supabase を直接読み書きする。同期の送信の待ち行列にも
-- 載らないので、この表が原因で他のテーブルの送信が止まることはない。
--
-- 【実行の順番】このSQLを先に流す。流すまでは、アプリの「ChatGPTから直接送る」が出ないだけで、
-- 他の機能には影響しない(アプリは表が無いことを確かめて、その部分を隠す)。
-- 流したあとにアプリ側でやることは無い(2段階目は不要)。

-- ===== 送信コード =====
-- 1人につき1行(user_id が主キー)。作り直す＝この行を入れ替える、なので
-- 古いコードが残って使えてしまうことがない。
create table if not exists public.chatgpt_send_codes (
  user_id uuid primary key,
  -- 正規化したコード(大文字の英数字だけ)の SHA-256 を16進で。
  code_hash text not null unique,
  created_at timestamptz not null default now()
);

-- 本人だけが読み書きできる(コードの値そのものは置いていないが、あるかどうかも見せない)。
alter table public.chatgpt_send_codes enable row level security;
drop policy if exists "user manages own chatgpt_send_codes" on public.chatgpt_send_codes;
create policy "user manages own chatgpt_send_codes" on public.chatgpt_send_codes for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ===== 受信箱 =====
create table if not exists public.chatgpt_trip_inbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  -- GPT が添えた旅行の名前と期間(どの旅行向けの旅程か、見分けるための目印)。
  trip_name text,
  start_date text,
  end_date text,
  -- 日程の配列。1件ごとに { date, startTime, endTime, title, location, endLocation, memo, type }。
  -- 金額は受け付けない(GPT の見積もりが旅行の費用に積まれるのを防ぐため)。
  items jsonb not null,
  item_count integer not null,
  received_at timestamptz not null default now()
);
create index if not exists chatgpt_trip_inbox_user_received_idx on public.chatgpt_trip_inbox (user_id, received_at desc);

-- 本人は読める・消せる。**入れる・書き換える方法は本人にも無い**(下の関数だけが入れる)。
alter table public.chatgpt_trip_inbox enable row level security;
drop policy if exists "user reads own chatgpt_trip_inbox" on public.chatgpt_trip_inbox;
create policy "user reads own chatgpt_trip_inbox" on public.chatgpt_trip_inbox for select using (auth.uid() = user_id);
drop policy if exists "user deletes own chatgpt_trip_inbox" on public.chatgpt_trip_inbox;
create policy "user deletes own chatgpt_trip_inbox" on public.chatgpt_trip_inbox for delete using (auth.uid() = user_id);

-- ===== コードで受信箱に置く =====
-- security definer なので、この関数の中だけは RLS を越えて受信箱へ入れられる。
-- 代わりに、できることをここで絞っている:
--   * コードが合う人の受信箱にしか入れない(合わなければ何も入れず、理由だけ返す)。
--   * 1回に200件まで・全体で20万文字まで。受信箱は新しい順に20件を超えたら古いものを消す
--     (コードが漏れても、溜め込まれて表が膨らみ続けない)。
--   * 返すのは成否と件数だけ。誰のコードか・他の人の中身は返さない。
-- 項目の中身の検証(日付・時刻・種類)は呼び出し側の api/receiveTripPlan.ts が済ませている。
-- アプリも、受信箱から読む時に改めて検証する(この表に入った値を信用しない)。
create or replace function public.receive_chatgpt_trip(
  p_code text,
  p_trip_name text,
  p_start_date text,
  p_end_date text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_count integer;
begin
  select user_id into v_user
  from public.chatgpt_send_codes
  where code_hash = encode(sha256(convert_to(coalesce(p_code, ''), 'utf8')), 'hex');
  if v_user is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_code');
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_items');
  end if;
  v_count := jsonb_array_length(p_items);
  if v_count = 0 or v_count > 200 or length(p_items::text) > 200000 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_items');
  end if;

  insert into public.chatgpt_trip_inbox (user_id, trip_name, start_date, end_date, items, item_count)
  values (v_user, left(p_trip_name, 100), left(p_start_date, 10), left(p_end_date, 10), p_items, v_count);

  delete from public.chatgpt_trip_inbox
  where user_id = v_user
    and id not in (
      select id from public.chatgpt_trip_inbox
      where user_id = v_user
      order by received_at desc
      limit 20
    );

  return jsonb_build_object('ok', true, 'received', v_count);
end;
$$;

-- ログインしていない相手(GPT 経由の呼び出し)から呼べるようにする。これが入り口。
revoke all on function public.receive_chatgpt_trip(text, text, text, text, jsonb) from public;
grant execute on function public.receive_chatgpt_trip(text, text, text, text, jsonb) to anon, authenticated;
