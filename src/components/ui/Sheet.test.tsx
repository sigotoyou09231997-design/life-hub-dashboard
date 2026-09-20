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

  it("フォーカス中の欄そのものを指でなぞっても(文字選択など)、フォーカスは外さない", () => {
    const { getByTestId } = render(
      <Sheet open onClose={() => {}} title="予定を追加">
        <input data-testid="title-input" />
        <div data-testid="lower-field">下のほうの項目</div>
      </Sheet>,
    );
    const input = getByTestId("title-input") as HTMLInputElement;
    input.focus();

    fireEvent.touchMove(input);

    expect(document.activeElement).toBe(input);
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
