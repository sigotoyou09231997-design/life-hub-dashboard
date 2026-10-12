// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PRESS_IN_MS, TOUCH_DELAY_MS, findPressTarget, installPressFeedback, pressScaleFor } from "./pressFeedback";

interface FakeAnimation {
  keyframes: Keyframe[];
  cancel: ReturnType<typeof vi.fn>;
  playState: string;
}

/** jsdom には Web Animations が無いので、animate を差し替えて呼ばれ方だけ見る。 */
function mockAnimate(el: HTMLElement): FakeAnimation[] {
  const calls: FakeAnimation[] = [];
  (el as unknown as { animate: unknown }).animate = (keyframes: Keyframe[]) => {
    const anim: FakeAnimation = { keyframes, cancel: vi.fn(), playState: "running" };
    calls.push(anim);
    return anim;
  };
  return calls;
}

function pointer(type: string, target: Element, init: { pointerType?: string; x?: number; y?: number; button?: number } = {}) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: init.x ?? 10, clientY: init.y ?? 10, button: init.button ?? 0 });
  Object.defineProperties(event, {
    pointerId: { value: 1 },
    pointerType: { value: init.pointerType ?? "mouse" },
    isPrimary: { value: true },
  });
  target.dispatchEvent(event);
}

describe("pressScaleFor", () => {
  it("小さいボタンは 0.96 まで沈む", () => {
    expect(pressScaleFor(44, 44)).toBe(0.96);
  });

  it("大きいカードほど控えめに沈む（0.985 より浅くはしない）", () => {
    expect(pressScaleFor(390, 120)).toBeCloseTo(1 - 12 / 390, 5);
    expect(pressScaleFor(1200, 200)).toBe(0.985);
  });

  it("CSS で決めた深さ（--press-scale）があれば、それを使う", () => {
    expect(pressScaleFor(56, 56, 0.92)).toBe(0.92);
    expect(pressScaleFor(56, 56, Number.NaN)).toBe(0.96);
  });
});

describe("findPressTarget", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("ボタンの中のアイコンを押しても、ボタンが沈む", () => {
    document.body.innerHTML = '<button class="app-button"><svg class="lucide"></svg></button>';
    const icon = document.querySelector("svg")!;
    expect(findPressTarget(icon)).toBe(document.querySelector("button"));
  });

  it("押せない状態・文字を打つ所・決まっていない部品では沈まない", () => {
    document.body.innerHTML = `
      <button class="app-button" disabled id="off">a</button>
      <div class="card-interactive"><input id="field" /></div>
      <button id="plain">b</button>`;
    expect(findPressTarget(document.getElementById("off"))).toBeNull();
    expect(findPressTarget(document.getElementById("field"))).toBeNull();
    expect(findPressTarget(document.getElementById("plain"))).toBeNull();
  });

  it("中にシートが開いている要素は沈めない（シートがずれるため）", () => {
    document.body.innerHTML = '<div class="card-interactive"><span id="t">x</span><div role="dialog"></div></div>';
    expect(findPressTarget(document.getElementById("t"))).toBeNull();
  });
});

describe("installPressFeedback", () => {
  let uninstall: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    uninstall = installPressFeedback(document);
  });

  afterEach(() => {
    uninstall();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("マウスで押すとすぐ沈み、離すと元の大きさへ戻る", () => {
    document.body.innerHTML = '<button class="app-button">保存</button>';
    const button = document.querySelector("button")!;
    const calls = mockAnimate(button);

    pointer("pointerdown", button);
    expect(calls).toHaveLength(1);
    expect(calls[0].keyframes.at(-1)).toEqual({ scale: "0.96" });
    expect(button.hasAttribute("data-pressed")).toBe(true);

    pointer("pointerup", button);
    expect(calls).toHaveLength(2);
    expect(calls[1].keyframes.at(-1)).toEqual({ scale: "1" });
    expect(calls[0].cancel).toHaveBeenCalled();
    expect(button.hasAttribute("data-pressed")).toBe(false);
  });

  it("指では少し待ってから沈む。待つ間に指が動いたら（スクロール）沈まない", () => {
    document.body.innerHTML = '<a class="warm-card" href="#">カード</a>';
    const card = document.querySelector("a")!;
    const calls = mockAnimate(card);

    pointer("pointerdown", card, { pointerType: "touch", y: 10 });
    pointer("pointermove", card, { pointerType: "touch", y: 40 });
    vi.advanceTimersByTime(TOUCH_DELAY_MS + 10);
    expect(calls).toHaveLength(0);
    expect(card.hasAttribute("data-pressed")).toBe(false);
  });

  it("指で素早く押して離しただけでも、沈んで戻る動きを一続きで見せる", () => {
    document.body.innerHTML = '<button class="lh-chip">メモ</button>';
    const chip = document.querySelector("button")!;
    const calls = mockAnimate(chip);

    pointer("pointerdown", chip, { pointerType: "touch" });
    pointer("pointerup", chip, { pointerType: "touch" });
    expect(calls).toHaveLength(1);
    expect(calls[0].keyframes.map((k) => k.scale)).toEqual(["1", "0.96", "1"]);
    vi.advanceTimersByTime(PRESS_IN_MS);
    expect(chip.hasAttribute("data-pressed")).toBe(false);
  });

  it("指で押したままなら、待ったあと沈む", () => {
    document.body.innerHTML = '<button class="segmented__option">終日</button>';
    const option = document.querySelector("button")!;
    const calls = mockAnimate(option);

    pointer("pointerdown", option, { pointerType: "touch" });
    expect(calls).toHaveLength(0);
    vi.advanceTimersByTime(TOUCH_DELAY_MS);
    expect(calls).toHaveLength(1);
    expect(option.hasAttribute("data-pressed")).toBe(true);
  });

  it("動きを減らす設定では何もしない", () => {
    uninstall();
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce"), media: query }));
    uninstall = installPressFeedback(document);
    document.body.innerHTML = '<button class="app-button">保存</button>';
    const button = document.querySelector("button")!;
    const calls = mockAnimate(button);

    pointer("pointerdown", button);
    pointer("pointerup", button);
    expect(calls).toHaveLength(0);
    expect(button.hasAttribute("data-pressed")).toBe(false);
  });

  it("右クリックでは沈まない", () => {
    document.body.innerHTML = '<button class="app-button">保存</button>';
    const button = document.querySelector("button")!;
    const calls = mockAnimate(button);

    pointer("pointerdown", button, { button: 2 });
    expect(calls).toHaveLength(0);
  });
});
