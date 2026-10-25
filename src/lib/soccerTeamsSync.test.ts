import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/schema", () => ({ db: {} }));

import { loadSoccerTeams, saveSoccerTeams, shouldAutoSyncSoccer, soccerSyncIsCurrent, SOCCER_SYNC_VERSION } from "./soccerFixtures";
import { pushSoccerTeams, syncSoccerTeams, type SoccerTeamsRemote } from "./soccerTeamsSync";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

const arsenal = { id: "359", name: "アーセナル", league: "プレミアリーグ" };
const madrid = { id: "86", name: "レアル・マドリード", league: "ラ・リーガ" };

function remoteOf(value: unknown, writeOk = true): SoccerTeamsRemote & { written: unknown[] } {
  const written: unknown[] = [];
  return {
    written,
    read: async () => value,
    write: async (teams) => {
      written.push(teams);
      return writeOk;
    },
  };
}

describe("syncSoccerTeams", () => {
  let storage: ReturnType<typeof memoryStorage>;
  beforeEach(() => {
    storage = memoryStorage();
  });

  it("サーバーに選択があれば、この端末をそれに揃える", async () => {
    const remote = remoteOf([arsenal, madrid]);
    expect(await syncSoccerTeams(remote, storage)).toEqual([arsenal, madrid]);
    expect(loadSoccerTeams(storage)).toEqual([arsenal, madrid]);
  });

  it("サーバーにまだ無く、この端末で選んでいれば送る", async () => {
    saveSoccerTeams([arsenal], storage);
    const remote = remoteOf(null);
    expect(await syncSoccerTeams(remote, storage)).toEqual([arsenal]);
    expect(remote.written).toEqual([[arsenal]]);
  });

  it("どちらにも無ければ何も送らない", async () => {
    const remote = remoteOf(null);
    expect(await syncSoccerTeams(remote, storage)).toEqual([]);
    expect(remote.written).toEqual([]);
  });

  it("送れなかった選択は、サーバーの古い値で上書きしない(次の機会に送り直す)", async () => {
    saveSoccerTeams([arsenal], storage);
    await pushSoccerTeams([arsenal], remoteOf(null, false), storage);
    const remote = remoteOf([madrid]);
    expect(await syncSoccerTeams(remote, storage)).toEqual([arsenal]);
    expect(remote.written).toEqual([[arsenal]]);
  });

  it("読めない時は、この端末の選択のまま", async () => {
    saveSoccerTeams([arsenal], storage);
    expect(await syncSoccerTeams(remoteOf(undefined), storage)).toEqual([arsenal]);
  });

  it("全部外した状態(空の配列)も、別の端末に揃う", async () => {
    saveSoccerTeams([arsenal], storage);
    expect(await syncSoccerTeams(remoteOf([]), storage)).toEqual([]);
  });
});

describe("書き方を変えた版の取り込み", () => {
  it("前回が今の版でなければ、6時間待たずに取り込む", () => {
    const now = Date.now();
    expect(shouldAutoSyncSoccer([arsenal], now - 60_000, now, true)).toBe(false);
    expect(shouldAutoSyncSoccer([arsenal], now - 60_000, now, false)).toBe(true);
    expect(shouldAutoSyncSoccer([], 0, now, false)).toBe(false);
  });

  it("版が記録されていなければ、今の版ではない", () => {
    const storage = memoryStorage();
    expect(soccerSyncIsCurrent(storage)).toBe(false);
    storage.setItem("lifeHubSoccerSyncVersion:v1", SOCCER_SYNC_VERSION);
    expect(soccerSyncIsCurrent(storage)).toBe(true);
  });
});
