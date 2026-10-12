/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../ui/ToastProvider";

const mocks = vi.hoisted(() => ({
  added: [] as Record<string, unknown>[],
  deleted: [] as string[],
}));

vi.mock("../../db/schema", () => ({
  db: {
    transactions: {
      toArray: async () => [],
      add: async (record: Record<string, unknown>) => {
        mocks.added.push(record);
        return "t1";
      },
      delete: async (id: string) => {
        mocks.deleted.push(id);
      },
    },
  },
}));
vi.mock("../../lib/projectTags", () => ({ deleteProjectTagFor: async () => undefined }));
vi.mock("dexie-react-hooks", async () => {
  const { useEffect, useState } = await import("react");
  return {
    useLiveQuery: (querier: () => unknown, deps: unknown[] = []) => {
      const [value, setValue] = useState<unknown>(undefined);
      useEffect(() => {
        let active = true;
        void Promise.resolve(querier()).then((next) => active && setValue(next));
        return () => {
          active = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, deps);
      return value;
    },
  };
});

const { InlineExpenseEntry, parseAmountInput } = await import("./InlineExpenseEntry");

beforeEach(() => {
  mocks.added = [];
  mocks.deleted = [];
});
afterEach(cleanup);

function renderEntry() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <InlineExpenseEntry />
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe("parseAmountInput", () => {
  it("カンマ・全角の数字・円記号・空白を許す", () => {
    expect(parseAmountInput("1280")).toBe(1280);
    expect(parseAmountInput("1,280")).toBe(1280);
    expect(parseAmountInput("１，２８０円")).toBe(1280);
    expect(parseAmountInput(" ¥ 500 ")).toBe(500);
    expect(parseAmountInput("12.5")).toBe(12.5);
  });

  it("空・0・負の数・数でない文字は、金額として受け取らない", () => {
    for (const raw of ["", "  ", "0", "-300", "abc", "12abc", "NaN", "Infinity"]) {
      expect(parseAmountInput(raw)).toBeNull();
    }
  });
});

describe("InlineExpenseEntry(ホームの黒いカードの中で、その場で支出を入れる)", () => {
  it("金額が無いあいだは「記録する」を押せない", async () => {
    renderEntry();
    expect((screen.getByRole("button", { name: "記録する" }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.type(screen.getByLabelText("金額(円)"), "0");
    expect((screen.getByRole("button", { name: "記録する" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("金額とカテゴリを選んで記録すると、「収支を追加」と同じ項目で1件保存する", async () => {
    const user = userEvent.setup();
    renderEntry();
    await user.type(screen.getByLabelText("金額(円)"), "1,280");
    const categories = screen.getAllByRole("button", { pressed: true });
    expect(categories).toHaveLength(1); // 先頭のカテゴリが、はじめから選ばれている
    await user.click(screen.getByRole("button", { name: "記録する" }));

    await waitFor(() => expect(mocks.added).toHaveLength(1));
    expect(mocks.added[0]).toMatchObject({
      type: "expense",
      amount: 1280,
      method: "現金",
      store: "",
      memo: "",
      isFixed: false,
    });
    expect(typeof mocks.added[0].category).toBe("string");
    expect(typeof mocks.added[0].date).toBe("string");
    // 入力は空に戻り、「元に戻す」が出る
    expect((screen.getByLabelText("金額(円)") as HTMLInputElement).value).toBe("");
    expect(await screen.findByRole("button", { name: "元に戻す" })).toBeTruthy();
  });

  it("選んだカテゴリで記録する", async () => {
    const user = userEvent.setup();
    renderEntry();
    const names = screen.getAllByRole("button").map((button) => button.textContent ?? "");
    const second = screen.getAllByRole("button", { pressed: false }).find((b) => ["日用品", "交通費", "娯楽"].includes(b.textContent ?? ""));
    expect(second).toBeTruthy();
    await user.type(screen.getByLabelText("金額(円)"), "500");
    await user.click(second!);
    await user.click(screen.getByRole("button", { name: "記録する" }));
    await waitFor(() => expect(mocks.added).toHaveLength(1));
    expect(mocks.added[0].category).toBe(second!.textContent);
    expect(names.length).toBeGreaterThan(3);
  });

  it("「元に戻す」を押すと、いま記録した1件を消す", async () => {
    const user = userEvent.setup();
    renderEntry();
    await user.type(screen.getByLabelText("金額(円)"), "300");
    await user.click(screen.getByRole("button", { name: "記録する" }));
    await user.click(await screen.findByRole("button", { name: "元に戻す" }));
    await waitFor(() => expect(mocks.deleted).toEqual(["t1"]));
  });
});
