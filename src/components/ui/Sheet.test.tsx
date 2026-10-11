/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { Sheet, revealAboveActions } from "./Sheet";

afterEach(cleanup);

/** visualViewport の代わり(src/lib/viewportTrack.test.tsと同じやり方)。 */
function installFakeViewport(height: number) {
  const target = new EventTarget();
  const fake = Object.assign(target, { height, offsetTop: 0 });
  Object.defineProperty(window, "visualViewport", { value: fake, configurable: true, writable: true });
  return fake;
}

/**
 * iOSは、フォーカス中の入力欄が指のスクロールで画面外へ出ると、キーボードの上に
 * 見えるよう勝手にスクロールを戻してしまう。中の.sheet-bodyだけをスクロール
 * させているこのシートでは、それが「下の項目まで指でスクロールできない」不具合
 * になる(2026-09-20の報告、複数回)。フォーカスを外へ出したまま(=キーボードが
 * 開いたまま)だとiOSが毎回引き戻すので、iOS側が引き戻す理由を無くすのが対策
 * (src/components/ui/Sheet.tsx)。
 *
 * 最初はtouchmove(指が動いた時点)でフォーカスを外していたが、それでも直らな
 * かった。iOS側の引き戻しはtouchmoveより前、触れた瞬間(touchstart)から始まって
 * いる可能性があるため、touchstartの時点で、動きの向き・距離を見ずに即フォーカスを
 * 外す。指を置いた先がフォーカス中の欄自身でも区別しない — キーボードで見えている
 * 範囲が狭い時は、その欄自体がほぼ画面いっぱいを占め、指を置く先が結局その欄の上に
 * なることがほとんどのため。
 *
 * ただし、文字を選択中(コピーしようとして選択ハンドルをドラッグしている等)は外さ
 * ない。無条件に外すと、選択ハンドルへのタップ・ドラッグのたびに選択が消えて
 * コピーできなくなってしまっていた(2026-09-20の報告、「文字をコピーできない」)。
 */
describe("入力シートのタップ時のフォーカス", () => {
  it("フォーカス中の欄以外に指が触れたら、フォーカスを外す", () => {
    const { getByTestId } = render(
      <Sheet open onClose={() => {}} title="予定を追加">
        <input data-testid="title-input" />
        <div data-testid="lower-field">下のほうの項目</div>
      </Sheet>,
    );
    const input = getByTestId("title-input") as HTMLInputElement;
    input.focus();
    expect(document.activeElement).toBe(input);

    fireEvent.touchStart(getByTestId("lower-field"));

    expect(document.activeElement).not.toBe(input);
  });

  it("フォーカス中の欄そのものに指が触れても、区別せずフォーカスを外す", () => {
    // キーボードが出て見えている範囲が狭い時は、フォーカス中の欄がほぼ画面いっぱいを
    // 占め、指を置く先が結局その欄の上になることがほとんど。そこへの接触も区別なく
    // 外さないと、次の項目まで指が届かない(2026-09-20の複数回の再報告)。
    const { getByTestId } = render(
      <Sheet open onClose={() => {}} title="予定を追加">
        <input data-testid="title-input" />
      </Sheet>,
    );
    const input = getByTestId("title-input") as HTMLInputElement;
    input.focus();

    fireEvent.touchStart(input);

    expect(document.activeElement).not.toBe(input);
  });

  it("文字を選択中の欄に指が触れても、フォーカスを外さない(コピーできなくなるため)", () => {
    const { getByTestId } = render(
      <Sheet open onClose={() => {}} title="予定を編集">
        <input data-testid="title-input" defaultValue="MASTER key 面接" />
      </Sheet>,
    );
    const input = getByTestId("title-input") as HTMLInputElement;
    input.focus();
    // 「MASTER」の部分を選択した状態(選択ハンドルをドラッグしてコピーしようとしている場面)。
    input.setSelectionRange(0, 6);

    fireEvent.touchStart(input);

    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(6);
  });

  it("選択が無い(ただのカーソル)欄なら、これまでどおりフォーカスを外す", () => {
    const { getByTestId } = render(
      <Sheet open onClose={() => {}} title="予定を編集">
        <input data-testid="title-input" defaultValue="MASTER key 面接" />
      </Sheet>,
    );
    const input = getByTestId("title-input") as HTMLInputElement;
    input.focus();
    input.setSelectionRange(3, 3); // 選択なし、カーソルだけ

    fireEvent.touchStart(input);

    expect(document.activeElement).not.toBe(input);
  });

  it("文字を入れる部品にフォーカスが無ければ、何もしない", () => {
    const { getByTestId } = render(
      <Sheet open onClose={() => {}} title="予定を追加">
        <input data-testid="title-input" />
        <div data-testid="lower-field">下のほうの項目</div>
      </Sheet>,
    );
    // どこにもフォーカスしていない状態(bodyがactiveElement)で触れても、
    // 外すフォーカスが無いのでエラーにならず何も起きない。
    expect(() => fireEvent.touchStart(getByTestId("lower-field"))).not.toThrow();
  });
});

/**
 * body だけを止めても、iOS は body と html をまとめて1つのスクロール領域として
 * 扱うため、シートの裏でページ自体がスクロールできてしまうことがある
 * (WebKitの既知の挙動)。html も一緒に止める(src/components/ui/Sheet.tsx)。
 */
describe("入力シートが開いている間のページの動き", () => {
  it("開いている間はhtml・bodyどちらもスクロールを止め、閉じたら戻す", () => {
    document.documentElement.style.overflow = "";
    document.body.style.overflow = "";

    const { rerender } = render(
      <Sheet open onClose={() => {}} title="予定を追加">
        <input />
      </Sheet>,
    );
    expect(document.documentElement.style.overflow).toBe("hidden");
    expect(document.body.style.overflow).toBe("hidden");

    rerender(
      <Sheet open={false} onClose={() => {}} title="予定を追加">
        <input />
      </Sheet>,
    );
    expect(document.documentElement.style.overflow).toBe("");
    expect(document.body.style.overflow).toBe("");
  });
});

/**
 * キーボードが出ると器(.sheet-panel)の高さが縮み、.sheet-bodyの見えている範囲の
 * 下端がそのぶん上へ後退する。いちばん下の項目(例: フォームの最後の入力欄)に
 * フォーカスしたまま器が縮むと、その欄が縮んだ範囲の外(下側)へ出てしまい、
 * キーボードを開いても入力できないままになる(2026-09-20の報告、
 * 「いちばん下の項目に入力できない」)。縮んだ直後にフォーカス中の欄を範囲内へ
 * 入れ直すのが対策(src/components/ui/Sheet.tsx)。
 */
describe("入力シートでキーボードが出た時のスクロール", () => {
  it("フォーカス中の欄がいちばん下にあっても、見えている範囲へ入れ直す", async () => {
    const scrollIntoView = vi.fn();
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true, writable: true });
    const visual = installFakeViewport(800);

    try {
      const { getByTestId } = render(
        <Sheet open onClose={() => {}} title="予定を追加">
          <input data-testid="last-input" />
        </Sheet>,
      );
      const input = getByTestId("last-input") as HTMLInputElement;
      input.focus();

      // キーボードが開いて見えている高さが縮む。
      visual.height = 300;
      visual.dispatchEvent(new Event("resize"));

      await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" }));
    } finally {
      HTMLElement.prototype.scrollIntoView = original;
    }
  });
});

/** 要素の位置を決め打ちする(jsdom は配置を計算しないため)。 */
function placeAt(el: Element, top: number, bottom: number) {
  el.getBoundingClientRect = () => ({ top, bottom, height: bottom - top, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
}

describe("下に貼りついたキャンセル/保存の帯の裏に、入力欄を入れない", () => {
  // 2026-10-11、iPhone のホーム画面アプリで「修正」の入力欄に打つと、キーボードと文字がかぶった。
  function setup() {
    const body = document.createElement("div");
    const field = document.createElement("textarea");
    const actions = document.createElement("div");
    actions.className = "form-actions";
    body.append(field, actions);
    body.scrollTop = 0;
    placeAt(body, 100, 500);
    placeAt(actions, 420, 500);
    return { body, field, actions };
  }

  it("欄の下端が帯の裏に入っていたら、帯の上まで送る", () => {
    const { body, field } = setup();
    placeAt(field, 300, 450); // 帯(420〜)の裏に30px入っている
    revealAboveActions(body, field);
    expect(body.scrollTop).toBe(450 - (420 - 8));
  });

  it("帯より上に収まっていれば、動かさない", () => {
    const { body, field } = setup();
    placeAt(field, 200, 380);
    revealAboveActions(body, field);
    expect(body.scrollTop).toBe(0);
  });

  it("欄が見える範囲より大きい時は、上端を見える範囲の上に合わせる(打ち始めの行を見せる)", () => {
    const { body, field } = setup();
    placeAt(field, 250, 700);
    revealAboveActions(body, field);
    expect(body.scrollTop).toBe(250 - (100 + 8));
  });

  it("帯の中の部品(保存ボタン)にフォーカスした時は、何もしない", () => {
    const { body, actions } = setup();
    const button = document.createElement("button");
    actions.append(button);
    placeAt(button, 430, 470);
    revealAboveActions(body, button);
    expect(body.scrollTop).toBe(0);
  });

  it("キーボードが出たら、シートの中で帯より上へ入れ直す", async () => {
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = () => {};
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true, writable: true });
    const visual = installFakeViewport(800);
    try {
      const { getByTestId, container } = render(
        <Sheet open onClose={() => {}} title="直してほしいことを送る">
          <textarea data-testid="message" />
          <div className="form-actions">
            <button type="button">送る</button>
          </div>
        </Sheet>,
      );
      const body = document.querySelector<HTMLElement>(".sheet-body") ?? (container.firstElementChild as HTMLElement);
      const field = getByTestId("message");
      placeAt(body, 100, 400);
      placeAt(body.querySelector(".form-actions")!, 330, 400);
      placeAt(field, 250, 360);
      field.focus();
      visual.height = 400;
      visual.dispatchEvent(new Event("resize"));
      await waitFor(() => expect(body.scrollTop).toBe(360 - (330 - 8)));
    } finally {
      HTMLElement.prototype.scrollIntoView = original;
    }
  });
});

