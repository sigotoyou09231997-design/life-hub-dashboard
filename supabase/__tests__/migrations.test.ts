import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * supabase/sql の SQL を、本物の Postgres(PGlite = WASM 版)に**番号順にそのまま流して**、確かめる。
 * これまで SQL は「人が本番で流す」だけで、テストが無かった(権限の抜けや、関数の書き間違いは、
 * 本番で初めて分かった)。Supabase の土台(役割 anon / authenticated、auth.uid()・auth.jwt()、
 * realtime の公開)だけを、代わりの定義で用意している。
 *
 * ここで守るもの:
 * - どの SQL も、前の SQL の上で、エラーなく流れる。
 * - 028: ChatGPT など OAuth で接続したアプリのトークン(client_id が付く)は、旅行・日程以外の表に何もできず、
 *   旅行・日程も読む・足すだけ(更新・削除はできない)。アプリ自身のログインは、これまでどおり。
 * - 027: 送信コードの受信箱(置ける・断る・20件まで・権限)。
 * - 029: 要望の受信箱(ログインして・共有リンクから送れる・持ち主だけ読める・読み取りコード・連投の上限)。
 * - 030: 要望から足した欄(移動手段・予定の詳細・持ち物の並び順・参加者・支払った人)と、共有したしおりへの反映。
 * - 033: 修正依頼に付ける画像(JPEG だけ・3枚まで・大きさの上限・画像つきは1時間3件まで・対応済みで消える・読み取りコードで1件ずつ読む)。
 * - 034: 旅行を一緒に編集(メールで招く・承認するまで見えない・承認後は持ち主の名前で読み書き・消せない・外す／抜けるで即座に届かなくなる・日記は共有しない)。
 */

const SQL_DIR = new URL("../sql/", import.meta.url);
const USER = "11111111-2222-4333-8444-555555555555";
const OTHER = "99999999-2222-4333-8444-555555555555";
const TRIP = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const APP = { sub: USER, role: "authenticated" }; // アプリ自身のログイン(client_id なし)
const OAUTH = { sub: USER, role: "authenticated", client_id: "chatgpt-client" }; // ChatGPT 経由のトークン

let db: PGlite;
const sqlFiles = readdirSync(SQL_DIR).filter((name) => name.endsWith(".sql")).sort();

/** 役割とトークンを切り替えて試す。終わったら、やったことは全部取り消す。 */
async function as<T>(role: "anon" | "authenticated", claims: Record<string, unknown> | null, fn: () => Promise<T>): Promise<T> {
  await db.exec("begin");
  try {
    await db.exec(`set local role ${role}`);
    if (claims) await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    return await fn();
  } finally {
    await db.exec("rollback");
  }
}

const count = async (sql: string) => ((await db.query<{ n: number }>(sql)).rows[0].n);
const rows = async (sql: string) => (await db.query(sql)).rows.length;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth;
    -- Supabase の auth.users の代わり(034 が、アドレスの確認が済んでいるかを引く)。
    create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz);
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
    create publication supabase_realtime;
    grant usage on schema public to anon, authenticated;
    grant usage on schema auth to anon, authenticated;
  `);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe("SQL を番号順に流す", () => {
  it("どの SQL も、前の SQL の上で、エラーなく流れる", async () => {
    expect(sqlFiles.length).toBeGreaterThan(20);
    const failed: string[] = [];
    for (const file of sqlFiles) {
      try {
        await db.exec(readFileSync(new URL(file, SQL_DIR), "utf8"));
      } catch (err) {
        failed.push(`${file}: ${(err as Error).message.split("\n")[0]}`);
      }
    }
    expect(failed).toEqual([]);

    // Supabase は、公開スキーマの表・関数に anon / authenticated の権限を既定で付ける。
    await db.exec(`
      grant select, insert, update, delete on all tables in schema public to anon, authenticated;
      grant execute on all functions in schema public to anon, authenticated;
    `);
    await db.exec(`
      insert into public.trips (id, user_id, device_id, name, destination, start_date, end_date, status)
        values ('${TRIP}', '${USER}', 'pc', '四国旅行', '高松', '2026-12-27', '2027-01-02', 'planning');
      insert into public.trip_schedule (id, user_id, device_id, trip_id, date, title, type)
        values ('bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee', '${USER}', 'pc', '${TRIP}', '2026-12-27', '羽田発', 'transport');
      insert into public.diary_entries (id, user_id, device_id, date, body, mood)
        values ('cccccccc-bbbb-4ccc-8ddd-eeeeeeeeeeee', '${USER}', 'pc', '2026-10-01', '日記の中身', 'good');
    `);
  }, 120_000);

  it("RLS のある表には、OAuth の制限が付いている(新しい表の足し忘れを止める)", async () => {
    const missing = await db.query<{ relname: string }>(`
      select c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r','p') and c.relrowsecurity
        and c.relname not in ('trips','trip_schedule')
        and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname and p.policyname = 'oauth clients blocked')
    `);
    expect(missing.rows.map((row) => row.relname)).toEqual([]);
  });

  it("RLS が付いていない表は無い(付いていないと、公開鍵だけで読み書きできてしまう)", async () => {
    const open = await db.query<{ relname: string }>(`
      select c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity
    `);
    expect(open.rows.map((row) => row.relname)).toEqual([]);
  });

  it("028 より後の SQL で表を足すなら、OAuth の制限(oauth clients blocked)も、同じ SQL の中で足す", () => {
    const later = sqlFiles.filter((name) => Number(name.slice(0, 3)) > 28 && /create table/i.test(readFileSync(new URL(name, SQL_DIR), "utf8")));
    for (const name of later) {
      expect(readFileSync(new URL(name, SQL_DIR), "utf8"), `${name} に oauth clients blocked が無い`).toContain("oauth clients blocked");
    }
  });
});

describe("028: OAuth で接続したアプリのトークンの届く範囲", () => {
  it("アプリ自身のログインは、これまでどおり(読む・更新・削除)", async () => {
    expect(await as("authenticated", APP, () => count("select count(*)::int as n from public.diary_entries"))).toBe(1);
    expect(await as("authenticated", APP, () => rows(`update public.trips set memo = 'x' where id = '${TRIP}' returning id`))).toBe(1);
    expect(await as("authenticated", APP, () => rows("delete from public.trip_schedule returning id"))).toBe(1);
  });

  it("ChatGPT のトークンは、旅行と日程を読める", async () => {
    expect(await as("authenticated", OAUTH, () => count("select count(*)::int as n from public.trips"))).toBe(1);
    expect(await as("authenticated", OAUTH, () => count("select count(*)::int as n from public.trip_schedule"))).toBe(1);
  });

  it("旅行・日程以外の表は、1つも読めない(Gmail の接続情報・日記・家計・メモ・受信箱など)", async () => {
    const tables = (await db.query<{ relname: string }>(`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r','p') and c.relrowsecurity and c.relname not in ('trips','trip_schedule')
    `)).rows.map((row) => row.relname);
    expect(tables).toContain("gmail_server_accounts");
    expect(tables).toContain("diary_entries");
    for (const table of tables) {
      expect(await as("authenticated", OAUTH, () => count(`select count(*)::int as n from public.${table}`)), table).toBe(0);
    }
    // 同じ表を、アプリ自身のログインなら読める(制限が、アプリを止めていない)。
    expect(await as("authenticated", APP, () => count("select count(*)::int as n from public.diary_entries"))).toBe(1);
  });

  it("日記には、書くこともできない", async () => {
    await expect(
      as("authenticated", OAUTH, () =>
        db.query(`insert into public.diary_entries (id, user_id, device_id, date, body, mood) values ('dddddddd-bbbb-4ccc-8ddd-eeeeeeeeeeee','${USER}','chatgpt','2026-10-02','x','good')`),
      ),
    ).rejects.toThrow();
  });

  it("旅行を作れる・日程を足せる。同じ予定の再送は、何も起きない(上書きしない)", async () => {
    expect(
      await as("authenticated", OAUTH, () =>
        rows(`insert into public.trips (id, user_id, device_id, name, destination, start_date, end_date, status) values ('ffffffff-bbbb-4ccc-8ddd-eeeeeeeeeeee','${USER}','chatgpt','新しい旅','京都','2026-11-01','2026-11-03','planning') on conflict (id) do nothing returning id`),
      ),
    ).toBe(1);
    expect(
      await as("authenticated", OAUTH, () =>
        rows(`insert into public.trip_schedule (id, user_id, device_id, trip_id, date, title, type) values ('eeeeeeee-bbbb-4ccc-8ddd-eeeeeeeeeeee','${USER}','chatgpt','${TRIP}','2026-12-28','屋島','sightseeing') on conflict (id) do nothing returning id`),
      ),
    ).toBe(1);
    expect(
      await as("authenticated", OAUTH, () =>
        rows(`insert into public.trip_schedule (id, user_id, device_id, trip_id, date, title, type) values ('bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee','${USER}','chatgpt','${TRIP}','2026-12-27','上書き','other') on conflict (id) do nothing returning id`),
      ),
    ).toBe(0);
    expect((await db.query<{ title: string }>("select title from public.trip_schedule where id = 'bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee'")).rows[0].title).toBe("羽田発");
  });

  it("他人の名前では、書けない", async () => {
    await expect(
      as("authenticated", OAUTH, () =>
        db.query(`insert into public.trip_schedule (id, user_id, device_id, trip_id, date, title, type) values ('11111111-bbbb-4ccc-8ddd-eeeeeeeeeeee','${OTHER}','chatgpt','${TRIP}','2026-12-28','他人の行','other')`),
      ),
    ).rejects.toThrow();
  });

  it("旅行・日程の更新と削除は、できない(0行)", async () => {
    expect(await as("authenticated", OAUTH, () => rows("update public.trip_schedule set title = '書き換え' returning id"))).toBe(0);
    expect(await as("authenticated", OAUTH, () => rows("delete from public.trip_schedule returning id"))).toBe(0);
    expect(await as("authenticated", OAUTH, () => rows("update public.trips set name = '書き換え' returning id"))).toBe(0);
    expect(await as("authenticated", OAUTH, () => rows("delete from public.trips returning id"))).toBe(0);
    expect((await db.query<{ title: string }>("select title from public.trip_schedule where id = 'bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee'")).rows[0].title).toBe("羽田発");
  });

  it("別の人のトークンには、そもそも旅行が見えない", async () => {
    expect(await as("authenticated", { sub: OTHER, role: "authenticated", client_id: "chatgpt-client" }, () => count("select count(*)::int as n from public.trips"))).toBe(0);
  });
});

describe("027: 送信コードの受信箱", () => {
  const code = "LHABCDEFGHJKLMNPQRSTUV";
  const hash = createHash("sha256").update(code).digest("hex");
  const items = (n: number) => Array.from({ length: n }, (_, i) => ({ date: "2026-12-27", title: `予定${i}`, type: "other" }));
  const call = async (c: string | null, list: unknown, name = "旅行") =>
    (await db.query<{ r: { ok: boolean; received?: number; reason?: string } }>("select public.receive_chatgpt_trip($1,$2,$3,$4,$5::jsonb) as r", [c, name, "2026-12-27", "2027-01-02", JSON.stringify(list)])).rows[0].r;

  beforeAll(async () => {
    await db.query("insert into public.chatgpt_send_codes (user_id, code_hash) values ($1, $2)", [USER, hash]);
    await db.query("insert into public.chatgpt_send_codes (user_id, code_hash) values ($1, $2)", [OTHER, createHash("sha256").update("LHOTHERCODE00000000000").digest("hex")]);
  });

  it("正しいコードなら、そのコードの持ち主の受信箱に、件数・中身どおりに置く(ログインしていない呼び出し=anon から)", async () => {
    const placed = await as("anon", null, async () => {
      const reply = await call(code, items(2), "置き場所の確認");
      expect(reply).toEqual({ ok: true, received: 2 });
      await db.exec("reset role");
      return (await db.query<{ user_id: string; item_count: number; first: string }>("select user_id, item_count, items->0->>'title' as first from public.chatgpt_trip_inbox")).rows;
    });
    expect(placed).toEqual([{ user_id: USER, item_count: 2, first: "予定0" }]);
  });

  it("コードが違う・空・null なら、何も置かない", async () => {
    for (const wrong of ["LHWRONG", "", null, "lh-abcd"]) {
      expect((await as("anon", null, () => call(wrong, items(1)))).reason, String(wrong)).toBe("invalid_code");
    }
    expect(await count("select count(*)::int as n from public.chatgpt_trip_inbox")).toBe(0);
  });

  it("空・配列でない・201件は断る。200件はちょうど通る", async () => {
    expect((await as("anon", null, () => call(code, []))).reason).toBe("invalid_items");
    expect((await as("anon", null, async () => (await db.query<{ r: { reason: string } }>("select public.receive_chatgpt_trip($1,'x','','','{\"a\":1}'::jsonb) as r", [code])).rows[0].r)).reason).toBe("invalid_items");
    expect((await as("anon", null, () => call(code, items(201)))).reason).toBe("invalid_items");
    expect((await as("anon", null, () => call(code, items(200)))).ok).toBe(true);
  });

  it("受信箱は新しい順に20件まで(古いものから消える)。他の人の受信箱は触らない", async () => {
    // 別々のトランザクション = 受信時刻が順に新しくなる。ただしテスト用の PGlite は時計が粗く、
    // 同じ1ミリ秒の中で2回受けると受信時刻が同じになり、新しい順が入れ替わって3回に1回ほど
    // 落ちていた(2026-10-12)。本番では受信の間が必ず空くので、テストでも1回ごとに少し待つ。
    for (let i = 0; i < 25; i++) {
      await call(code, items(1), `旅${i}`);
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    const kept = (await db.query<{ trip_name: string }>("select trip_name from public.chatgpt_trip_inbox where user_id = $1 order by received_at desc", [USER])).rows.map((row) => row.trip_name);
    expect(kept).toHaveLength(20);
    expect(kept[0]).toBe("旅24");
    expect(kept).not.toContain("旅0");
    expect(await count(`select count(*)::int as n from public.chatgpt_trip_inbox where user_id = '${OTHER}'`)).toBe(0);
  });

  it("anon は、受信箱も送信コードの表も読めず、受信箱に直接も書けない。本人も、直接は書けない", async () => {
    expect(await as("anon", null, async () => { try { return await count("select count(*)::int as n from public.chatgpt_trip_inbox"); } catch { return 0; } })).toBe(0);
    expect(await as("anon", null, async () => { try { return await count("select count(*)::int as n from public.chatgpt_send_codes"); } catch { return 0; } })).toBe(0);
    await expect(as("anon", null, () => db.query(`insert into public.chatgpt_trip_inbox (user_id, items, item_count) values ('${USER}', '[]', 0)`))).rejects.toThrow();
    await expect(as("authenticated", APP, () => db.query(`insert into public.chatgpt_trip_inbox (user_id, items, item_count) values ('${USER}', '[]', 0)`))).rejects.toThrow();
  });

  it("本人は自分の受信箱を読めて消せる。別の人は、読めも消せもしない", async () => {
    expect(await as("authenticated", APP, () => count("select count(*)::int as n from public.chatgpt_trip_inbox"))).toBe(20);
    expect(await as("authenticated", { sub: OTHER, role: "authenticated" }, () => count("select count(*)::int as n from public.chatgpt_trip_inbox"))).toBe(0);
    expect(await as("authenticated", { sub: OTHER, role: "authenticated" }, () => rows("delete from public.chatgpt_trip_inbox returning id"))).toBe(0);
    expect(await as("authenticated", APP, () => rows("delete from public.chatgpt_trip_inbox returning id"))).toBe(20);
  });

  it("送信コードの表は、本人の分だけ読める", async () => {
    expect(await as("authenticated", APP, () => count("select count(*)::int as n from public.chatgpt_send_codes"))).toBe(1);
  });

  it("SQL の SHA-256 と、アプリ(JS)の SHA-256 が、同じ値になる(コードの照合が合う)", async () => {
    const sqlHash = (await db.query<{ h: string }>("select encode(sha256(convert_to($1,'utf8')),'hex') as h", [code])).rows[0].h;
    expect(sqlHash).toBe(hash);
  });
});

describe("029: 要望の受信箱", () => {
  const OWNER = USER;
  const FRIEND = OTHER;
  const SHARE_TOKEN = "share-token-for-feedback-test";
  const readCode = "FBREADCODE1234567890";
  const send = async (message: string | null, shareToken: string | null = null, name: string | null = null) =>
    (await db.query<{ r: { ok: boolean; reason?: string } }>("select public.send_app_feedback($1, $2, $3, $4, $5) as r", [message, "/trips/x", name, "abc1234", shareToken])).rows[0].r;
  const inbox = async (code: string, all = false) =>
    (await db.query<{ r: { ok: boolean; reason?: string; items?: { id: string; message: string; via: string; tripName: string | null; status: string; senderName: string | null }[] } }>("select public.app_feedback_inbox($1, $2) as r", [code, all])).rows[0].r;

  beforeAll(async () => {
    await db.query("insert into public.app_feedback_owner (id, user_id) values ('owner', $1)", [OWNER]);
    await db.query("insert into public.app_feedback_read_codes (id, code_hash) values ('owner', $1)", [createHash("sha256").update(readCode).digest("hex")]);
    await db.query("insert into public.trip_shares (id, user_id, trip_id, token) values ('dddddddd-bbbb-4ccc-8ddd-eeeeeeeeeeee', $1, $2, $3)", [OWNER, TRIP, SHARE_TOKEN]);
  });

  it("ログインしている人は送れる。送った人は自分の分だけ読め、持ち主はすべて読める", async () => {
    await db.exec("begin");
    try {
      await db.exec("set local role authenticated");
      await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: FRIEND, role: "authenticated" })]);
      expect(await send("ボタンが小さい", null, "友人A")).toEqual({ ok: true });
      expect(await count("select count(*)::int as n from public.app_feedback")).toBe(1);
      await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: "77777777-2222-4333-8444-555555555555", role: "authenticated" })]);
      expect(await count("select count(*)::int as n from public.app_feedback")).toBe(0);
      await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(APP)]);
      const row = (await db.query<{ via: string; sender_name: string; message: string }>("select via, sender_name, message from public.app_feedback")).rows;
      expect(row).toEqual([{ via: "app", sender_name: "友人A", message: "ボタンが小さい" }]);
    } finally {
      await db.exec("rollback");
    }
  });

  it("ログインしていない人は、共有リンクの合鍵がある時だけ送れる(旅行の名前が付く)", async () => {
    const result = await as("anon", null, async () => {
      expect((await send("合鍵なし")).reason).toBe("not_allowed");
      expect((await send("違う合鍵", "wrong-token")).reason).toBe("invalid_share");
      expect(await send("しおりの時刻が違う", SHARE_TOKEN)).toEqual({ ok: true });
      await db.exec("reset role");
      return (await db.query<{ via: string; trip_name: string; sender_id: string | null }>("select via, trip_name, sender_id from public.app_feedback")).rows;
    });
    expect(result).toEqual([{ via: "share", trip_name: "四国旅行", sender_id: null }]);
  });

  it("表に直接は入れられない(必ず関数を通す)。持ち主以外は印も付けられない", async () => {
    await expect(as("authenticated", { sub: FRIEND, role: "authenticated" }, () => db.query("insert into public.app_feedback (via, message) values ('app', '直接')"))).rejects.toThrow();
    await expect(as("anon", null, () => db.query("insert into public.app_feedback (via, message) values ('share', '直接')"))).rejects.toThrow();
  });

  it("空・2000字を超える要望は断る", async () => {
    await as("authenticated", { sub: FRIEND, role: "authenticated" }, async () => {
      expect((await send("   ")).reason).toBe("invalid_message");
      expect((await send("あ".repeat(2001))).reason).toBe("invalid_message");
      expect((await send("あ".repeat(2000))).ok).toBe(true);
    });
  });

  it("1時間に10件まで(同じ人・同じ共有リンクごと)", async () => {
    await as("authenticated", { sub: FRIEND, role: "authenticated" }, async () => {
      for (let i = 0; i < 10; i++) expect((await send(`要望${i}`)).ok, String(i)).toBe(true);
      expect((await send("11件目")).reason).toBe("too_many");
    });
  });

  it("ChatGPT など OAuth で接続したアプリからは送れない", async () => {
    expect((await as("authenticated", OAUTH, () => send("なりすまし"))).reason).toBe("not_allowed");
  });

  it("読み取りコードがあれば、ログインしていなくても届いた要望を読めて、対応済みにできる", async () => {
    await as("anon", null, async () => {
      expect(await send("読み取りの確認", SHARE_TOKEN, "えっくん")).toEqual({ ok: true });
      expect((await inbox("WRONGCODE")).reason).toBe("invalid_code");
      const got = await inbox(readCode);
      expect(got.items?.map((item) => [item.message, item.via, item.tripName, item.senderName, item.status])).toEqual([["読み取りの確認", "share", "四国旅行", "えっくん", "new"]]);
      const id = got.items![0].id;
      expect((await db.query<{ r: { ok: boolean; reason?: string } }>("select public.app_feedback_set_status($1, $2, 'done') as r", ["WRONGCODE", id])).rows[0].r.reason).toBe("invalid_code");
      expect((await db.query<{ r: { ok: boolean } }>("select public.app_feedback_set_status($1, $2, 'done') as r", [readCode, id])).rows[0].r.ok).toBe(true);
      // 対応済みは、既定では出てこない(全部見たい時だけ出す)。
      expect((await inbox(readCode)).items).toEqual([]);
      expect((await inbox(readCode, true)).items?.map((item) => item.status)).toEqual(["done"]);
    });
  });

  it("読み取りコードの表と持ち主の表は、ログインしていても書き換えられない", async () => {
    await expect(as("authenticated", APP, () => db.query("insert into public.app_feedback_read_codes (id, code_hash) values ('owner', 'x')"))).rejects.toThrow();
    expect(await as("authenticated", APP, () => rows("update public.app_feedback_owner set user_id = user_id returning id"))).toBe(0);
    expect(await as("anon", null, () => count("select count(*)::int as n from public.app_feedback_read_codes"))).toBe(0);
  });
});

describe("030: 要望から足した欄", () => {
  it("足した欄に書けて、共有したしおりにも出る", async () => {
    await db.exec(`
      update public.trips set members = '["ふなだ","えっくん"]'::jsonb where id = '${TRIP}';
      update public.trip_schedule set transport_mode = 'shinkansen', address = '徳島県鳴門市', phone = '088-000-0000',
        url = 'https://example.com', opening_hours = '9:00〜17:00', check_in_time = '15:00', check_out_time = '10:00'
        where trip_id = '${TRIP}';
      insert into public.trip_packing_items (id, user_id, device_id, trip_id, title, category, checked, sort_order)
        values ('eeeeeeee-1111-4ccc-8ddd-eeeeeeeeeeee', '${USER}', 'pc', '${TRIP}', '後', 'other', false, 2),
               ('eeeeeeee-2222-4ccc-8ddd-eeeeeeeeeeee', '${USER}', 'pc', '${TRIP}', '先', 'other', false, 1);
      insert into public.trip_expenses (id, user_id, device_id, trip_id, title, amount, category, paid, paid_by, schedule_id)
        values ('ffffffff-1111-4ccc-8ddd-eeeeeeeeeeee', '${USER}', 'pc', '${TRIP}', '新幹線', 17000, 'transport', true, 'えっくん', 'bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee');
      insert into public.trip_shares (id, user_id, trip_id, token, include_expenses)
        values ('dddddddd-3333-4ccc-8ddd-eeeeeeeeeeee', '${USER}', '${TRIP}', 'share-token-030', true)
        on conflict (trip_id) do update set token = excluded.token, include_expenses = true;
    `);
    const shared = await as("anon", null, async () =>
      (await db.query<{ r: { trip: { members: string[] }; schedule: Record<string, string>[]; packing: { title: string }[]; expenses: { paidBy: string }[] } }>("select public.get_shared_trip('share-token-030') as r")).rows[0].r,
    );
    expect(shared.trip.members).toEqual(["ふなだ", "えっくん"]);
    expect(shared.schedule[0]).toMatchObject({
      transportMode: "shinkansen", address: "徳島県鳴門市", phone: "088-000-0000", url: "https://example.com",
      openingHours: "9:00〜17:00", checkInTime: "15:00", checkOutTime: "10:00",
    });
    expect(shared.packing.map((p) => p.title)).toEqual(["先", "後"]);
    expect(shared.expenses[0].paidBy).toBe("えっくん");
  });
});

describe("033: 修正依頼の画像", () => {
  const OWNER = USER;
  const SENDER = "88888888-2222-4333-8444-555555555555";
  const readCode = "FBIMAGECODE1234567890";
  const jpeg = (chars = 1000) => `data:image/jpeg;base64,${"A".repeat(chars)}`;
  const sendWith = async (message: string, images: unknown, shareToken: string | null = null) =>
    (await db.query<{ r: { ok: boolean; reason?: string } }>(
      "select public.send_app_feedback_v2($1, $2, $3, $4, $5, $6::jsonb) as r",
      [message, "/trips/x", null, "abc1234", shareToken, images === null ? null : JSON.stringify(images)],
    )).rows[0].r;
  const asSender = <T,>(fn: () => Promise<T>) => as("authenticated", { sub: SENDER, role: "authenticated" }, fn);
  const inbox = async (all = false) =>
    (await db.query<{ r: { ok: boolean; items: { id: string; message: string; imageCount: number; status: string }[] } }>(
      "select public.app_feedback_inbox($1, $2) as r", [readCode, all],
    )).rows[0].r;

  beforeAll(async () => {
    // 029 のテストが持ち主と読み取りコードを残していない(1件ごとに取り消す)ので、ここで置く。
    await db.exec("delete from public.app_feedback_owner; delete from public.app_feedback_read_codes;");
    await db.query("insert into public.app_feedback_owner (id, user_id) values ('owner', $1)", [OWNER]);
    await db.query("insert into public.app_feedback_read_codes (id, code_hash) values ('owner', $1)", [createHash("sha256").update(readCode).digest("hex")]);
  });

  it("「画像を付ける」を出してよいかは、誰でも確かめられる(流した後だけ true)", async () => {
    expect((await as("anon", null, async () => (await db.query<{ e: boolean }>("select public.app_feedback_images_enabled() as e")).rows[0].e))).toBe(true);
  });

  it("画像つきで送れて、枚数が一覧に出る。画像そのものは読み取りコードで1件ずつ読む", async () => {
    await asSender(async () => {
      expect(await sendWith("この画面です", [jpeg(), jpeg(2000)])).toEqual({ ok: true });
      await db.exec("reset role");
      const listed = await inbox();
      expect(listed.items.map((item) => [item.message, item.imageCount])).toEqual([["この画面です", 2]]);
      const got = (await db.query<{ r: { ok: boolean; images?: string[]; reason?: string } }>("select public.app_feedback_images($1, $2) as r", [readCode, listed.items[0].id])).rows[0].r;
      expect(got.images?.map((image) => image.length)).toEqual([jpeg().length, jpeg(2000).length]);
      expect((await db.query<{ r: { reason?: string } }>("select public.app_feedback_images($1, $2) as r", ["WRONGCODE", listed.items[0].id])).rows[0].r.reason).toBe("invalid_code");
    });
  });

  it("JPEG のデータ URL 以外・4枚以上・大きすぎるものは断る(中身も保存しない)", async () => {
    await asSender(async () => {
      expect((await sendWith("png", [`data:image/png;base64,AAAA`])).reason).toBe("invalid_images");
      expect((await sendWith("スクリプト", [`data:text/html;base64,PHNjcmlwdD4=`])).reason).toBe("invalid_images");
      expect((await sendWith("文字列ではない", [123])).reason).toBe("invalid_images");
      expect((await sendWith("配列ではない", { a: 1 })).reason).toBe("invalid_images");
      expect((await sendWith("4枚", [jpeg(), jpeg(), jpeg(), jpeg()])).reason).toBe("invalid_images");
      expect((await sendWith("1枚が大きい", [jpeg(450_001)])).reason).toBe("invalid_images");
      expect((await sendWith("合計が大きい", [jpeg(440_000), jpeg(440_000), jpeg(440_000)])).reason).toBe("invalid_images");
      expect((await sendWith("上限ちょうど", [jpeg(400_000 - 23), jpeg(400_000 - 23), jpeg(400_000 - 23)])).ok).toBe(true);
      await db.exec("reset role");
      expect(await count("select count(*)::int as n from public.app_feedback")).toBe(1);
    });
  });

  it("画像なし(空の配列・null)でも、文字の依頼として送れる。これまでの send_app_feedback も同じ", async () => {
    await asSender(async () => {
      expect((await sendWith("空の配列", [])).ok).toBe(true);
      expect((await sendWith("null", null)).ok).toBe(true);
      expect((await db.query<{ r: { ok: boolean } }>("select public.send_app_feedback($1, $2, $3, $4, $5) as r", ["これまでの呼び方", "/x", null, "abc", null])).rows[0].r.ok).toBe(true);
      await db.exec("reset role");
      expect(await count("select count(*)::int as n from public.app_feedback where image_count = 0")).toBe(3);
    });
  });

  it("画像つきは、同じ人で1時間に3件まで(文字だけは10件まで)", async () => {
    await asSender(async () => {
      for (let i = 0; i < 3; i++) expect((await sendWith(`画像${i}`, [jpeg()])).ok, String(i)).toBe(true);
      expect((await sendWith("4件目の画像", [jpeg()])).reason).toBe("too_many");
      expect((await sendWith("文字だけならまだ送れる", null)).ok).toBe(true);
    });
  });

  it("共有リンクから(ログインなし)でも、合鍵があれば画像つきで送れる。合鍵が違えば断る", async () => {
    // 共有リンクは、1つの旅行に1つだけ。030 のテストが合鍵を share-token-030 に差し替えている。
    await as("anon", null, async () => {
      expect((await sendWith("画像つき", [jpeg()], "wrong")).reason).toBe("invalid_share");
      expect(await sendWith("画像つき", [jpeg()], "share-token-030")).toEqual({ ok: true });
    });
  });

  it("OAuth で接続したアプリからは、画像つきでも送れない", async () => {
    expect((await as("authenticated", { sub: SENDER, role: "authenticated", client_id: "chatgpt" }, () => sendWith("なりすまし", [jpeg()]))).reason).toBe("not_allowed");
  });

  it("対応済み・見送りにすると画像は消える(文字の依頼は残る)。Mac の印からでも、アプリの更新からでも", async () => {
    await asSender(async () => {
      expect((await sendWith("消えるはず", [jpeg()])).ok).toBe(true);
      await db.exec("reset role");
      const id = (await inbox()).items.find((item) => item.message === "消えるはず")!.id;
      await db.query("select public.app_feedback_set_status($1, $2, 'done')", [readCode, id]);
      expect(await count(`select image_count as n from public.app_feedback where id = '${id}'`)).toBe(0);
      expect(await count(`select count(*)::int as n from public.app_feedback where id = '${id}' and images is null`)).toBe(1);
      // 未対応に戻しても、画像は戻らない。
      await db.query("select public.app_feedback_set_status($1, $2, 'new')", [readCode, id]);
      expect(await count(`select image_count as n from public.app_feedback where id = '${id}'`)).toBe(0);
    });
    // 持ち主がアプリの設定から見送る(表への更新)。送ったものと同じ取引の中で、持ち主に切り替える。
    await asSender(async () => {
      expect((await sendWith("アプリから見送る", [jpeg()])).ok).toBe(true);
      await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: OWNER, role: "authenticated" })]);
      expect(await count("select image_count as n from public.app_feedback where message = 'アプリから見送る'")).toBe(1);
      await db.exec("update public.app_feedback set status = 'dismissed' where message = 'アプリから見送る'");
      expect(await count("select image_count as n from public.app_feedback where message = 'アプリから見送る'")).toBe(0);
    });
  });
});

describe("034: 旅行を一緒に編集", () => {
  const FRIEND = "77777777-2222-4333-8444-555555555555"; // 招かれる人(friend@example.com・確認済み)
  const IMPOSTOR = "66666666-2222-4333-8444-555555555555"; // 同じアドレスで登録しただけ(確認していない)
  const THIRD = "55555555-2222-4333-8444-555555555555"; // 同じ旅行に参加している、もう1人
  const T_PENDING = "a0000000-bbbb-4ccc-8ddd-eeeeeeeeeee1"; // 招待中(まだ承認していない)
  const T_SHARED = "a0000000-bbbb-4ccc-8ddd-eeeeeeeeeee2"; // FRIEND と THIRD が参加中
  const T_PRIVATE = "a0000000-bbbb-4ccc-8ddd-eeeeeeeeeee3"; // 誰にも共有していない
  const T_DELETED = "a0000000-bbbb-4ccc-8ddd-eeeeeeeeeee4"; // 持ち主が消した旅行への招待
  const S_SHARED = "b0000000-bbbb-4ccc-8ddd-eeeeeeeeeee1";
  const S_PRIVATE = "b0000000-bbbb-4ccc-8ddd-eeeeeeeeeee2";
  const E_SHARED = "c0000000-bbbb-4ccc-8ddd-eeeeeeeeeee1";
  const E_PRIVATE = "c0000000-bbbb-4ccc-8ddd-eeeeeeeeeee2";

  const asUser = <T,>(sub: string, fn: () => Promise<T>, extra: Record<string, unknown> = {}) =>
    as("authenticated", { sub, role: "authenticated", ...extra }, fn);
  /** 同じ取引の中で、別の人に切り替える(招待→承認、のような続きの流れを確かめる)。 */
  const switchTo = (sub: string) => db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub, role: "authenticated" })]);
  const invite = async (tripId: string, email: string) =>
    (await db.query<{ r: { id: string; status: string; alreadyInvited: boolean } }>("select public.invite_trip_member($1, $2) as r", [tripId, email])).rows[0].r;
  const respond = async (tripId: string, accept: boolean) =>
    (await db.query<{ r: { status: string } }>("select public.respond_trip_invite($1, $2) as r", [tripId, accept])).rows[0].r;
  const newSchedule = (id: string, tripId: string, userId: string) =>
    `insert into public.trip_schedule (id, user_id, device_id, trip_id, date, title, type) values ('${id}','${userId}','phone','${tripId}','2026-12-28','追加','other')`;

  beforeAll(async () => {
    await db.exec(`
      insert into auth.users (id, email, email_confirmed_at) values
        ('${USER}', 'owner@example.com', now()), ('${FRIEND}', 'friend@example.com', now()),
        ('${IMPOSTOR}', 'friend@example.com', null), ('${THIRD}', 'third@example.com', now()), ('${OTHER}', 'other@example.com', now());
      insert into public.trips (id, user_id, device_id, name, destination, start_date, end_date, status, deleted_at) values
        ('${T_PENDING}', '${USER}', 'pc', '招待中の旅', '金沢', '2026-11-01', '2026-11-03', 'planning', null),
        ('${T_SHARED}', '${USER}', 'pc', 'みんなの旅', '高松', '2026-12-27', '2027-01-02', 'planning', null),
        ('${T_PRIVATE}', '${USER}', 'pc', '共有していない旅', '札幌', '2027-02-01', '2027-02-03', 'planning', null),
        ('${T_DELETED}', '${USER}', 'pc', '消した旅', '那覇', '2027-03-01', '2027-03-03', 'planning', now());
      insert into public.trip_schedule (id, user_id, device_id, trip_id, date, title, type) values
        ('${S_SHARED}', '${USER}', 'pc', '${T_SHARED}', '2026-12-27', '羽田発', 'transport'),
        ('${S_PRIVATE}', '${USER}', 'pc', '${T_PRIVATE}', '2027-02-01', '新千歳着', 'transport');
      insert into public.trip_expenses (id, user_id, device_id, trip_id, title, amount, category) values
        ('${E_SHARED}', '${USER}', 'pc', '${T_SHARED}', 'うどん', 900, 'food'),
        ('${E_PRIVATE}', '${USER}', 'pc', '${T_PRIVATE}', 'ラーメン', 1100, 'food');
      insert into public.trip_expense_currencies (id, user_id, device_id, expense_id, currency, original_amount, exchange_rate) values
        ('d0000000-bbbb-4ccc-8ddd-eeeeeeeeeee1', '${USER}', 'pc', '${E_SHARED}', 'EUR', 6, 150),
        ('d0000000-bbbb-4ccc-8ddd-eeeeeeeeeee2', '${USER}', 'pc', '${E_PRIVATE}', 'EUR', 7, 150);
      insert into public.trip_packing_items (id, user_id, device_id, trip_id, title, category) values
        ('e0000000-bbbb-4ccc-8ddd-eeeeeeeeeee1', '${USER}', 'pc', '${T_SHARED}', '充電器', 'gadget');
      insert into public.trip_route_places (id, user_id, device_id, trip_id, name, address) values
        ('f0000000-bbbb-4ccc-8ddd-eeeeeeeeeee1', '${USER}', 'pc', '${T_SHARED}', '栗林公園', '香川県高松市');
      insert into public.trip_members (trip_id, owner_id, owner_email, invited_email, trip_name, trip_destination) values
        ('${T_PENDING}', '${USER}', 'owner@example.com', 'friend@example.com', '招待中の旅', '金沢'),
        ('${T_SHARED}', '${USER}', 'owner@example.com', 'waiting@example.com', 'みんなの旅', '高松'),
        ('${T_DELETED}', '${USER}', 'owner@example.com', 'friend@example.com', '消した旅', '那覇');
      insert into public.trip_members (trip_id, owner_id, owner_email, invited_email, member_id, status, accepted_at, trip_name, trip_destination) values
        ('${T_SHARED}', '${USER}', 'owner@example.com', 'friend@example.com', '${FRIEND}', 'accepted', now(), 'みんなの旅', '高松'),
        ('${T_SHARED}', '${USER}', 'owner@example.com', 'third@example.com', '${THIRD}', 'accepted', now(), 'みんなの旅', '高松');
    `);
  });

  describe("招待する(持ち主)", () => {
    it("メールアドレスで招ける。大文字・空白はそろえて入り、同じ人をもう一度招いても行は増えない", async () => {
      await asUser(USER, async () => {
        const first = await invite(TRIP, "  Mate@Example.COM ");
        expect(first).toMatchObject({ status: "pending", alreadyInvited: false });
        expect(await invite(TRIP, "mate@example.com")).toMatchObject({ id: first.id, alreadyInvited: true });
        expect(await count(`select count(*)::int as n from public.trip_members where trip_id = '${TRIP}'`)).toBe(1);
        const row = (await db.query<{ invited_email: string; trip_name: string; trip_destination: string; owner_email: string }>(
          `select invited_email, trip_name, trip_destination, owner_email from public.trip_members where trip_id = '${TRIP}'`,
        )).rows[0];
        expect(row).toEqual({ invited_email: "mate@example.com", trip_name: "四国旅行", trip_destination: "高松", owner_email: "owner@example.com" });
      });
    });

    it("アドレスの形が違う・自分宛て・長すぎるものは断る", async () => {
      await expect(asUser(USER, () => invite(TRIP, "ただの文字"))).rejects.toThrow(/invalid_email/);
      await expect(asUser(USER, () => invite(TRIP, "a@b"))).rejects.toThrow(/invalid_email/);
      await expect(asUser(USER, () => invite(TRIP, `${"a".repeat(250)}@example.com`))).rejects.toThrow(/invalid_email/);
      await expect(asUser(USER, () => invite(TRIP, "Owner@Example.com"))).rejects.toThrow(/self_invite/);
    });

    it("自分の旅行でなければ招けない(他人の旅行・参加しているだけの旅行・消した旅行・無い旅行)", async () => {
      await expect(asUser(OTHER, () => invite(TRIP, "mate@example.com"))).rejects.toThrow(/trip_not_found/);
      await expect(asUser(FRIEND, () => invite(T_SHARED, "mate@example.com"))).rejects.toThrow(/trip_not_found/);
      await expect(asUser(USER, () => invite(T_DELETED, "mate@example.com"))).rejects.toThrow(/trip_not_found/);
      await expect(asUser(USER, () => invite("a0000000-bbbb-4ccc-8ddd-000000000000", "mate@example.com"))).rejects.toThrow(/trip_not_found/);
    });

    it("参加者は10人まで。ログインしていない・ChatGPT のトークンでは招けない", async () => {
      await expect(
        asUser(USER, async () => {
          for (let i = 0; i < 10; i += 1) await invite(TRIP, `mate${i}@example.com`);
          return invite(TRIP, "mate10@example.com");
        }),
      ).rejects.toThrow(/too_many_members/);
      await expect(as("anon", null, () => invite(TRIP, "mate@example.com"))).rejects.toThrow(/login_required/);
      await expect(asUser(USER, () => invite(TRIP, "mate@example.com"), { client_id: "chatgpt-client" })).rejects.toThrow(/not_allowed/);
    });
  });

  describe("承認するまで", () => {
    it("招かれた人には、招待が見える。旅行そのものは、まだ見えない・書けない", async () => {
      await asUser(FRIEND, async () => {
        const invites = (await db.query<{ trip_name: string; trip_destination: string; owner_email: string; status: string }>(
          `select trip_name, trip_destination, owner_email, status from public.trip_members where trip_id = '${T_PENDING}'`,
        )).rows;
        expect(invites).toEqual([{ trip_name: "招待中の旅", trip_destination: "金沢", owner_email: "owner@example.com", status: "pending" }]);
        expect(await count(`select count(*)::int as n from public.trips where id = '${T_PENDING}'`)).toBe(0);
        await db.exec("savepoint s");
        await expect(db.exec(newSchedule("b0000000-bbbb-4ccc-8ddd-eeeeeeeeee99", T_PENDING, USER))).rejects.toThrow();
      });
    });

    it("関係ない人・アドレスの確認が済んでいない人(同じアドレスで登録しただけ)には、招待が見えず、承認もできない", async () => {
      expect(await asUser(OTHER, () => rows(`select * from public.trip_members where trip_id = '${T_PENDING}'`))).toBe(0);
      expect(await asUser(IMPOSTOR, () => rows(`select * from public.trip_members where trip_id = '${T_PENDING}'`))).toBe(0);
      await expect(asUser(IMPOSTOR, () => respond(T_PENDING, true))).rejects.toThrow(/invite_not_found/);
      await expect(asUser(OTHER, () => respond(T_PENDING, true))).rejects.toThrow(/invite_not_found/);
    });

    it("参加すると、その場から旅行が読める。もう一度は参加できない", async () => {
      await asUser(USER, async () => {
        const { id } = await invite(TRIP, "friend@example.com");
        expect(id).toBeTruthy();
        await switchTo(FRIEND);
        expect(await count(`select count(*)::int as n from public.trips where id = '${TRIP}'`)).toBe(0);
        expect(await respond(TRIP, true)).toEqual({ tripId: TRIP, status: "accepted" });
        expect(await count(`select count(*)::int as n from public.trips where id = '${TRIP}'`)).toBe(1);
        expect(await count(`select count(*)::int as n from public.trip_schedule where trip_id = '${TRIP}'`)).toBe(1);
        const row = (await db.query<{ status: string; member_id: string }>(`select status, member_id from public.trip_members where trip_id = '${TRIP}'`)).rows[0];
        expect(row).toEqual({ status: "accepted", member_id: FRIEND });
      });
      await expect(
        asUser(USER, async () => {
          await invite(TRIP, "friend@example.com");
          await switchTo(FRIEND);
          await respond(TRIP, true);
          return respond(TRIP, true);
        }),
      ).rejects.toThrow(/invite_not_found/);
    });

    it("断ると、招待の行が消える(持ち主は、もう一度招ける)", async () => {
      await asUser(USER, async () => {
        await invite(TRIP, "friend@example.com");
        await switchTo(FRIEND);
        expect(await respond(TRIP, false)).toEqual({ tripId: TRIP, status: "declined" });
        expect(await count(`select count(*)::int as n from public.trip_members where trip_id = '${TRIP}'`)).toBe(0);
        expect(await count(`select count(*)::int as n from public.trips where id = '${TRIP}'`)).toBe(0);
        await switchTo(USER);
        expect((await invite(TRIP, "friend@example.com")).alreadyInvited).toBe(false);
      });
    });

    it("持ち主が消した旅行には参加できない(招待の行も片付く)", async () => {
      await asUser(FRIEND, async () => {
        await expect(respond(T_DELETED, true)).rejects.toThrow(/trip_not_found/);
      });
    });

    it("ChatGPT のトークンでは、招待を読むことも承認することもできない", async () => {
      expect(await asUser(FRIEND, () => rows("select * from public.trip_members"), { client_id: "chatgpt-client" })).toBe(0);
      await expect(asUser(FRIEND, () => respond(T_PENDING, true), { client_id: "chatgpt-client" })).rejects.toThrow(/not_allowed/);
    });
  });

  describe("参加中の人(一緒に編集)", () => {
    it("旅行・日程・費用・通貨の内訳・持ち物・ルートが読める。共有していない旅行と、日記は読めない", async () => {
      await asUser(FRIEND, async () => {
        expect(await count(`select count(*)::int as n from public.trips where id = '${T_SHARED}'`)).toBe(1);
        expect(await count(`select count(*)::int as n from public.trip_schedule where trip_id = '${T_SHARED}'`)).toBe(1);
        expect(await count(`select count(*)::int as n from public.trip_expenses where trip_id = '${T_SHARED}'`)).toBe(1);
        expect(await count(`select count(*)::int as n from public.trip_expense_currencies where expense_id = '${E_SHARED}'`)).toBe(1);
        expect(await count(`select count(*)::int as n from public.trip_packing_items where trip_id = '${T_SHARED}'`)).toBe(1);
        expect(await count(`select count(*)::int as n from public.trip_route_places where trip_id = '${T_SHARED}'`)).toBe(1);
        // 共有していない旅行
        expect(await count(`select count(*)::int as n from public.trips where id = '${T_PRIVATE}'`)).toBe(0);
        expect(await count(`select count(*)::int as n from public.trip_schedule where trip_id = '${T_PRIVATE}'`)).toBe(0);
        expect(await count(`select count(*)::int as n from public.trip_expense_currencies where expense_id = '${E_PRIVATE}'`)).toBe(0);
        // 日記は、旅行を共有しても共有しない
        expect(await count("select count(*)::int as n from public.diary_entries")).toBe(0);
      });
    });

    it("日程を、持ち主の名前で足せる・直せる・消せる(消すのは deleted_at を入れる更新)。持ち主の端末にも見える", async () => {
      await asUser(FRIEND, async () => {
        expect(await rows(`${newSchedule("b0000000-bbbb-4ccc-8ddd-eeeeeeeeee10", T_SHARED, USER)} returning id`)).toBe(1);
        expect(await rows(`update public.trip_schedule set title = '書き換え' where id = '${S_SHARED}' returning id`)).toBe(1);
        expect(await rows(`update public.trip_schedule set deleted_at = now() where id = 'b0000000-bbbb-4ccc-8ddd-eeeeeeeeee10' returning id`)).toBe(1);
        expect(await rows(`${newSchedule("b0000000-bbbb-4ccc-8ddd-eeeeeeeeee11", T_SHARED, USER)} returning id`)).toBe(1);
        await switchTo(USER);
        const titles = (await db.query<{ title: string }>(`select title from public.trip_schedule where trip_id = '${T_SHARED}' and deleted_at is null order by title`)).rows.map((r) => r.title);
        expect(titles).toEqual(["書き換え", "追加"]);
      });
    });

    it("費用と通貨の内訳も足せる。ただし持ち主の名前で。ほかの旅行の費用には付けられない", async () => {
      await asUser(FRIEND, async () => {
        expect(
          await rows(`insert into public.trip_expenses (id, user_id, device_id, trip_id, title, amount, category) values ('c0000000-bbbb-4ccc-8ddd-eeeeeeeeee10','${USER}','phone','${T_SHARED}','お土産',1500,'shopping') returning id`),
        ).toBe(1);
        expect(
          await rows(`insert into public.trip_expense_currencies (id, user_id, device_id, expense_id, currency, original_amount, exchange_rate) values ('d0000000-bbbb-4ccc-8ddd-eeeeeeeeee10','${USER}','phone','c0000000-bbbb-4ccc-8ddd-eeeeeeeeee10','USD',10,150) returning id`),
        ).toBe(1);
        expect(await rows(`update public.trip_expense_currencies set exchange_rate = 151 where expense_id = '${E_SHARED}' returning id`)).toBe(1);
        expect(await rows(`update public.trip_expense_currencies set exchange_rate = 1 where expense_id = '${E_PRIVATE}' returning id`)).toBe(0);
      });
      await expect(
        asUser(FRIEND, () =>
          db.exec(`insert into public.trip_expense_currencies (id, user_id, device_id, expense_id, currency, original_amount, exchange_rate) values ('d0000000-bbbb-4ccc-8ddd-eeeeeeeeee11','${USER}','phone','${E_PRIVATE}','USD',10,150)`),
        ),
      ).rejects.toThrow();
      await expect(
        asUser(FRIEND, () =>
          db.exec(`insert into public.trip_expense_currencies (id, user_id, device_id, expense_id, currency, original_amount, exchange_rate) values ('d0000000-bbbb-4ccc-8ddd-eeeeeeeeee12','${FRIEND}','phone','${E_SHARED}','USD',10,150)`),
        ),
      ).rejects.toThrow();
    });

    it("他人の名前では書けない(自分の名前でも、別の人の名前でも)", async () => {
      await expect(asUser(FRIEND, () => db.exec(newSchedule("b0000000-bbbb-4ccc-8ddd-eeeeeeeeee20", T_SHARED, FRIEND)))).rejects.toThrow();
      await expect(asUser(FRIEND, () => db.exec(newSchedule("b0000000-bbbb-4ccc-8ddd-eeeeeeeeee21", T_SHARED, OTHER)))).rejects.toThrow();
      await expect(asUser(FRIEND, () => db.exec(`update public.trip_schedule set user_id = '${FRIEND}' where id = '${S_SHARED}'`))).rejects.toThrow();
    });

    it("共有していない旅行には、書けない・直せない・消せない", async () => {
      await expect(asUser(FRIEND, () => db.exec(newSchedule("b0000000-bbbb-4ccc-8ddd-eeeeeeeeee30", T_PRIVATE, USER)))).rejects.toThrow();
      expect(await asUser(FRIEND, () => rows(`update public.trip_schedule set title = 'x' where id = '${S_PRIVATE}' returning id`))).toBe(0);
      expect(await asUser(FRIEND, () => rows(`update public.trip_schedule set deleted_at = now() where id = '${S_PRIVATE}' returning id`))).toBe(0);
      expect(await asUser(FRIEND, () => rows(`update public.trips set name = 'x' where id = '${T_PRIVATE}' returning id`))).toBe(0);
      // 招待中(承認前)の旅行にも書けない
      expect(await asUser(FRIEND, () => rows(`update public.trips set name = 'x' where id = '${T_PENDING}' returning id`))).toBe(0);
    });

    it("旅行そのものは、直せる(名前・日付)。ただし消せない・持ち主を変えられない・新しい旅行は作れない", async () => {
      await asUser(FRIEND, async () => {
        expect(await rows(`update public.trips set name = 'みんなの旅(改)' where id = '${T_SHARED}' returning id`)).toBe(1);
        // 同期は upsert で送るので、行が既にある旅行への upsert が通ること
        expect(
          await rows(`insert into public.trips (id, user_id, device_id, name, destination, start_date, end_date, status) values ('${T_SHARED}','${USER}','phone','みんなの旅(再)','高松','2026-12-27','2027-01-03','planning')
            on conflict (id) do update set name = excluded.name, end_date = excluded.end_date, device_id = excluded.device_id returning id`),
        ).toBe(1);
      });
      await expect(asUser(FRIEND, () => db.exec(`update public.trips set deleted_at = now() where id = '${T_SHARED}'`))).rejects.toThrow();
      await expect(asUser(FRIEND, () => db.exec(`update public.trips set user_id = '${FRIEND}' where id = '${T_SHARED}'`))).rejects.toThrow();
      await expect(
        asUser(FRIEND, () =>
          db.exec(`insert into public.trips (id, user_id, device_id, name, destination, start_date, end_date, status) values ('a0000000-bbbb-4ccc-8ddd-eeeeeeeeee99','${USER}','phone','勝手な旅','x','2027-01-01','2027-01-02','planning')`),
        ),
      ).rejects.toThrow();
      expect(await asUser(FRIEND, () => rows(`delete from public.trips where id = '${T_SHARED}' returning id`))).toBe(0);
      expect(await asUser(FRIEND, () => rows(`delete from public.trip_schedule where id = '${S_SHARED}' returning id`))).toBe(0);
    });

    it("持ち主は今までどおり全部できる。ほかの人(参加していない)には、何も見えない", async () => {
      expect(await asUser(USER, () => rows(`update public.trips set memo = 'メモ' where id = '${T_SHARED}' returning id`))).toBe(1);
      expect(await asUser(USER, () => count("select count(*)::int as n from public.trips"))).toBeGreaterThanOrEqual(4);
      expect(await asUser(OTHER, () => count(`select count(*)::int as n from public.trips where id in ('${T_SHARED}','${T_PRIVATE}','${T_PENDING}')`))).toBe(0);
      expect(await asUser(OTHER, () => count(`select count(*)::int as n from public.trip_schedule where trip_id = '${T_SHARED}'`))).toBe(0);
      expect(await as("anon", null, () => count("select count(*)::int as n from public.trips"))).toBe(0);
    });

    it("ChatGPT のトークンは、共有された旅行にも、これまでの制限どおり(読む・足すだけ)", async () => {
      expect(await asUser(FRIEND, () => count(`select count(*)::int as n from public.trips where id = '${T_SHARED}'`), { client_id: "chatgpt-client" })).toBe(1);
      expect(await asUser(FRIEND, () => rows(`update public.trips set name = 'x' where id = '${T_SHARED}' returning id`), { client_id: "chatgpt-client" })).toBe(0);
      expect(await asUser(FRIEND, () => rows(`update public.trip_schedule set title = 'x' where id = '${S_SHARED}' returning id`), { client_id: "chatgpt-client" })).toBe(0);
      expect(await asUser(FRIEND, () => count(`select count(*)::int as n from public.trip_expenses where trip_id = '${T_SHARED}'`), { client_id: "chatgpt-client" })).toBe(0);
    });
  });

  describe("参加者の一覧と、表への直接の書き込み", () => {
    it("参加中の人は、同じ旅行の参加中の人が見える。承認待ちの人は、持ち主だけが見える", async () => {
      const emails = (sub: string) =>
        asUser(sub, async () =>
          (await db.query<{ invited_email: string }>(`select invited_email from public.trip_members where trip_id = '${T_SHARED}' order by invited_email`)).rows.map((r) => r.invited_email),
        );
      expect(await emails(USER)).toEqual(["friend@example.com", "third@example.com", "waiting@example.com"]);
      expect(await emails(FRIEND)).toEqual(["friend@example.com", "third@example.com"]);
      expect(await emails(THIRD)).toEqual(["friend@example.com", "third@example.com"]);
      expect(await emails(OTHER)).toEqual([]);
    });

    it("表には、誰も直接は書けない(持ち主も、参加者も、招かれた人も)", async () => {
      const insert = `insert into public.trip_members (trip_id, owner_id, invited_email, member_id, status) values ('${T_PRIVATE}','${FRIEND}','friend@example.com','${FRIEND}','accepted')`;
      await expect(asUser(FRIEND, () => db.exec(insert))).rejects.toThrow();
      await expect(asUser(USER, () => db.exec(insert.replace(`'${FRIEND}','friend`, `'${USER}','friend`)))).rejects.toThrow();
      expect(await asUser(FRIEND, () => rows(`update public.trip_members set status = 'accepted', member_id = '${FRIEND}' where trip_id = '${T_PENDING}' returning id`))).toBe(0);
      expect(await asUser(FRIEND, () => rows(`delete from public.trip_members where trip_id = '${T_SHARED}' returning id`))).toBe(0);
      expect(await asUser(USER, () => rows(`delete from public.trip_members where trip_id = '${T_SHARED}' returning id`))).toBe(0);
      expect(await as("anon", null, () => rows("select * from public.trip_members"))).toBe(0);
    });

    it("参加の増減は、リアルタイムの配信に載っている", async () => {
      expect(await count("select count(*)::int as n from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'trip_members'")).toBe(1);
    });
  });

  describe("外す・抜ける", () => {
    it("持ち主が外すと、その場から読めも書けもしない。外されたのが自分でなければ、変わらない", async () => {
      await asUser(USER, async () => {
        const friendRow = (await db.query<{ id: string }>(`select id from public.trip_members where trip_id = '${T_SHARED}' and member_id = '${FRIEND}'`)).rows[0].id;
        await switchTo(FRIEND);
        expect(await count(`select count(*)::int as n from public.trips where id = '${T_SHARED}'`)).toBe(1);
        // 参加者本人は、他人(や自分)の行を「外す」ことはできない
        expect((await db.query<{ n: number }>("select public.remove_trip_member($1) as n", [friendRow])).rows[0].n).toBe(0);
        await switchTo(USER);
        expect((await db.query<{ n: number }>("select public.remove_trip_member($1) as n", [friendRow])).rows[0].n).toBe(1);
        await switchTo(FRIEND);
        expect(await count(`select count(*)::int as n from public.trips where id = '${T_SHARED}'`)).toBe(0);
        expect(await count(`select count(*)::int as n from public.trip_schedule where trip_id = '${T_SHARED}'`)).toBe(0);
        await db.exec("savepoint after_remove");
        await expect(db.exec(newSchedule("b0000000-bbbb-4ccc-8ddd-eeeeeeeeee40", T_SHARED, USER))).rejects.toThrow();
        await db.exec("rollback to savepoint after_remove");
        expect(await rows(`update public.trip_schedule set title = 'x' where id = '${S_SHARED}' returning id`)).toBe(0);
        // もう一人の参加者には、影響しない
        await switchTo(THIRD);
        expect(await count(`select count(*)::int as n from public.trips where id = '${T_SHARED}'`)).toBe(1);
      });
    });

    it("承認待ちの招待は、持ち主が取り消せる。他人の旅行の招待は取り消せない", async () => {
      await asUser(USER, async () => {
        const waiting = (await db.query<{ id: string }>(`select id from public.trip_members where trip_id = '${T_SHARED}' and invited_email = 'waiting@example.com'`)).rows[0].id;
        await switchTo(OTHER);
        expect((await db.query<{ n: number }>("select public.remove_trip_member($1) as n", [waiting])).rows[0].n).toBe(0);
        await switchTo(USER);
        expect((await db.query<{ n: number }>("select public.remove_trip_member($1) as n", [waiting])).rows[0].n).toBe(1);
      });
    });

    it("参加した人は、自分から抜けられる。抜けたあとは読めない。参加していない人が抜けても何も起きない", async () => {
      await asUser(FRIEND, async () => {
        expect((await db.query<{ n: number }>("select public.leave_trip($1) as n", [T_SHARED])).rows[0].n).toBe(1);
        expect(await count(`select count(*)::int as n from public.trips where id = '${T_SHARED}'`)).toBe(0);
        expect((await db.query<{ n: number }>("select public.leave_trip($1) as n", [T_SHARED])).rows[0].n).toBe(0);
      });
      expect(await asUser(OTHER, async () => (await db.query<{ n: number }>("select public.leave_trip($1) as n", [T_SHARED])).rows[0].n)).toBe(0);
      // 持ち主の分は、抜ける操作では消えない
      expect(await asUser(USER, async () => (await db.query<{ n: number }>("select public.leave_trip($1) as n", [T_SHARED])).rows[0].n)).toBe(0);
    });

    it("ログインしていない・ChatGPT のトークンでは、抜ける・外すもできない", async () => {
      await expect(as("anon", null, () => db.query("select public.leave_trip($1)", [T_SHARED]))).rejects.toThrow(/login_required/);
      await expect(asUser(FRIEND, () => db.query("select public.leave_trip($1)", [T_SHARED]), { client_id: "chatgpt-client" })).rejects.toThrow(/not_allowed/);
      await expect(asUser(USER, () => db.query("select public.remove_trip_member($1)", [T_SHARED]), { client_id: "chatgpt-client" })).rejects.toThrow(/not_allowed/);
    });
  });
});
