// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refreshViewportGap, trackViewportGap, VIEWPORT_GAP_SETTLE_MS } from "./viewport";

/** visualViewport の代わり。高さと位置を書き換えて、iOSが流してくる scroll を真似る。 */
function installFakeViewport(height: number) {
  const target = new EventTarget();
  const fake = Object.assign(target, { height, offsetTop: 0 });
  Object.defineProperty(window, "visualViewport", { value: fake, configurable: true, writable: true });
  return fake;
}

function gapNow(): string {
  return document.documentElement.style.getPropertyValue("--viewport-gap");
}

describe("trackViewportGap", () => {
  let stop: () => void = () => {};

  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true, writable: true });
    document.documentElement.style.removeProperty("--viewport-gap");
  });

  afterEach(() => {
    stop();
    vi.useRealTimers();
  });

  it("スクロールしている最中の値は書き込まない(追従ボタンが指の動きに合わせてずれない)", () => {
    const visual = installFakeViewport(800);
    stop = trackViewportGap();
    expect(gapNow()).toBe("0px");

    // 端で引っぱった時のように、途中経過だけ大きな差が流れてくる。
    visual.height = 900;
    visual.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(VIEWPORT_GAP_SETTLE_MS - 1);
    expect(gapNow()).toBe("0px");

    // 指を離すと元に戻る。落ち着いてから測るので、ずれは一度も書かれない。
    visual.height = 800;
    visual.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(VIEWPORT_GAP_SETTLE_MS);
    expect(gapNow()).toBe("0px");
  });

  it("動きが止まっても残っている差は書き込む(キーボードを閉じた後の位置直しは効いたまま)", () => {
    const visual = installFakeViewport(800);
    stop = trackViewportGap();

    visual.height = 900;
    visual.dispatchEvent(new Event("resize"));
    vi.advanceTimersByTime(VIEWPORT_GAP_SETTLE_MS);
    expect(gapNow()).toBe("100px");
  });

  it("画面を切り替えた時など、何の知らせも来ない場面でも測り直せる", () => {
    // iOSは、キーボードが出ている入力欄が画面ごと消えると focusout を出さないことが
    // あり、画面の高さがキーボードぶん短いまま残る。visualViewport 側の知らせも来ない
    // ので、そのままだと追従ナビと追加ボタンが画面の途中に貼りついたままになる。
    installFakeViewport(800);
    stop = trackViewportGap();
    expect(gapNow()).toBe("0px");

    // 知らせが1つも来ないまま、レイアウト上の画面だけが短いまま残っている状態。
    Object.defineProperty(window, "innerHeight", { value: 460, configurable: true, writable: true });
    vi.advanceTimersByTime(VIEWPORT_GAP_SETTLE_MS * 2);
    expect(gapNow()).toBe("0px");

    refreshViewportGap();
    vi.advanceTimersByTime(VIEWPORT_GAP_SETTLE_MS);
    expect(gapNow()).toBe("340px");
  });

  it("画面を触った時にも測り直す（切り替え以外で起きた時の受け皿）", () => {
    installFakeViewport(800);
    stop = trackViewportGap();

    Object.defineProperty(window, "innerHeight", { value: 500, configurable: true, writable: true });
    document.dispatchEvent(new Event("pointerup"));
    vi.advanceTimersByTime(VIEWPORT_GAP_SETTLE_MS);
    expect(gapNow()).toBe("300px");
  });

  it("後始末のあとは、待っていた分も書き込まない", () => {
    const visual = installFakeViewport(800);
    const cleanup = trackViewportGap();
    stop = () => {};

    visual.height = 900;
    visual.dispatchEvent(new Event("scroll"));
    cleanup();
    refreshViewportGap();
    vi.advanceTimersByTime(VIEWPORT_GAP_SETTLE_MS * 4);
    expect(gapNow()).toBe("0px");
  });
});
