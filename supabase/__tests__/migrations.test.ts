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

