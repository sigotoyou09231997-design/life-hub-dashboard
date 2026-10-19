import { describe, expect, it } from "vitest";
import {
  parseCsvLine,
  parsePayPayCsv,
  classifyForHousehold,
  isPayPayCsv,
  planPayPayImport,
  type ExistingTransactionLike,
} from "./paypayCsv";
import { budgetEffectOf } from "./paypayImport";

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

/** いまの PayPay アプリの書き出しと同じ形(先頭に BOM・かっこは全角・「変換レート」・「口座送金」)。中身は作り物。 */
const CURRENT_FORMAT_CSV = [
  "\uFEFF取引日,出金金額（円）,入金金額（円）,海外出金金額,通貨,変換レート（円）,利用国,取引内容,取引先,取引方法,支払い区分,利用者,取引番号",
  '2026/10/20 07:36:44,"6,810",-,-,-,-,-,支払い,めがね店,PayPay残高,-,-,05000000000000000001',
  '2026/10/20 07:36:26,-,"10,000",-,-,-,-,チャージ,PayPay,PayPay銀行 *****04,-,-,02300000000000000002',
  "2026/10/20 07:31:36,180,-,-,-,-,-,支払い,Appleサービス,PayPay残高,-,-,05000000000000000003",
  "2026/10/20 07:31:35,180,-,-,-,-,-,支払い,Appleサービス,PayPay残高,-,-,05000000000000000004",
  '2026/10/20 06:08:09,"90,000",-,-,-,-,-,口座送金,PayPay銀行 *****04,PayPay残高,-,-,02300000000000000005',
  '2026/10/20 06:07:23,"50,000",-,-,-,-,-,送った金額,友だち,PayPay残高,-,-,02300000000000000006',
  "2026/10/01 08:05:09,800,-,-,-,-,-,支払い,タクシー,PayPay残高,-,-,05000000000000000007",
].join("\n");

describe("いまの PayPay アプリの書き出しを読む", () => {
  const rows = parsePayPayCsv(CURRENT_FORMAT_CSV);

  it("BOM・全角のかっこの見出しでも、全部の行を読む", () => {
    expect(rows).toHaveLength(7);
    expect(rows[0]).toMatchObject({ date: "2026-10-20", withdrawal: 6810, deposit: 0, content: "支払い", counterparty: "めがね店" });
  });

  it("PayPay の取引履歴だと見分ける(銀行の明細は見分けない)", () => {
    expect(isPayPayCsv(CURRENT_FORMAT_CSV)).toBe(true);
    expect(isPayPayCsv(SAMPLE_CSV)).toBe(true);
    expect(isPayPayCsv("日付,摘要,出金,入金,残高\n2026/10/01,カード,1000,,5000")).toBe(false);
  });

  it("列の並びが変わっても、見出しの名前で読む", () => {
    const reordered = [
      "取引番号,取引内容,取引先,取引日,入金金額（円）,出金金額（円）",
      "05000000000000000009,支払い,パン屋,2026/10/05 12:00:00,-,450",
    ].join("\n");
    expect(parsePayPayCsv(reordered)).toEqual([
      expect.objectContaining({ date: "2026-10-05", withdrawal: 450, deposit: 0, content: "支払い", counterparty: "パン屋" }),
    ]);
  });

  it("口座への送金(口座送金)は、チャージと同じく PayPay の中の移動として、お金管理に入れない", () => {
    const transfer = rows.find((r) => r.content === "口座送金")!;
    expect(classifyForHousehold(transfer)).toBeNull();
  });
});

describe("取り込みの計画(planPayPayImport)", () => {
  const rows = parsePayPayCsv(CURRENT_FORMAT_CSV);
  const asImported = (externalIds: string[]): ExistingTransactionLike[] =>
    rows
      .filter((r) => externalIds.includes(r.externalId))
      .map((r) => ({ ...classifyForHousehold(r)!, date: r.date, externalId: r.externalId }));

  it("初めて入れる時は、支払い・送金だけをお金管理に足し、チャージ・口座送金は足さない", () => {
    const plan = planPayPayImport(rows, [], []);
    expect(plan.householdToAdd.map((d) => d.entry.store)).toEqual(["めがね店", "Appleサービス", "Appleサービス", "友だち", "タクシー"]);
    expect(plan.internal.map((r) => r.content)).toEqual(["チャージ", "口座送金"]);
    expect(plan.ledgerToAdd).toHaveLength(7);
  });

  it("同じファイルを入れ直すと、すべて重複として足さない", () => {
    const first = planPayPayImport(rows, [], []);
    const existing = asImported(first.householdToAdd.map((d) => d.row.externalId));
    const again = planPayPayImport(rows, rows.map((r) => r.externalId), existing);
    expect(again.householdToAdd).toEqual([]);
    expect(again.householdDuplicates).toHaveLength(5);
    expect(again.ledgerToAdd).toEqual([]);
  });

  it("残高の記録には残っていても、お金管理に無い取引は足す(いつまでも入らない、にしない)", () => {
    const plan = planPayPayImport(rows, rows.map((r) => r.externalId), []);
    expect(plan.householdToAdd).toHaveLength(5);
    expect(plan.ledgerToAdd).toEqual([]);
  });

  it("期間の重なるファイルを入れると、まだ無い取引だけを足す", () => {
    const older = rows.filter((r) => r.date === "2026-10-01");
    const plan = planPayPayImport(rows, older.map((r) => r.externalId), asImported(older.map((r) => r.externalId)));
    expect(plan.householdToAdd.map((d) => d.entry.store)).toEqual(["めがね店", "Appleサービス", "Appleサービス", "友だち"]);
    expect(plan.householdDuplicates.map((d) => d.entry.store)).toEqual(["タクシー"]);
  });

  it("「CSVから取込」で先に入れていた同じ日・同じ金額の取引も重複にする。同じ額が2回なら、入っている数だけ", () => {
    const fromGenericCsv: ExistingTransactionLike[] = [
      { type: "expense", amount: 180, date: "2026-10-20", externalId: "csv:2026-10-20:expense:180::0" },
      { type: "expense", amount: 800, date: "2026-10-01", externalId: "csv:2026-10-01:expense:800::0" },
    ];
    const plan = planPayPayImport(rows, [], fromGenericCsv);
    // Appleサービス ¥180 は2回あるが、入っているのは1件なので、1件だけ重複で、もう1件は足す。
    expect(plan.householdDuplicates.map((d) => `${d.entry.store}:${d.entry.amount}`)).toEqual(["Appleサービス:180", "タクシー:800"]);
    expect(plan.householdToAdd.map((d) => `${d.entry.store}:${d.entry.amount}`)).toEqual(["めがね店:6810", "Appleサービス:180", "友だち:50000"]);
  });

  it("手で入れた記録と同じ日・同じ金額のものは、足したうえで知らせる(黙って飛ばさない)", () => {
    const manual: ExistingTransactionLike[] = [{ type: "expense", amount: 800, date: "2026-10-01", store: "タクシー代" }];
    const plan = planPayPayImport(rows, [], manual);
    expect(plan.householdToAdd).toHaveLength(5);
    expect(plan.similarToManual.map((d) => d.entry.store)).toEqual(["タクシー"]);
  });
});

describe("使えるお金への効き方(budgetEffectOf)", () => {
  const plan = planPayPayImport(parsePayPayCsv(CURRENT_FORMAT_CSV), [], []);

  it("今の給料の期間に入る支出の合計を出し、期間より前の日付は数えない", () => {
    expect(budgetEffectOf(plan.householdToAdd, { periodStart: "2026-10-10", hasSalary: true }, "2026-10-20")).toEqual({
      hasSalary: true,
      periodStart: "2026-10-10",
      inPeriodCount: 4,
      inPeriodTotal: 6810 + 180 + 180 + 50000,
      beforePeriodCount: 1,
    });
  });

  it("給与が1件も無い時は、給与が無いと返す", () => {
    expect(budgetEffectOf(plan.householdToAdd, null, "2026-10-20")).toMatchObject({ hasSalary: false, periodStart: null });
  });
});
