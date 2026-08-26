// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_DB_NAME,
  forgetAccount,
  getActiveAccount,
  listAccounts,
  rememberAccount,
  scopedKey,
  setActiveAccount,
} from "./accounts";

describe("端末に登録したアカウントの一覧", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("1つ目のアカウントは、既にこの端末にある既定のDBをそのまま引き継ぐ", () => {
    const account = rememberAccount({ userId: "user-a", email: "a@example.com" }, null);

    expect(account.dbName).toBe(DEFAULT_DB_NAME);
    expect(account.slot).toBeNull();
    expect(getActiveAccount()?.userId).toBe("user-a");
  });

  it("2つ目のアカウントには別のDBと別のセッション置き場所を割り当てる", () => {
    rememberAccount({ userId: "user-a" }, null);
    const second = rememberAccount({ userId: "user-b", email: "b@example.com" }, "user-b");

    expect(second.dbName).toBe(`${DEFAULT_DB_NAME}-user-b`);
    expect(listAccounts().map((a) => a.userId)).toEqual(["user-a", "user-b"]);
    // 1つ目のアカウントは一覧に残ったまま(切り替えて戻れる)。
    expect(listAccounts()[0].dbName).toBe(DEFAULT_DB_NAME);
  });

  it("再ログインでは置き場所とDBを変えず、表示名だけ新しくする", () => {
    rememberAccount({ userId: "user-a" }, null);
    rememberAccount({ userId: "user-b" }, "user-b");
    const again = rememberAccount({ userId: "user-b", name: "サブ" }, "user-b");

    expect(again.dbName).toBe(`${DEFAULT_DB_NAME}-user-b`);
    expect(again.name).toBe("サブ");
    expect(listAccounts()).toHaveLength(2);
  });

  it("同じ置き場所に別のユーザーがログインしたら、前のアカウントは一覧から外れる", () => {
    rememberAccount({ userId: "user-a" }, null);
    const replacement = rememberAccount({ userId: "user-c" }, null);

    expect(listAccounts().map((a) => a.userId)).toEqual(["user-c"]);
    // 置き場所が空いたので、既定のDBもそのまま引き継ぐ(持ち主の入れ替わりは
    // src/lib/dataOwner.ts が見て中身を空にする)。
    expect(replacement.dbName).toBe(DEFAULT_DB_NAME);
  });

  it("一覧から外しても、同じアカウントを入れ直せば同じDBに戻る", () => {
    rememberAccount({ userId: "user-a" }, null);
    rememberAccount({ userId: "user-b" }, "user-b");
    setActiveAccount("user-b");

    forgetAccount("user-b");
    expect(listAccounts().map((a) => a.userId)).toEqual(["user-a"]);
    expect(getActiveAccount()?.userId).toBe("user-a");

    expect(rememberAccount({ userId: "user-b" }, "user-b").dbName).toBe(`${DEFAULT_DB_NAME}-user-b`);
  });

  it("壊れた記録が入っていても空の一覧として扱う", () => {
    localStorage.setItem("lifeHubAccounts", "{ではない");
    expect(listAccounts()).toEqual([]);
  });
});

describe("scopedKey", () => {
  it("既定のDBを使うアカウントでは、今までと同じキーのまま", () => {
    // 起動時に確定する値を見るので、この環境(記録なし)では既定のDB。
    expect(scopedKey("lifeHubLastSynced:notes")).toBe("lifeHubLastSynced:notes");
    expect(scopedKey("lifeHubDataOwner")).toBe("lifeHubDataOwner");
  });
});

describe("2つ目のアカウントで起動したとき", () => {
  it("同期カーソルと持ち主の記録が、そのアカウント専用のキーになる", async () => {
    localStorage.clear();
    localStorage.setItem(
      "lifeHubAccounts",
      JSON.stringify([
        { userId: "user-a", email: null, name: null, avatarUrl: null, slot: null, dbName: "life-hub", addedAt: 1 },
        { userId: "user-b", email: null, name: null, avatarUrl: null, slot: "user-b", dbName: "life-hub-user-b", addedAt: 2 },
      ]),
    );
    localStorage.setItem("lifeHubActiveAccount", "user-b");

    // 起動時の値はモジュール読み込み時に固まるので、読み直して確かめる。
    vi.resetModules();
    const fresh = await import("./accounts");
    expect(fresh.BOOT_DB_NAME).toBe("life-hub-user-b");
    expect(fresh.BOOT_SLOT).toBe("user-b");
    expect(fresh.scopedKey("lifeHubLastSynced:notes")).toBe("life-hub-user-b:lifeHubLastSynced:notes");
    // 1つ目のアカウントのキー(接頭辞なし)とは別物なので、互いに消し合わない。
    expect(fresh.scopedKey("lifeHubLastSynced:notes").startsWith("lifeHubLastSynced:")).toBe(false);
  });
});
