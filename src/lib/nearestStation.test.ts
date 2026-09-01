/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  describeNearestStation,
  fetchNearestStation,
  readCache,
  resetNearestStationCache,
  type NearestStationResponse,
} from "./nearestStation";
import { formatDistance, formatDuration } from "./routeInfo";

const format = { duration: formatDuration, distance: formatDistance };

function mockFetch(response: NearestStationResponse) {
  const fetchMock = vi.fn(async () => ({ ok: true, json: async () => response }) as unknown as Response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  localStorage.clear();
  resetNearestStationCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("describeNearestStation", () => {
  it("駅名・徒歩の時間・距離を1行にする", () => {
    expect(describeNearestStation({ name: "長谷駅" }, { durationSeconds: 420, distanceMeters: 600 }, format)).toBe(
      "長谷駅から徒歩7分(600m)",
    );
  });

  it("距離が取れなければ時間だけ", () => {
    expect(describeNearestStation({ name: "長谷駅" }, { durationSeconds: 420 }, format)).toBe("長谷駅から徒歩7分");
  });

  it("徒歩の経路が出せなければ駅名だけ", () => {
    expect(describeNearestStation({ name: "長谷駅" }, undefined, format)).toBe("長谷駅");
  });
});

describe("fetchNearestStation", () => {
  const found: NearestStationResponse = {
    configured: true,
    station: { name: "長谷駅", address: "神奈川県鎌倉市長谷1丁目" },
    walk: { durationSeconds: 420, distanceMeters: 600 },
  };

  it("いちど引いた場所は端末に覚えて、二度と問い合わせない", async () => {
    const fetchMock = mockFetch(found);
    expect(await fetchNearestStation("神奈川県鎌倉市坂ノ下")).toEqual(found);
    // 覚えた分は、画面を開き直しても(その場かぎりの控えを消しても)使われる。
    resetNearestStationCache();
    expect(await fetchNearestStation("神奈川県鎌倉市坂ノ下")).toEqual(found);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(readCache("神奈川県鎌倉市坂ノ下")).toEqual(found);
  });

  it("失敗は覚えない(一時的な失敗を90日持ち続けないため)", async () => {
    mockFetch({ configured: true, error: "429 rate limited" });
    await fetchNearestStation("神奈川県鎌倉市坂ノ下");
    expect(readCache("神奈川県鎌倉市坂ノ下")).toBeUndefined();
  });

  it("キーが用意されていなければ、以降その画面では問い合わせない", async () => {
    const fetchMock = mockFetch({ configured: false });
    expect(await fetchNearestStation("A")).toEqual({ configured: false });
    expect(await fetchNearestStation("B")).toEqual({ configured: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("通信そのものが失敗しても、この機能を畳むだけにする", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    expect(await fetchNearestStation("神奈川県鎌倉市坂ノ下")).toEqual({ configured: false });
  });

  it("住所が空なら問い合わせない", async () => {
    const fetchMock = mockFetch(found);
    expect(await fetchNearestStation("  ")).toEqual({ configured: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
