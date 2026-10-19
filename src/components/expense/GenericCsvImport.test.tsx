/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ToastProvider } from "../ui/ToastProvider";
import type { PayPayImportOutcome } from "../../lib/paypayImport";

const importPayPayCsvText = vi.fn<(text: string) => Promise<PayPayImportOutcome | null>>();
vi.mock("../../lib/paypayImport", () => ({ importPayPayCsvText: (text: string) => importPayPayCsvText(text) }));
vi.mock("../../db/schema", () => ({ db: {} }));

const { GenericCsvImport } = await import("./GenericCsvImport");

const PAYPAY_CSV = [
  "﻿取引日,出金金額（円）,入金金額（円）,海外出金金額,通貨,変換レート（円）,利用国,取引内容,取引先,取引方法,支払い区分,利用者,取引番号",
  "2026/10/01 08:05:09,800,-,-,-,-,-,支払い,タクシー,PayPay残高,-,-,05000000000000000007",
].join("\n");

/** jsdom の File は arrayBuffer を持たないことがあるので、中身を渡せる形で作る。 */
function csvFile(text: string): File {
  const file = new File([text], "Transactions.csv", { type: "text/csv" });
  const bytes = new TextEncoder().encode(text);
  Object.defineProperty(file, "arrayBuffer", { value: async () => bytes.buffer.slice(0) });
  return file;
}

function choose(text: string) {
  render(
    <ToastProvider>
      <GenericCsvImport onClose={() => {}} />
    </ToastProvider>,
  );
  const input = document.querySelector("input[type=file]") as HTMLInputElement;
  fireEvent.change(input, { target: { files: [csvFile(text)] } });
}

afterEach(() => {
  cleanup();
  importPayPayCsvText.mockReset();
});

describe("「CSVから取込」に PayPay の取引履歴を入れた時", () => {
  it("列を選ばせずに PayPay の読み方で取り込み、結果を出す", async () => {
    importPayPayCsvText.mockResolvedValue({
      total: 1,
      added: [
        {
          row: { externalId: "x", date: "2026-10-01", amount: -800, withdrawal: 800, deposit: 0, content: "支払い", counterparty: "タクシー" },
          entry: { type: "expense", amount: 800, category: "その他", store: "タクシー", memo: "PayPay支払い" },
        },
      ],
      duplicates: 0,
      internal: 0,
      similarToManual: [],
      budget: { hasSalary: true, periodStart: "2026-09-25", inPeriodCount: 1, inPeriodTotal: 800, beforePeriodCount: 0 },
    });
    choose(PAYPAY_CSV);
    expect(await screen.findByText("お金管理に 1件 入れました")).toBeTruthy();
    expect(importPayPayCsvText).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/使えるお金から/).textContent).toContain("¥800");
    expect(screen.queryByText(/プレビュー/)).toBeNull();
  });

  it("入れ直して全部が取り込み済みなら、そう書く", async () => {
    importPayPayCsvText.mockResolvedValue({
      total: 1,
      added: [],
      duplicates: 1,
      internal: 0,
      similarToManual: [],
      budget: { hasSalary: true, periodStart: "2026-09-25", inPeriodCount: 0, inPeriodTotal: 0, beforePeriodCount: 0 },
    });
    choose(PAYPAY_CSV);
    expect(await screen.findByText("このファイルの取引は、すべて取り込み済みです")).toBeTruthy();
  });

  it("銀行の明細は、今までどおり列を選ぶ画面へ進む", async () => {
    choose("日付,摘要,出金,入金,残高\n2026/10/01,カード,1000,,5000");
    expect(await screen.findByText(/プレビュー/)).toBeTruthy();
    expect(importPayPayCsvText).not.toHaveBeenCalled();
  });
});
