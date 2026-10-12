import { afterEach, describe, expect, it } from "vitest";
import {
  claimGesture,
  decidePullIntent,
  decideSwipeIntent,
  isPastSwipeThreshold,
  PULL_MAX_PX,
  PULL_THRESHOLD_PX,
  pullDistance,
  releaseGesture,
  releaseVelocity,
  startsAtScreenEdge,
  SWIPE_DEAD_SIDE_MAX_PX,
  swipeOffset,
  swipeOutcome,
} from "./gestures";

describe("払う向きの見分け(decideSwipeIntent)", () => {
  it("10px 動くまでは決めない(押しただけ・指のぶれ)", () => {
    expect(decideSwipeIntent(0, 0)).toBe("pending");
    expect(decideSwipeIntent(9, -9)).toBe("pending");
  });

  it("横の動きが縦より大きければ払い、そうでなければスクロール", () => {
    expect(decideSwipeIntent(12, 3)).toBe("horizontal");
    expect(decideSwipeIntent(-12, 3)).toBe("horizontal");
    expect(decideSwipeIntent(3, 12)).toBe("vertical");
    // 斜め45度はスクロールに任せる(横がはっきり大きい時だけ払いにする)。
    expect(decideSwipeIntent(12, 12)).toBe("vertical");
  });
});

describe("画面の左端(iPhone の「戻る」)", () => {
  it("左端 16px から触り始めた指は使わない", () => {
    expect(startsAtScreenEdge(0)).toBe(true);
    expect(startsAtScreenEdge(15)).toBe(true);
    expect(startsAtScreenEdge(16)).toBe(false);
    expect(startsAtScreenEdge(200)).toBe(false);
  });
});

describe("行の動かし方(swipeOffset)", () => {
  it("操作がある向きは指にそのまま付いていく", () => {
    expect(swipeOffset(120, { left: false, right: true })).toBe(120);
    expect(swipeOffset(-120, { left: true, right: false })).toBe(-120);
  });

  it("操作が無い向きは少しだけ動いて止まる", () => {
    expect(swipeOffset(-50, { left: false, right: true })).toBe(-10);
    expect(swipeOffset(-500, { left: false, right: true })).toBe(-SWIPE_DEAD_SIDE_MAX_PX);
    expect(swipeOffset(500, { left: true, right: false })).toBe(SWIPE_DEAD_SIDE_MAX_PX);
  });
});

describe("離した時に決めるか(swipeOutcome)", () => {
  const base = { width: 300, velocity: 0, left: true, right: true };

  it("行の幅の 38% を越えていれば決める", () => {
    expect(swipeOutcome({ ...base, offset: 114 })).toBe("right");
    expect(swipeOutcome({ ...base, offset: -114 })).toBe("left");
    expect(isPastSwipeThreshold(114, 300)).toBe(true);
  });

  it("手前で離したら決めない(元に戻す)", () => {
    expect(swipeOutcome({ ...base, offset: 100 })).toBeNull();
    expect(isPastSwipeThreshold(100, 300)).toBe(false);
  });

  it("速く払えば、短くても決める", () => {
    expect(swipeOutcome({ ...base, offset: -60, velocity: -0.8 })).toBe("left");
  });

  it("引き戻しながら離した時は、速くても決めない", () => {
    expect(swipeOutcome({ ...base, offset: -60, velocity: 0.8 })).toBeNull();
  });

  it("フリックでも短すぎる動きでは決めない", () => {
    expect(swipeOutcome({ ...base, offset: -20, velocity: -2 })).toBeNull();
  });

  it("操作が割り当たっていない向きは決めない", () => {
    expect(swipeOutcome({ ...base, right: false, offset: 280 })).toBeNull();
    expect(swipeOutcome({ ...base, left: false, offset: -280, velocity: -3 })).toBeNull();
  });

  it("行の幅が測れなかった時は、スマホの1行ぶん(320px)とみなす", () => {
    expect(swipeOutcome({ ...base, width: 0, offset: 130 })).toBe("right");
    expect(swipeOutcome({ ...base, width: 0, offset: 100 })).toBeNull();
  });
});

describe("離す直前の速さ(releaseVelocity)", () => {
  it("直近 100ms の動きで測る", () => {
    const samples = [
      { x: 0, t: 0 },
      { x: 10, t: 190 },
      { x: 40, t: 260 },
      { x: 70, t: 300 },
    ];
    // 190ms の点は離す 100ms より前なので使わず、260ms からの 30px / 40ms。
    expect(releaseVelocity(samples)).toBeCloseTo(30 / 40);
  });

  it("点が足りなければ 0", () => {
    expect(releaseVelocity([{ x: 5, t: 0 }])).toBe(0);
  });
});

describe("引っ張って更新", () => {
  it("一番上で下へ引いた時だけ引っ張りにする", () => {
    expect(decidePullIntent(0, 5)).toBe("pending");
    expect(decidePullIntent(2, 14)).toBe("pull");
    // 上へのスクロール・横の払いには手を出さない。
    expect(decidePullIntent(0, -14)).toBe("ignore");
    expect(decidePullIntent(14, 4)).toBe("ignore");
  });

  it("引くほど重くなり、上限で止まる", () => {
    expect(pullDistance(-20)).toBe(0);
    expect(pullDistance(40)).toBe(20);
    expect(pullDistance(1000)).toBe(PULL_MAX_PX);
    // 同期する所までは、指でおよそ 128px。
    expect(pullDistance(127)).toBeLessThan(PULL_THRESHOLD_PX);
    expect(pullDistance(128)).toBeGreaterThanOrEqual(PULL_THRESHOLD_PX);
  });
});

describe("同じ指の取り合い(claimGesture)", () => {
  afterEach(() => {
    releaseGesture("swipe");
    releaseGesture("pull");
  });

  it("行の払いが受け持っている間は、引っ張りを始めない", () => {
    expect(claimGesture("swipe", 1000)).toBe(true);
    expect(claimGesture("pull", 1100)).toBe(false);
    releaseGesture("swipe");
    expect(claimGesture("pull", 1200)).toBe(true);
  });

  it("返されないまま残った札は、しばらくたてば捨てる", () => {
    expect(claimGesture("pull", 0)).toBe(true);
    expect(claimGesture("swipe", 1000)).toBe(false);
    expect(claimGesture("swipe", 5000)).toBe(true);
  });
});
