import { describe, expect, it } from "vitest";
import { KEYBOARD_INSET_THRESHOLD_PX, keyboardInsetFrom, opensKeyboard } from "./viewport";

describe("keyboardInsetFrom", () => {
  it("キーボードが出ていなければ0", () => {
    expect(keyboardInsetFrom(844, 844, 0)).toBe(0);
  });

  it("キーボードで隠れている高さを返す", () => {
    // iPhoneの日本語キーボード(約336px)が出た状態
    expect(keyboardInsetFrom(844, 508, 0)).toBe(336);
  });

  it("見えている領域が上へずれた分も隠れている扱いにする", () => {
    expect(keyboardInsetFrom(844, 508, 40)).toBe(296);
  });

  it("ツールバーの出入り程度の小さい差は0にする(シートが数十px浮かないように)", () => {
    expect(keyboardInsetFrom(844, 844 - (KEYBOARD_INSET_THRESHOLD_PX - 1), 0)).toBe(0);
  });

  it("見えている領域の方が大きい場合(拡大時など)も0", () => {
    expect(keyboardInsetFrom(844, 900, 0)).toBe(0);
  });
});

describe("opensKeyboard", () => {
  it("文字を入れる部品ならキーボードが出ているとみなす", () => {
    expect(opensKeyboard({ tagName: "INPUT" })).toBe(true);
    expect(opensKeyboard({ tagName: "TEXTAREA" })).toBe(true);
    // iOSの選択ホイールも同じように画面を狭める。
    expect(opensKeyboard({ tagName: "SELECT" })).toBe(true);
    expect(opensKeyboard({ tagName: "DIV", isContentEditable: true })).toBe(true);
  });

  it("ボタンや何も選ばれていない時は出ていないとみなす", () => {
    // 閉じるボタンに focus がある状態で浮いたままにならないように。
    expect(opensKeyboard({ tagName: "BUTTON" })).toBe(false);
    expect(opensKeyboard({ tagName: "DIV" })).toBe(false);
    expect(opensKeyboard(null)).toBe(false);
  });
});
