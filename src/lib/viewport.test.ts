import { describe, expect, it } from "vitest";
import {
  KEYBOARD_INSET_THRESHOLD_PX,
  VIEWPORT_GAP_THRESHOLD_PX,
  keyboardInsetFrom,
  opensKeyboard,
  staleViewportGap,
  sheetMaxHeightPx,
  SHEET_EDGE_GAP_PX,
} from "./viewport";

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

describe("staleViewportGap", () => {
  it("画面の高さが戻っていれば0(普段は何も動かさない)", () => {
    expect(staleViewportGap(844, 844, 0)).toBe(0);
  });

  it("レイアウト上の画面が実際より短いままなら、その差を返す", () => {
    // iOSがキーボードを閉じた後に高さを戻し損ねた状態。追従ボタンが画面の途中に
    // 貼りついたままになるので、この差だけ下へずらす。
    expect(staleViewportGap(508, 844, 0)).toBe(336);
  });

  it("キーボードが出ている間(見えている方が小さい)は0", () => {
    // その場合の持ち上げは keyboardInsetFrom の担当。
    expect(staleViewportGap(844, 508, 0)).toBe(0);
  });

  it("小さい差は0にする(追従ボタンが揺れないように)", () => {
    expect(staleViewportGap(844, 844 + VIEWPORT_GAP_THRESHOLD_PX - 1, 0)).toBe(0);
  });
});

describe("sheetMaxHeightPx", () => {
  it("見えている高さが分からなければ、CSSの既定に任せる", () => {
    expect(sheetMaxHeightPx(null, 0, false)).toBeNull();
  });

  it("キーボードが出ている間は、見えている高さに収める", () => {
    // iOSが見えている領域を120px下へずらした状態(visualViewport.offsetTop=120)。
    // レイアウト上の780から「キーボードのぶん280」を引いた500に合わせると、その
    // 120pxぶん器の上側が画面の外に出て、見出しと最初の入力欄に手が届かなくなる。
    expect(sheetMaxHeightPx(380, 280, false)).toBe(380 - SHEET_EDGE_GAP_PX);
  });

  it("キーボードが出ていなければ、これまで通り画面の88%まで", () => {
    expect(sheetMaxHeightPx(844, 0, false)).toBe(743);
    expect(sheetMaxHeightPx(844, 0, true)).toBe(464);
  });

  it("画面がとても低い時も、端の隙間より大きくはしない", () => {
    expect(sheetMaxHeightPx(200, 0, false)).toBe(176);
    expect(sheetMaxHeightPx(4, 300, false)).toBe(0);
  });
});
