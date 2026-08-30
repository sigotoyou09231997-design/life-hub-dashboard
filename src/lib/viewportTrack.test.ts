// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { trackViewportGap, VIEWPORT_GAP_SETTLE_MS } from "./viewport";

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

  it("後始末のあとは、待っていた分も書き込まない", () => {
    const visual = installFakeViewport(800);
    const cleanup = trackViewportGap();
    stop = () => {};

    visual.height = 900;
    visual.dispatchEvent(new Event("scroll"));
    cleanup();
    vi.advanceTimersByTime(VIEWPORT_GAP_SETTLE_MS * 4);
    expect(gapNow()).toBe("0px");
  });
});
