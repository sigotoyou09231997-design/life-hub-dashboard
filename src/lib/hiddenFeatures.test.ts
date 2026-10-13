// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  featureForPath,
  getHiddenFeaturesSnapshot,
  hasStoredHiddenFeatures,
  isPathHidden,
  loadHiddenFeatures,
  normalizeHiddenFeatures,
  saveHiddenFeatures,
  setFeatureHidden,
  subscribeHiddenFeatures,
} from "./hiddenFeatures";

beforeEach(() => localStorage.clear());

describe("featureForPath(どの機能の画面か)", () => {
  it("機能の画面は、その機能を返す。サブページ・検索条件つきも同じ", () => {
    expect(featureForPath("/schedule")).toBe("schedule");
    expect(featureForPath("/schedule?view=calendar")).toBe("schedule");
    expect(featureForPath("/records/expense?new=salary")).toBe("money");
    expect(featureForPath("/records/notes")).toBe("notes");
    expect(featureForPath("/gmail")).toBe("gmail");
    expect(featureForPath("/gmail/mail/abc")).toBe("gmail");
    expect(featureForPath("/trips/123?tab=route")).toBe("trips");
    expect(featureForPath("/review")).toBe("review");
  });

  it("ホーム・設定・アカウントなど、隠せない画面と、似た名前の別の道のりは null", () => {
    expect(featureForPath("/")).toBeNull();
    expect(featureForPath("/settings")).toBeNull();
    expect(featureForPath("/account")).toBeNull();
    expect(featureForPath("/changelog")).toBeNull();
    expect(featureForPath("/trips-archive")).toBeNull();
    expect(featureForPath("/records/expenses")).toBeNull();
  });
});

describe("isPathHidden", () => {
  it("隠している機能の画面だけ true。ホーム・設定は、何を隠しても false", () => {
    const hidden = ["gmail", "trips"] as const;
    expect(isPathHidden("/gmail", hidden)).toBe(true);
    expect(isPathHidden("/trips/1", hidden)).toBe(true);
    expect(isPathHidden("/schedule", hidden)).toBe(false);
    expect(isPathHidden("/", ["schedule", "money", "notes", "gmail", "trips", "review"])).toBe(false);
    expect(isPathHidden("/settings", ["schedule", "money", "notes", "gmail", "trips", "review"])).toBe(false);
  });
});

describe("覚える内容", () => {
  it("知らない名前・重なり・文字でないものは除き、決まった順に並べる", () => {
    expect(normalizeHiddenFeatures(["trips", "gmail", "gmail", "nothing", 3, null, "schedule"])).toEqual(["schedule", "gmail", "trips"]);
    expect(normalizeHiddenFeatures("gmail")).toEqual([]);
    expect(normalizeHiddenFeatures(undefined)).toEqual([]);
  });

  it("何も覚えていない時は、何も隠さない。覚えたら読み戻せる。壊れた記録は何も隠さない", () => {
    expect(loadHiddenFeatures()).toEqual([]);
    expect(hasStoredHiddenFeatures()).toBe(false);
    saveHiddenFeatures(["notes", "gmail"]);
    expect(loadHiddenFeatures()).toEqual(["notes", "gmail"]);
    expect(hasStoredHiddenFeatures()).toBe(true);
    localStorage.setItem("lifeHubHiddenFeatures:v1", "{壊れた");
    expect(loadHiddenFeatures()).toEqual([]);
  });

  it("全部戻した(空)も、覚えた設定の1つ", () => {
    saveHiddenFeatures(["gmail"]);
    saveHiddenFeatures([]);
    expect(loadHiddenFeatures()).toEqual([]);
    expect(hasStoredHiddenFeatures()).toBe(true);
  });

  it("1つずつ隠す・出す。ほかの機能の設定は変えない", () => {
    expect(setFeatureHidden("gmail", true)).toEqual(["gmail"]);
    expect(setFeatureHidden("trips", true)).toEqual(["gmail", "trips"]);
    expect(setFeatureHidden("gmail", false)).toEqual(["trips"]);
    expect(setFeatureHidden("gmail", false)).toEqual(["trips"]);
  });
});

describe("画面への知らせ", () => {
  it("変えると、見ている画面に知らせる。同じ内容の間は、同じ配列を返す(描き直しを繰り返さない)", () => {
    let calls = 0;
    const stop = subscribeHiddenFeatures(() => (calls += 1));
    const first = getHiddenFeaturesSnapshot();
    expect(getHiddenFeaturesSnapshot()).toBe(first);
    setFeatureHidden("review", true);
    expect(calls).toBe(1);
    const second = getHiddenFeaturesSnapshot();
    expect(second).toEqual(["review"]);
    expect(second).not.toBe(first);
    expect(getHiddenFeaturesSnapshot()).toBe(second);
    stop();
    setFeatureHidden("review", false);
    expect(calls).toBe(1);
  });
});
