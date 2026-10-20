import type { SalaryDeductionItem } from "../types";

/**
 * 給与明細の PDF(表の形のもの)から、手取り・総支給・控除の内訳を読む(2026-10-20、本人「このタイプの給与明細を読み込めるようにして」)。
 *
 * 対象は、給与ソフトがよく出す「見出しの行のすぐ下の行に、その見出しの数字」が並ぶ表の明細
 * (例: 見出し「健康保険料 子育て支援金 厚生年金保険 雇用保険料」、下の行に「11,520 276 21,960 1,103」)。
 * AI は使わない(決まった形を読むだけ。API の残高が切れていても読める)。
 *
 * ここは PDF から取り出した「文字と位置」(TextBox)だけを相手にする計算で、PDF を読む所(src/lib/payslipPdf.ts)とは分けてある。
 * 位置は PDF の座標(左下が原点、y は上ほど大きい)。
 */
export interface TextBox {
  str: string;
  x: number;
  y: number;
  w: number;
}

export interface ParsedPayslip {
  /** 「2026年10月分」の月(YYYY-MM)。 */
  slipMonth: string | null;
  /** 支給日(YYYY-MM-DD)。明細の中の「支給日」か、ファイル名の日付(例: …_2026_10_20_.pdf)。分からなければ null。 */
  paidOn: string | null;
  /** 差引支給額(手取り)。 */
  net: number;
  /** 総支給額。 */
  gross: number | null;
  /** 控除合計。 */
  deductionTotal: number | null;
  /** 控除の内訳(0円の項目は入れない)。 */
  deductions: SalaryDeductionItem[];
  /** 総支給 − 控除合計 ＝ 手取り、が合っているか(読み違いの目安)。総支給か控除合計が無ければ null。 */
  balanced: boolean | null;
}

const NUMBER_RE = /^[-−▲]?[\d,]+(\.\d+)?$/;

function toNumber(str: string): number {
  const negative = /^[-−▲]/.test(str);
  const n = Number(str.replace(/^[-−▲]/, "").replace(/,/g, ""));
  return negative ? -n : n;
}

/** 同じ高さ(y が近い)の文字を1行にまとめる。上の行から順。 */
function groupRows(boxes: TextBox[], tolerance = 2.5): TextBox[][] {
  const sorted = [...boxes].filter((b) => b.str.trim()).sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: TextBox[][] = [];
  for (const box of sorted) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row[0].y - box.y) <= tolerance) row.push(box);
    else rows.push([box]);
  }
  return rows.map((row) => row.sort((a, b) => a.x - b.x));
}

/**
 * 1つにつながって取り出された見出し(「子育て支援金 厚生年金保険」)を、空白で分けて1つずつにする。
 * 幅は文字数で割り振る(等幅の和文の見出しなので、文字数に比例する)。
 */
function splitLabels(box: TextBox): { label: string; center: number }[] {
  const words = box.str.trim().split(/[\s　]+/).filter(Boolean);
  if (words.length <= 1) return [{ label: box.str.trim(), center: box.x + box.w / 2 }];
  const totalChars = words.reduce((sum, word) => sum + word.length, 0) + (words.length - 1);
  const perChar = box.w / totalChars;
  const out: { label: string; center: number }[] = [];
  let cursor = box.x;
  for (const word of words) {
    const width = word.length * perChar;
    out.push({ label: word, center: cursor + width / 2 });
    cursor += width + perChar;
  }
  return out;
}

export interface LabeledValue {
  label: string;
  value: number;
  /** 見出しの位置(控除の欄の中かを見分けるのに使う)。 */
  x: number;
  y: number;
}

/**
 * 見出しの行と、そのすぐ下の数字の行を組にして、数字ごとに一番近い見出しを当てる。
 * 数字は欄の右に寄せてあり、見出しは欄の真ん中にあるので、中心どうしの近さで決める。
 */
export function pairLabelsWithValues(boxes: TextBox[]): LabeledValue[] {
  // 欄の左の縦書きの見出し(「支」「給」「控」「除」…1文字ずつ)は、数字の行と同じ高さに来て行を乱すので外す。
  const rows = groupRows(boxes.filter((b) => b.str.trim().length > 1 || NUMBER_RE.test(b.str.trim())));
  const pairs: LabeledValue[] = [];
  for (let i = 0; i < rows.length - 1; i++) {
    const labelRow = rows[i];
    const valueRow = rows[i + 1];
    if (labelRow.some((b) => NUMBER_RE.test(b.str.trim()))) continue;
    if (!valueRow.every((b) => NUMBER_RE.test(b.str.trim()))) continue;
    const gap = labelRow[0].y - valueRow[0].y;
    if (gap <= 0 || gap > 25) continue;
    const candidates = labelRow.flatMap((box) => splitLabels(box).map((part) => ({ ...part, y: box.y })));
    const taken = new Set<number>();
    for (const value of valueRow) {
      const center = value.x + value.w / 2;
      let best = -1;
      let bestDistance = Infinity;
      candidates.forEach((label, index) => {
        const distance = Math.abs(label.center - center);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = index;
        }
      });
      // 欄1つぶん(およそ60pt)より離れた見出しには当てない。同じ見出しに2つ当てない。
      if (best < 0 || bestDistance > 60 || taken.has(best)) continue;
      taken.add(best);
      pairs.push({ label: candidates[best].label, value: toNumber(value.str.trim()), x: candidates[best].center, y: candidates[best].y });
    }
  }
  return pairs;
}

const NET_LABELS = ["差引支給額", "差引支給合計", "振込支給額", "手取り額", "差引支給"];
const GROSS_LABELS = ["総支給額合計", "総支給額", "支給合計", "総支給合計", "支給額合計"];
const DEDUCTION_TOTAL_LABELS = ["控除合計", "控除額合計", "控除計合計"];
/** 控除の欄の中でも、内訳ではない(合計・小計・計算のもと)もの。 */
const NOT_A_DEDUCTION = /合計|控除計|対象額|課税|残$|累積|端数|支払/;
/** 控除の欄が見つからない時に、内訳として拾う見出し。 */
const KNOWN_DEDUCTIONS = /保険料|保険$|年金|所得税|住民税|支援金|組合費|共済|積立|貯蓄|財形|社宅|寮費/;

function firstValue(pairs: LabeledValue[], labels: string[]): number | null {
  for (const label of labels) {
    const hit = pairs.find((pair) => pair.label === label);
    if (hit) return hit.value;
  }
  return null;
}

/** 欄の左の縦書きの見出し(「控」「除」)から、控除の欄の上下の端を出す。見つからなければ null。 */
function deductionBand(boxes: TextBox[]): { top: number; bottom: number } | null {
  const single = (ch: string) => boxes.filter((b) => b.str.trim() === ch).sort((a, b) => a.x - b.x)[0];
  const top = single("控");
  const bottom = single("除");
  if (!top || !bottom || top.y <= bottom.y) return null;
  // 縦書きの見出しは欄の上下の内側にあるので、少し広げる。
  return { top: top.y + 20, bottom: bottom.y - 20 };
}

function dateFromText(text: string): string | null {
  const match = /支給日[^\d]{0,4}(20\d{2})[年/.\-](\d{1,2})[月/.\-](\d{1,2})/.exec(text);
  return match ? `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}` : null;
}

/** ファイル名の日付(…_2026_10_20_.pdf、2026-10-20 など)。給与ソフトは支給日をファイル名に入れることが多い。 */
export function dateFromFileName(fileName: string): string | null {
  const matches = [...fileName.matchAll(/(20\d{2})[_\-.年/](\d{1,2})[_\-.月/](\d{1,2})/g)];
  const last = matches[matches.length - 1];
  if (!last) return null;
  const month = Number(last[2]);
  const day = Number(last[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${last[1]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** 明細を読む。手取り(差引支給額)が見つからなければ、この形の明細ではないとして null。 */
export function parsePayslipBoxes(boxes: TextBox[], fileName = ""): ParsedPayslip | null {
  const pairs = pairLabelsWithValues(boxes);
  const net = firstValue(pairs, NET_LABELS);
  if (net == null || net <= 0) return null;

  const text = groupRows(boxes)
    .map((row) => row.map((b) => b.str).join(" "))
    .join("\n");
  const month = /(20\d{2})年\s*(\d{1,2})月分/.exec(text);
  const slipMonth = month ? `${month[1]}-${month[2].padStart(2, "0")}` : null;

  const gross = firstValue(pairs, GROSS_LABELS);
  const deductionTotal = firstValue(pairs, DEDUCTION_TOTAL_LABELS);

  const band = deductionBand(boxes);
  const inBand = (pair: LabeledValue) => (band ? pair.y <= band.top && pair.y >= band.bottom : KNOWN_DEDUCTIONS.test(pair.label));
  const deductions = pairs
    .filter((pair) => inBand(pair) && !NOT_A_DEDUCTION.test(pair.label) && pair.value > 0)
    .map((pair) => ({ label: pair.label, amount: pair.value }));
  // 内訳の合計が控除合計に足りない時は、残りを「その他の控除」にする(読めなかった項目があっても合計は合うように)。
  if (deductionTotal != null) {
    const sum = deductions.reduce((total, item) => total + item.amount, 0);
    if (deductionTotal - sum > 0) deductions.push({ label: "その他の控除", amount: deductionTotal - sum });
  }

  return {
    slipMonth,
    paidOn: dateFromText(text) ?? dateFromFileName(fileName),
    net,
    gross,
    deductionTotal,
    deductions,
    balanced: gross != null && deductionTotal != null ? gross - deductionTotal === net : null,
  };
}
