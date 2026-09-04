/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmProvider, useConfirm } from "./ConfirmProvider";
import type { ConfirmOptions } from "./ConfirmProvider";

/** 「消す」を押すボタンだけの画面。押した結果をそのまま画面に出す。 */
function Harness({ options }: { options: ConfirmOptions }) {
  const confirm = useConfirm();
  return (
    <div>
      <button
        type="button"
        onClick={async () => {
          const result = await confirm(options);
          document.getElementById("result")!.textContent = String(result);
        }}
      >
        消す
      </button>
      <p id="result" />
    </div>
  );
}

function renderHarness(options: ConfirmOptions) {
  render(<Harness options={options} />, { wrapper: ConfirmProvider });
}

afterEach(cleanup);

describe("アプリ内の確認ダイアログ", () => {
  it("押すまでは何も出ていない(ブラウザ標準のconfirmと違い、画面を止めない)", () => {
    renderHarness({ title: "「歯医者」を削除しますか?" });
    expect(screen.queryByText("「歯医者」を削除しますか?")).toBeNull();
  });

  it("実行する側を押すと true が返る", async () => {
    const user = userEvent.setup();
    renderHarness({ title: "「歯医者」を削除しますか?" });

    await user.click(screen.getByRole("button", { name: "消す" }));
    expect(screen.getByText("「歯医者」を削除しますか?")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "削除する" }));
    expect(document.getElementById("result")?.textContent).toBe("true");
    // 閉じたら見出しごと消える。
    expect(screen.queryByText("「歯医者」を削除しますか?")).toBeNull();
  });

  it("やめる側を押すと false が返る", async () => {
    const user = userEvent.setup();
    renderHarness({ title: "「歯医者」を削除しますか?" });

    await user.click(screen.getByRole("button", { name: "消す" }));
    await user.click(screen.getByRole("button", { name: "キャンセル" }));

    expect(document.getElementById("result")?.textContent).toBe("false");
  });

  it("Escape で閉じたときも、やめた扱いにする(返事のないまま止まらない)", async () => {
    const user = userEvent.setup();
    renderHarness({ title: "「歯医者」を削除しますか?" });

    await user.click(screen.getByRole("button", { name: "消す" }));
    await user.keyboard("{Escape}");

    expect(document.getElementById("result")?.textContent).toBe("false");
  });

  it("補足とボタンの文言を差し替えられる", async () => {
    const user = userEvent.setup();
    renderHarness({
      title: "「北海道旅行」を削除しますか?",
      message: "関連するスケジュール・費用・持ち物もすべて削除されます。",
      confirmLabel: "消す",
      cancelLabel: "やめる",
    });

    await user.click(screen.getByRole("button", { name: "消す" }));

    expect(screen.getByText("関連するスケジュール・費用・持ち物もすべて削除されます。")).toBeTruthy();
    expect(screen.getByRole("button", { name: "やめる" })).toBeTruthy();
  });

  it("土台の外で使ったら、黙って素通りせずに止める", () => {
    // useToast と同じ扱い。確認を聞かずに削除が通るより、開発中に気づける方がよい。
    // React は投げた例外を console.error にも書くので、テストの出力は伏せておく。
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Harness options={{ title: "x" }} />)).toThrow(/ConfirmProvider/);
    vi.restoreAllMocks();
  });
});
