import { describe, expect, it } from "vitest";
import { parseCsvLine, parsePayPayCsv, classifyForHousehold } from "./paypayCsv";

const SAMPLE_CSV = [
  "取引日,出金金額(円),入金金額(円),海外出金金額,通貨,換算レート(円),利用国,取引内容,取引先,取引方法,支払い区分,利用者,取引番号",
  '2026/07/31 13:24:08,"1,197",-,-,-,-,-,支払い,セブン-イレブン - 岡山桃太郎大通り店,PayPay残高,-,-,05036504111661547527',
  '2026/07/31 13:24:04,-,"1,000",-,-,-,-,チャージ,PayPay,PayPay銀行 *****04,-,-,02325355806523187206',
  '2026/07/17 07:11:10,"120,000",-,-,-,-,-,口座出金,PayPay銀行 *****04,PayPay残高,-,-,02314773436601106432',
  '2026/07/03 22:38:34,"4,000",-,-,-,-,JP,送った金額,福本,PayPay残高,-,-,02304860823880179717',
  '2026/07/31 06:43:33,-,"30,000",-,-,-,JP,受け取った金額,カズ,PayPay残高,-,-,02325149381804589056',
  '2026/07/03 23:48:05,800,-,-,-,-,-,支払い,松屋みかしー,PayPay残高,-,-,05016044931863158786',
  '2026/07/03 23:48:05,-,4,-,-,-,-,ポイントで残高の獲得,松屋みかしー,PayPayポイント,-,-,05016044931863158786',
].join("\n");

describe("parseCsvLine", () => {
  it("splits quoted fields containing commas without breaking them apart", () => {
    expect(parseCsvLine('2026/07/31,"1,197",-,支払い')).toEqual(["2026/07/31", "1,197", "-", "支払い"]);
  });
});

describe("parsePayPayCsv", () => {
  const rows = parsePayPayCsv(SAMPLE_CSV);

  it("skips the header row and parses every data row", () => {
    expect(rows).toHaveLength(7);
  });

  it("converts the date portion to YYYY-MM-DD and drops the time", () => {
    expect(rows[0].date).toBe("2026-07-31");
  });

  it("computes a signed balance delta (deposit minus withdrawal)", () => {
    expect(rows[0].amount).toBe(-1197); // payment: withdrawal only
    expect(rows[1].amount).toBe(1000); // charge: deposit only
  });

  it("gives sibling rows sharing the same 取引番号 distinct dedup keys", () => {
    const [payment, pointCredit] = rows.filter((r) => r.externalId.startsWith("05016044931863158786"));
    expect(payment.externalId).not.toBe(pointCredit.externalId);
  });
});

describe("classifyForHousehold", () => {
  const rows = parsePayPayCsv(SAMPLE_CSV);

  it("counts a 支払い row as a household expense for the withdrawal amount", () => {
    const row = rows.find((r) => r.content === "支払い" && r.counterparty.includes("セブン"))!;
    expect(classifyForHousehold(row)).toMatchObject({ type: "expense", amount: 1197 });
  });

  it("counts 送った金額 (P2P send) as an expense and 受け取った金額 as income", () => {
    const sent = rows.find((r) => r.content === "送った金額")!;
    const received = rows.find((r) => r.content === "受け取った金額")!;
    expect(classifyForHousehold(sent)).toMatchObject({ type: "expense", amount: 4000 });
    expect(classifyForHousehold(received)).toMatchObject({ type: "income", amount: 30000 });
  });

  it("excludes wallet-internal movements (charge, bank withdrawal, point conversion) from the household ledger", () => {
    const charge = rows.find((r) => r.content === "チャージ")!;
    const bankWithdrawal = rows.find((r) => r.content === "口座出金")!;
    const pointConversion = rows.find((r) => r.content === "ポイントで残高の獲得")!;
    expect(classifyForHousehold(charge)).toBeNull();
    expect(classifyForHousehold(bankWithdrawal)).toBeNull();
    expect(classifyForHousehold(pointConversion)).toBeNull();
  });
});
