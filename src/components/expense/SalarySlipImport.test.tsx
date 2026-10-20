// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SalaryEntry } from "../../types";
import type { ParsedPayslip } from "../../lib/payslipLayout";
import { ToastProvider } from "../ui/ToastProvider";

const mocks = vi.hoisted(() => ({
  salaries: [] as SalaryEntry[],
  added: [] as unknown[],
  updated: [] as unknown[][],
  parsed: null as ParsedPayslip | null,
}));

vi.mock("../../db/schema", () => ({
  db: {
    salaries: {
      toArray: async () => mocks.salaries,
      add: async (row: unknown) => void mocks.added.push(row),
      update: async (...args: unknown[]) => void mocks.updated.push(args),
    },
  },
}));
vi.mock("../../lib/payslipPdf", () => ({ readPdfTextBoxes: async () => [] }));
vi.mock("../../lib/payslipLayout", () => ({ parsePayslipBoxes: () => mocks.parsed }));
vi.mock("./SalaryCsvImport", () => ({ SalaryCsvImport: () => <p>CSVの取り込み</p> }));
vi.mock("dexie-react-hooks", async () => {
  const { useEffect, useState } = await import("react");
  return {
    useLiveQuery: (querier: () => unknown, deps: unknown[] = []) => {
      const [value, setValue] = useState<unknown>(undefined);
      useEffect(() => {
        let active = true;
        void Promise.resolve(querier()).then((next) => {
          if (active) setValue(next);
        });
        return () => {
          active = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, deps);
      return value;
    },
  };
});

import { SalarySlipImport } from "./SalarySlipImport";

const SLIP: ParsedPayslip = {
  slipMonth: "2026-10",
  paidOn: "2026-10-20",
  net: 163800,
  gross: 205000,
  deductionTotal: 41200,
  deductions: [
    { label: "健康保険料", amount: 10000 },
    { label: "所得税", amount: 3000 },
  ],
  balanced: true,
};

function choose(name: string, type: string) {
  const onClose = vi.fn();
  render(
    <ToastProvider>
      <SalarySlipImport onClose={onClose} />
    </ToastProvider>,
  );
  const input = document.querySelector("input[type=file]") as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(["x"], name, { type })] } });
  return onClose;
}

beforeEach(() => {
  mocks.salaries = [];
  mocks.added = [];
  mocks.updated = [];
  mocks.parsed = SLIP;
});
afterEach(cleanup);

describe("給与明細から取込", () => {
  it("PDF の明細を読んで、手取り・総支給・控除の内訳を見せてから登録する", async () => {
    const onClose = choose("給与明細書_2026_10_20_.pdf", "application/pdf");
    expect(await screen.findByText("2026年10月分の給与明細")).toBeTruthy();
    expect(screen.getByText("¥163,800")).toBeTruthy();
    expect(screen.getByText("健康保険料")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "登録する" }));
    await waitFor(() => expect(mocks.added).toHaveLength(1));
    expect(mocks.added[0]).toMatchObject({ month: "2026-10", payday: 20, amount: 163800, grossAmount: 205000 });
    expect(onClose).toHaveBeenCalled();
  });

  it("同じ月の給与がもうあれば、増やさずに明細の内容で置き換える", async () => {
    mocks.salaries = [{ id: "s1", month: "2026-10", payday: 25, amount: 160000, createdAt: 0 }];
    choose("給与明細書_2026_10_20_.pdf", "application/pdf");
    fireEvent.click(await screen.findByRole("button", { name: "置き換える" }));
    await waitFor(() => expect(mocks.updated).toHaveLength(1));
    expect(mocks.updated[0]).toEqual(["s1", expect.objectContaining({ amount: 163800, payday: 20 })]);
    expect(mocks.added).toHaveLength(0);
  });

  it("総支給 − 控除が手取りと合わない時は、見比べるよう知らせる", async () => {
    mocks.parsed = { ...SLIP, balanced: false };
    choose("slip.pdf", "application/pdf");
    expect((await screen.findByRole("note")).textContent).toContain("合いません");
  });

  it("読めない PDF は、理由を書いて登録しない", async () => {
    mocks.parsed = null;
    choose("slip.pdf", "application/pdf");
    expect(await screen.findByText(/手取り（差引支給額）を読み取れませんでした/)).toBeTruthy();
  });

  it("CSV は今までの取り込み(列を選ぶ)へ渡す", async () => {
    choose("salary.csv", "text/csv");
    expect(await screen.findByText("CSVの取り込み")).toBeTruthy();
  });
});
