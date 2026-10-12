/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { useState } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CategorySelect } from "./CategorySelect";

function Harness({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <CategorySelect value={value} onChange={setValue} />
      <output aria-label="今の値">{value}</output>
    </>
  );
}

afterEach(cleanup);

// メモ・チェックリスト・買い物リストのシートで使う。iPhone ではシートの中のプルダウンの選択肢が
// 欄から離れた所に出るので(2026-10-12)、ボタンにしてある。
describe("メモのカテゴリ", () => {
  it("プルダウンではなくボタンで選び、値はカテゴリの名前そのまま", async () => {
    const user = userEvent.setup();
    render(<Harness initial="仕事" />);
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByRole("button", { name: "仕事" }).getAttribute("aria-pressed")).toBe("true");

    await user.click(screen.getByRole("button", { name: "プライベート" }));
    expect(screen.getByLabelText("今の値").textContent).toBe("プライベート");
    expect(screen.getByRole("button", { name: "プライベート" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "仕事" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("一覧に無い前のカテゴリは、選んだ状態で見せ、ほかを押した後も選び直せる", async () => {
    const user = userEvent.setup();
    render(<Harness initial="趣味" />);
    expect(screen.getByRole("button", { name: "趣味" }).getAttribute("aria-pressed")).toBe("true");

    await user.click(screen.getByRole("button", { name: "重要" }));
    await user.click(screen.getByRole("button", { name: "趣味" }));
    expect(screen.getByLabelText("今の値").textContent).toBe("趣味");
  });
});
