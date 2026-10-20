import type { TextBox } from "./payslipLayout";

/**
 * PDF から「文字と位置」を取り出す(給与明細の読み取り、src/lib/payslipLayout.ts)。
 *
 * pdf.js(pdfjs-dist)を使う。大きいので、PDF を選んだ時に初めて読み込む(ふだんの画面の重さは変えない)。
 * 和文の明細は、文字の対応表(CMap、例: 90ms-RKSJ-H)が無いと文字が取れない。表は pdfjs-dist に入っているものを
 * ビルドで一緒に出し(1つずつ別のファイル)、要る時に要るものだけ読む。外のサーバーには取りに行かない。
 */
const CMAP_DIR = "/node_modules/pdfjs-dist/cmaps/";
const CMAPS = import.meta.glob("/node_modules/pdfjs-dist/cmaps/*.bcmap", { query: "?url", import: "default" }) as Record<
  string,
  () => Promise<string>
>;

/** pdf.js に文字の対応表を渡す係(pdf.js の CMapReaderFactory と同じ形)。 */
class BundledCMapReaderFactory {
  async fetch({ name }: { name: string }): Promise<{ cMapData: Uint8Array; isCompressed: boolean }> {
    const load = CMAPS[`${CMAP_DIR}${name}.bcmap`];
    if (!load) throw new Error(`文字の対応表 ${name} がありません`);
    const response = await fetch(await load());
    if (!response.ok) throw new Error(`文字の対応表 ${name} を読めませんでした`);
    return { cMapData: new Uint8Array(await response.arrayBuffer()), isCompressed: true };
  }
}

/** 全ページの文字を、位置つきで取り出す。PDF として読めなければ投げる。 */
export async function readPdfTextBoxes(file: File): Promise<TextBox[]> {
  const [pdfjs, worker] = await Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.mjs?url")]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const data = new Uint8Array(await file.arrayBuffer());
  const document = await pdfjs.getDocument({
    data,
    isEvalSupported: false,
    useWorkerFetch: false,
    CMapReaderFactory: BundledCMapReaderFactory,
  }).promise;
  try {
    const boxes: TextBox[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      for (const item of content.items) {
        if (!("str" in item) || !item.str) continue;
        // 2ページ目以降は、1ページ目より下に並べる(行のまとめ方が混ざらないように)。
        boxes.push({ str: item.str, x: item.transform[4], y: item.transform[5] - (pageNumber - 1) * 10_000, w: item.width });
      }
    }
    return boxes;
  } finally {
    void document.destroy();
  }
}
