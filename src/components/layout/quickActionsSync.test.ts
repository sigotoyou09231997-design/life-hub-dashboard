import { beforeEach, describe, expect, it, vi } from "vitest";

// いま開いているアカウントを、テストの中で切り替えられるようにする(本物は起動時に1つに固定)。
let activeDb = "life-hub";
vi.mock("../../lib/accounts", () => ({
  IS_ADDING_ACCOUNT: false,
  scopedKey: (base: string) => (activeDb === "life-hub" ? base : `${activeDb}:${base}`),
}));
vi.mock("../../lib/supabase", () => ({
  auth: { getSession: async () => ({ data: { session: null } }) },
  getSupabaseConfig: () => ({ url: "https://example.invalid", anonKey: "anon" }),
  isSupabaseConfigured: false,
}));

import {
  DEFAULT_QUICK_ACTION_KEYS,
  hasStoredQuickActionKeys,
  loadQuickActionKeys,
  saveQuickActionKeys,
  type QuickActionKey,
} from "./quickActions";
import { pushQuickActions, syncQuickActions, type QuickActionRemote } from "./quickActionsSync";

class MemoryStorage {
  private data = new Map<string, string>();
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); }
}

function fakeRemote(initial: unknown | null | undefined, options: { writeOk?: boolean } = {}) {
  const state = { value: initial, writes: [] as QuickActionKey[][] };
  const remote: QuickActionRemote = {
    async read() { return state.value; },
    async write(keys) {
      state.writes.push(keys);
      if (options.writeOk === false) return false;
      state.value = keys;
      return true;
    },
  };
  return { remote, state };
}

beforeEach(() => {
  activeDb = "life-hub";
});

describe("追従ナビの並びをアカウントに紐づける", () => {
  it("サーバーにも端末にも無ければ、何も送らず初期の並びのまま", async () => {
    const storage = new MemoryStorage();
    const { remote, state } = fakeRemote(null);
    expect(await syncQuickActions(remote, storage)).toBeNull();
    expect(state.writes).toEqual([]);
    expect(loadQuickActionKeys(storage)).toEqual(DEFAULT_QUICK_ACTION_KEYS);
  });

  it("サーバーに無く、この端末で並べ替え済みなら、その並びを送って元にする", async () => {
    const storage = new MemoryStorage();
    saveQuickActionKeys(["trips", "money"], storage);
    const { remote, state } = fakeRemote(null);
    expect(await syncQuickActions(remote, storage)).toBeNull();
    expect(state.writes).toEqual([["trips", "money"]]);
  });

  it("サーバーに並びがあれば、別の端末でもそれになる(サーバーが正)", async () => {
    const storage = new MemoryStorage();
    const { remote, state } = fakeRemote(["gmail", "trips", "notes"]);
    expect(await syncQuickActions(remote, storage)).toEqual(["gmail", "trips", "notes"]);
    expect(loadQuickActionKeys(storage)).toEqual(["gmail", "trips", "notes"]);
    expect(state.writes).toEqual([]);
  });

  it("端末で並べ替え済みでも、サーバーに別の並びがあればサーバーに合わせる", async () => {
    const storage = new MemoryStorage();
    saveQuickActionKeys(["trips"], storage);
    const { remote } = fakeRemote(["schedule", "money"]);
    expect(await syncQuickActions(remote, storage)).toEqual(["schedule", "money"]);
    expect(loadQuickActionKeys(storage)).toEqual(["schedule", "money"]);
  });

  it("同じ並びなら何もしない(画面を作り直さない)", async () => {
    const storage = new MemoryStorage();
    saveQuickActionKeys(["schedule", "money"], storage);
    const { remote, state } = fakeRemote(["schedule", "money"]);
    expect(await syncQuickActions(remote, storage)).toBeNull();
    expect(state.writes).toEqual([]);
  });

  it("読めなかった時(オフラインなど)は、端末の並びのまま", async () => {
    const storage = new MemoryStorage();
    saveQuickActionKeys(["trips", "notes"], storage);
    const { remote } = fakeRemote(undefined);
    expect(await syncQuickActions(remote, storage)).toBeNull();
    expect(loadQuickActionKeys(storage)).toEqual(["trips", "notes"]);
  });

  it("サーバーの値が壊れていても、使える部分だけ(無ければ初期の並び)にする", async () => {
    const storage = new MemoryStorage();
    const { remote } = fakeRemote(["unknown", 3, "money"]);
    expect(await syncQuickActions(remote, storage)).toEqual(["money"]);
  });

  it("送れなかった並べ替えは、サーバーの古い値で消さず、次の機会に送り直す", async () => {
    const storage = new MemoryStorage();
    const saved = saveQuickActionKeys(["trips", "gmail"], storage);
    const offline = fakeRemote(["schedule"], { writeOk: false });
    await pushQuickActions(saved, offline.remote, storage);
    expect(offline.state.writes).toEqual([["trips", "gmail"]]);

    // 通信が戻ったあと: サーバーはまだ古い値だが、並べた方が残り、サーバーへ送られる
    const online = fakeRemote(["schedule"]);
    expect(await syncQuickActions(online.remote, storage)).toBeNull();
    expect(loadQuickActionKeys(storage)).toEqual(["trips", "gmail"]);
    expect(online.state.writes).toEqual([["trips", "gmail"]]);

    // 送れたので、次からはサーバーに合わせる側に戻る
    const later = fakeRemote(["notes", "money"]);
    expect(await syncQuickActions(later.remote, storage)).toEqual(["notes", "money"]);
  });

  it("送る処理が例外を投げても、画面の操作は止めない", async () => {
    const storage = new MemoryStorage();
    const remote: QuickActionRemote = {
      read: async () => { throw new Error("network"); },
      write: async () => { throw new Error("network"); },
    };
    await expect(pushQuickActions(["trips"], remote, storage)).resolves.toBeUndefined();
    await expect(syncQuickActions(remote, storage)).resolves.toBeNull();
  });

  it("端末の中のアカウントごとに、別々の並びを覚える", () => {
    const storage = new MemoryStorage();
    activeDb = "life-hub";
    saveQuickActionKeys(["trips", "gmail"], storage);

    activeDb = "life-hub-acct2";
    expect(hasStoredQuickActionKeys(storage)).toBe(false);
    expect(loadQuickActionKeys(storage)).toEqual(DEFAULT_QUICK_ACTION_KEYS);
    saveQuickActionKeys(["notes"], storage);

    activeDb = "life-hub";
    expect(loadQuickActionKeys(storage)).toEqual(["trips", "gmail"]);
    activeDb = "life-hub-acct2";
    expect(loadQuickActionKeys(storage)).toEqual(["notes"]);
  });
});
