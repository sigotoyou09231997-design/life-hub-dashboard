// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { hasStoredHiddenFeatures, loadHiddenFeatures, saveHiddenFeatures, type HideableFeature } from "./hiddenFeatures";
import { pushHiddenFeatures, syncHiddenFeatures, type HiddenFeaturesRemote } from "./hiddenFeaturesSync";

class MemoryStorage {
  private data = new Map<string, string>();
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); }
}

function fakeRemote(initial: unknown | null | undefined, options: { writeOk?: boolean } = {}) {
  const state = { value: initial, writes: [] as HideableFeature[][] };
  const remote: HiddenFeaturesRemote = {
    async read() { return state.value; },
    async write(hidden) {
      state.writes.push(hidden);
      if (options.writeOk === false) return false;
      state.value = hidden;
      return true;
    },
  };
  return { remote, state };
}

let storage: MemoryStorage;
beforeEach(() => {
  storage = new MemoryStorage();
});

describe("隠す機能の設定をアカウントに紐づける", () => {
  it("サーバーにも端末にも無ければ、何も送らず、何も隠さない", async () => {
    const { remote, state } = fakeRemote(null);
    expect(await syncHiddenFeatures(remote, storage)).toBeNull();
    expect(state.writes).toEqual([]);
    expect(loadHiddenFeatures(storage)).toEqual([]);
  });

  it("サーバーに設定があれば、それが正。別の端末で隠したものが、この端末にも出る", async () => {
    const { remote } = fakeRemote(["gmail", "trips"]);
    expect(await syncHiddenFeatures(remote, storage)).toEqual(["gmail", "trips"]);
    expect(loadHiddenFeatures(storage)).toEqual(["gmail", "trips"]);
    // 2回目は、変わらないので null
    expect(await syncHiddenFeatures(remote, storage)).toBeNull();
  });

  it("別の端末で全部戻した(空)も、この端末に届く", async () => {
    saveHiddenFeatures(["gmail"], storage);
    const { remote } = fakeRemote([]);
    expect(await syncHiddenFeatures(remote, storage)).toEqual([]);
    expect(loadHiddenFeatures(storage)).toEqual([]);
  });

  it("サーバーにまだ無く、この端末で設定済みなら、それを送って元にする(今までの人が設定を失わない)", async () => {
    saveHiddenFeatures(["notes"], storage);
    const { remote, state } = fakeRemote(null);
    expect(await syncHiddenFeatures(remote, storage)).toBeNull();
    expect(state.writes).toEqual([["notes"]]);
  });

  it("読めない(オフライン・未ログイン)時は、端末の設定のまま。何も送らない", async () => {
    saveHiddenFeatures(["notes"], storage);
    const { remote, state } = fakeRemote(undefined);
    expect(await syncHiddenFeatures(remote, storage)).toBeNull();
    expect(loadHiddenFeatures(storage)).toEqual(["notes"]);
    expect(state.writes).toEqual([]);
  });

  it("送れなかった変更は、サーバーの古い値で消さず、次の機会に送り直す", async () => {
    saveHiddenFeatures(["gmail"], storage);
    const offline = fakeRemote(["trips"], { writeOk: false });
    await pushHiddenFeatures(["gmail"], offline.remote, storage);
    // 送れていない間に同期しても、サーバーの古い値(trips)で上書きしない
    const stillOffline = fakeRemote(["trips"], { writeOk: false });
    expect(await syncHiddenFeatures(stillOffline.remote, storage)).toBeNull();
    expect(loadHiddenFeatures(storage)).toEqual(["gmail"]);
    // 通信が戻ったら、送れる
    const online = fakeRemote(["trips"]);
    expect(await syncHiddenFeatures(online.remote, storage)).toBeNull();
    expect(online.state.writes).toEqual([["gmail"]]);
    // 送れたあとは、サーバーの値が正に戻る
    online.state.value = ["review"];
    expect(await syncHiddenFeatures(online.remote, storage)).toEqual(["review"]);
  });

  it("端末に何も覚えていない新しい端末は、サーバーが空でも、空を覚える(次からは設定済み)", async () => {
    expect(hasStoredHiddenFeatures(storage)).toBe(false);
    const { remote } = fakeRemote([]);
    await syncHiddenFeatures(remote, storage);
    expect(hasStoredHiddenFeatures(storage)).toBe(true);
  });
});
