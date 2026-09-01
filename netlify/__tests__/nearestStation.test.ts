import { describe, expect, it } from "vitest";
import { parseLatLng, readNearestStation, readPlaceLocation, readWalk } from "../functions/nearestStation";
import {
  parseLatLng as vercelParseLatLng,
  readNearestStation as vercelReadNearestStation,
  readPlaceLocation as vercelReadPlaceLocation,
  readWalk as vercelReadWalk,
} from "../../api/nearestStation";

const nearbyResponse = {
  places: [
    {
      displayName: { text: "長谷駅" },
      formattedAddress: "神奈川県鎌倉市長谷1丁目",
      location: { latitude: 35.3125, longitude: 139.5333 },
    },
  ],
};

describe("readPlaceLocation", () => {
  it("住所から座標を取り出す", () => {
    expect(readPlaceLocation({ places: [{ location: { latitude: 35.31, longitude: 139.53 } }] })).toEqual({
      latitude: 35.31,
      longitude: 139.53,
    });
  });

  it("見つからなければ undefined(駅の行を出さないだけにする)", () => {
    expect(readPlaceLocation({ places: [] })).toBeUndefined();
    expect(readPlaceLocation({})).toBeUndefined();
    expect(readPlaceLocation({ places: [{ location: { latitude: "35.31" } }] })).toBeUndefined();
  });
});

describe("readNearestStation", () => {
  it("いちばん近い駅の名前と住所を取り出す", () => {
    expect(readNearestStation(nearbyResponse)).toEqual({
      name: "長谷駅",
      address: "神奈川県鎌倉市長谷1丁目",
      location: { latitude: 35.3125, longitude: 139.5333 },
    });
  });

  it("名前が無ければ駅として扱わない", () => {
    expect(readNearestStation({ places: [{ formattedAddress: "どこか" }] })).toBeUndefined();
  });

  it("範囲内に駅が無ければ undefined", () => {
    expect(readNearestStation({ places: [] })).toBeUndefined();
  });
});

describe("readWalk", () => {
  it("徒歩の所要時間と距離を取り出す", () => {
    expect(readWalk({ routes: [{ duration: "420s", distanceMeters: 600 }] })).toEqual({
      durationSeconds: 420,
      distanceMeters: 600,
    });
  });

  it("経路が返らなければ undefined(駅名だけ出す)", () => {
    expect(readWalk({ routes: [] })).toBeUndefined();
  });
});

describe("parseLatLng", () => {
  it("座標で入っている場所は、そのまま座標として扱う", () => {
    expect(parseLatLng("35.681236,139.767125")).toEqual({ latitude: 35.681236, longitude: 139.767125 });
  });

  it("住所や施設名は座標ではない", () => {
    expect(parseLatLng("神奈川県鎌倉市坂ノ下")).toBeUndefined();
  });
});

describe("NetlifyとVercelの2つの写しが同じ結果を返す", () => {
  // 判断のロジックは両方に写してあるので(配信先が2つあるため)、片方だけ直して
  // 食い違うことが無いようここで突き合わせる。
  it("同じ入力に同じ結果", () => {
    expect(vercelReadPlaceLocation({ places: [{ location: { latitude: 35.31, longitude: 139.53 } }] })).toEqual(
      readPlaceLocation({ places: [{ location: { latitude: 35.31, longitude: 139.53 } }] }),
    );
    expect(vercelReadNearestStation(nearbyResponse)).toEqual(readNearestStation(nearbyResponse));
    expect(vercelReadWalk({ routes: [{ duration: "420s", distanceMeters: 600 }] })).toEqual(
      readWalk({ routes: [{ duration: "420s", distanceMeters: 600 }] }),
    );
    expect(vercelParseLatLng("35.68,139.76")).toEqual(parseLatLng("35.68,139.76"));
  });
});
