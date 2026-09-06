import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * 2026-09-06、本番のアプリが**真っ白**になった。
 *
 *   1. ブラウザ(やService Workerの取り置き)に前の版の index.html が残っていた
 *   2. そのHTMLは、新しい版では消えている /assets/index-<古い印>.js を読みに行く
 *   3. vercel.json の「全部 index.html に流す」設定が、無いファイルにも 200 で
 *      index.html(text/html)を返していた
 *   4. モジュールとして読めず(MIME違い)、React が一度も動かないまま画面は真っ白。
 *      エラーの受け皿も無いので、画面には何の知らせも出ない
 *
 * 直しは2つで、どちらが欠けても真っ白に戻る。ここで両方を機械で見張る。
 */

const root = fileURLToPath(new URL("../../", import.meta.url));

describe("古いHTMLを掴んだ端末が立て直せること", () => {
  it("vercel.json の受け皿は /assets/ を除いている(無いJSに404を返す)", () => {
    const config = JSON.parse(readFileSync(`${root}vercel.json`, "utf8")) as {
      rewrites: { source: string; destination: string }[];
    };
    const spa = config.rewrites.find((r) => r.destination === "/index.html");
    expect(spa).toBeDefined();
    expect(spa?.source).toContain("?!");
    expect(spa?.source).toContain("assets/");

    // 実際に当たるかどうかで見る — 書き方が変わっても意味が変わらなければ通る。
    const pattern = new RegExp(`^${spa!.source}$`);
    expect(pattern.test("/settings")).toBe(true);
    expect(pattern.test("/trips/abc")).toBe(true);
    expect(pattern.test("/assets/index-JrAPYnZ_.js")).toBe(false);
  });

  it("index.html の立て直しの台本が、読み込む物より先に置いてある", () => {
    const html = readFileSync(`${root}index.html`, "utf8");
    expect(html).toContain("lifehub:stale-html-recovered");
    // Service Worker と取り置きを捨ててから読み込み直す。
    expect(html).toContain("unregister()");
    expect(html).toContain("caches");
    expect(html).toContain("location.reload()");
    // 先に置いていないと、読み込みの失敗を拾えない。
    expect(html.indexOf("lifehub:stale-html-recovered")).toBeLessThan(html.indexOf('type="module"'));
  });

  it("立ち上がったら印を消す(同じタブで次も立て直せる)", () => {
    const main = readFileSync(`${root}src/main.tsx`, "utf8");
    expect(main).toContain('sessionStorage.removeItem("lifehub:stale-html-recovered")');
  });
});
