/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { Sheet } from "./Sheet";

afterEach(cleanup);

/**
 * iOSは、フォーカス中の入力欄が指のスクロールで画面外へ出ると、キーボードの上に
 * 見えるよう勝手にスクロールを戻してしまう。中の.sheet-bodyだけをスクロール
 * させているこのシートでは、それが「下の項目まで指でスクロールできない」不具合
 * になる(2026-09-20の報告)。フォーカスを外へ出したまま(=キーボードが開いたまま)
 * だとiOSが毎回引き戻すので、スクロールが始まった時点でフォーカスを外し、
 * iOS側が引き戻す理由を無くすのが対策(src/components/ui/Sheet.tsx)。
 *
 * 動き始めた先がフォーカス中の欄自身でも区別なく外す — キーボードで見えている
 * 範囲が狭い時は、その欄自体がほぼ画面いっぱいを占め、スクロールの起点が結局
 * その欄の上になることがほとんどだったため(2026-09-20の再報告)。タップ時の
 * わずかな揺れと区別するため、はっきりした距離だけ動いた時だけ外す。
 */
describe("入力シートのスクロール中のフォーカス", () => {
  it("フォーカス中の欄以外を指でなぞり始めたら、フォーカスを外す", () => {
    const { getByTestId } = render(
      <Sheet open onClose={() => {}} title="予定を追加">
        <input data-testid="title-input" />
        <div data-testid="lower-field">下のほうの項目</div>
      </Sheet>,
    );
    const input = getByTestId("title-input") as HTMLInputElement;
    input.focus();
    expect(document.activeElement).toBe(input);

    fireEvent.touchMove(getByTestId("lower-field"));

    expect(document.activeElement).not.toBe(input);
  });

  it("タップ時のわずかな指の揺れでは、フォーカスを外さない", () => {
    const { getByTestId } = render(
      <Sheet open onClose={() => {}} title="予定を追加">
        <input data-testid="title-input" />
        <div data-testid="lower-field">下のほうの項目</div>
      </Sheet>,
    );
    const input = getByTestId("title-input") as HTMLInputElement;
    input.focus();

    fireEvent.touchStart(input, { touches: [{ clientX: 100, clientY: 100 }] });
    fireEvent.touchMove(input, { touches: [{ clientX: 102, clientY: 101 }] });

    expect(document.activeElement).toBe(input);
  });

  it("フォーカス中の欄そのものから指を動かしてスクロールを始めても、フォーカスを外す", () => {
    // キーボードが出て見えている範囲が狭い時は、フォーカス中の欄がほぼ画面いっぱいを
    // 占め、スクロールしようと指を置いた先が結局その欄の上になることがほとんど。
    // そこを起点にした動きも区別なく外さないと、次の項目まで指が届かない
    // (2026-09-20の再報告)。
    const { getByTestId } = render(
      <Sheet open onClose={() => {}} title="予定を追加">
        <input data-testid="title-input" />
        <div data-testid="lower-field">下のほうの項目</div>
      </Sheet>,
    );
    const input = getByTestId("title-input") as HTMLInputElement;
    input.focus();

    fireEvent.touchStart(input, { touches: [{ clientX: 100, clientY: 300 }] });
    fireEvent.touchMove(input, { touches: [{ clientX: 100, clientY: 200 }] });

    expect(document.activeElement).not.toBe(input);
  });

  it("文字を入れる部品にフォーカスが無ければ、何もしない", () => {
    const { getByTestId } = render(
      <Sheet open onClose={() => {}} title="予定を追加">
        <input data-testid="title-input" />
        <div data-testid="lower-field">下のほうの項目</div>
      </Sheet>,
    );
    // どこにもフォーカスしていない状態(bodyがactiveElement)でスクロールしても、
    // 外すフォーカスが無いのでエラーにならず何も起きない。
    expect(() => fireEvent.touchMove(getByTestId("lower-field"))).not.toThrow();
  });
});
