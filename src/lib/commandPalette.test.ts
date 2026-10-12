/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import {
  PALETTE_ACTIONS,
  isApplePlatform,
  isPaletteShortcut,
  isTypingTarget,
  matchActions,
  normalizeForMatch,
  paletteShortcutLabel,
  pinnedActions,
} from "./commandPalette";

const labels = (query: string) => matchActions(query).map((action) => action.label);

describe("よく使う操作", () => {
  it("何も打っていない時に出す操作に、追加の4つとサブスクが入っている", () => {
    const pinned = pinnedActions().map((action) => action.label);
    expect(pinned).toEqual(expect.arrayContaining(["支出を追加", "予定を追加", "タスクを追加", "メモを書く", "サブスクを見る"]));
  });

  // 行き先は各画面がすでに受けている印。ここが変わると、近道(vite.config.ts)や
  // ホームの「＋」と行き先が食い違うので、値そのものを確かめておく。
  it("追加の操作は、各画面の ?new= の印へ飛ぶ", () => {
    const to = Object.fromEntries(PALETTE_ACTIONS.map((action) => [action.label, action.to]));
    expect(to["支出を追加"]).toBe("/records/expense?new=expense");
    expect(to["予定を追加"]).toBe("/schedule?new=event");
    expect(to["タスクを追加"]).toBe("/schedule?new=task");
    expect(to["メモを書く"]).toBe("/records/notes?new=note");
    expect(to["サブスクを見る"]).toBe("/records/expense?tab=subs");
  });

  it("操作のidは重ならない(画面に並べる時のキーになる)", () => {
    const ids = PALETTE_ACTIONS.map((action) => action.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("matchActions", () => {
  it("「支出」で支出を追加がいちばん上に来る", () => {
    expect(labels("支出")[0]).toBe("支出を追加");
  });

  it("名前に無くても、言い換えで当たる(固定費 → サブスク)", () => {
    expect(labels("固定費")).toContain("サブスクを見る");
  });

  it("名前の頭から合うものを、途中で合うものより上に出す", () => {
    // 「予定を追加」は頭から、「カレンダーを見る」は言い換え(予定)で当たる。
    const result = labels("予定");
    expect(result.indexOf("予定を追加")).toBeLessThan(result.indexOf("カレンダーを見る"));
  });

  it("ひらがなでもカタカナの名前に当たる", () => {
    expect(labels("めも")).toContain("メモを書く");
    expect(labels("さぶすく")).toContain("サブスクを見る");
  });

  it("全角の英字・大文字でも当たる", () => {
    expect(labels("ＧＭＡＩＬ")).toContain("Gmailを開く");
  });

  it("空白で区切った語は、すべて含むものだけ", () => {
    expect(labels("予定 追加")).toEqual(["予定を追加"]);
  });

  it("空の語・どれにも合わない語では何も返さない", () => {
    expect(matchActions("")).toEqual([]);
    expect(matchActions("   ")).toEqual([]);
    expect(matchActions("青葉デンタル")).toEqual([]);
  });

  it("出す数に上限がある(データの当たりを下へ押し出さないように)", () => {
    expect(matchActions("を", PALETTE_ACTIONS, 3)).toHaveLength(3);
  });
});

describe("normalizeForMatch", () => {
  it("カタカナはひらがな、全角英数は半角の小文字にそろえる", () => {
    expect(normalizeForMatch("メモＡ１")).toBe("めもa1");
  });
});

function key(overrides: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    key: "k",
    code: "KeyK",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    isComposing: false,
    ...overrides,
  } as KeyboardEvent;
}

describe("isPaletteShortcut", () => {
  // この Mac は Karabiner で Command と Control を入れ替えているので、両方で開く。
  it("⌘K と Ctrl+K の両方で開く", () => {
    expect(isPaletteShortcut(key({ metaKey: true }))).toBe(true);
    expect(isPaletteShortcut(key({ ctrlKey: true }))).toBe(true);
  });

  it("K だけ・ほかの修飾キー付き・変換中は開かない", () => {
    expect(isPaletteShortcut(key({}))).toBe(false);
    expect(isPaletteShortcut(key({ metaKey: true, shiftKey: true }))).toBe(false);
    expect(isPaletteShortcut(key({ ctrlKey: true, altKey: true }))).toBe(false);
    expect(isPaletteShortcut(key({ metaKey: true, isComposing: true }))).toBe(false);
    expect(isPaletteShortcut(key({ metaKey: true, key: "j", code: "KeyJ" }))).toBe(false);
  });

  it("大文字の K(Caps Lock)でも、キーの位置が K なら開く", () => {
    expect(isPaletteShortcut(key({ metaKey: true, key: "K" }))).toBe(true);
    expect(isPaletteShortcut(key({ ctrlKey: true, key: "Unidentified", code: "KeyK" }))).toBe(true);
  });
});

describe("isTypingTarget", () => {
  it("文字を打つ欄は横取りしない", () => {
    expect(isTypingTarget(document.createElement("textarea"))).toBe(true);
    expect(isTypingTarget(document.createElement("input"))).toBe(true);
    const search = document.createElement("input");
    search.type = "search";
    expect(isTypingTarget(search)).toBe(true);
  });

  it("書き込める領域の中も、文字を打つ場所として扱う", () => {
    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    const inner = document.createElement("span");
    editor.appendChild(inner);
    expect(isTypingTarget(inner)).toBe(true);
  });

  it("ボタン・チェックボックス・ページ全体では開いてよい", () => {
    expect(isTypingTarget(document.createElement("button"))).toBe(false);
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    expect(isTypingTarget(checkbox)).toBe(false);
    expect(isTypingTarget(document.body)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe("キーの書き方", () => {
  it("Mac・iPhone・iPad では ⌘K、それ以外は Ctrl+K", () => {
    expect(paletteShortcutLabel({ platform: "MacIntel" })).toBe("⌘K");
    expect(paletteShortcutLabel({ userAgentData: { platform: "macOS" } })).toBe("⌘K");
    expect(paletteShortcutLabel({ platform: "iPad" })).toBe("⌘K");
    expect(paletteShortcutLabel({ platform: "Win32" })).toBe("Ctrl+K");
    expect(paletteShortcutLabel({ platform: "Linux x86_64" })).toBe("Ctrl+K");
  });

  it("手がかりが何も無ければ Mac ではない扱い", () => {
    expect(isApplePlatform({})).toBe(false);
  });
});
