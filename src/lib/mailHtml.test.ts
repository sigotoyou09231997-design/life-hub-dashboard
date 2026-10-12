/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { buildSafeMailHtml, mailContentSecurityPolicy } from "./mailHtml";

/** 出来上がった文書を、ブラウザと同じように読み直して中を見る。 */
function parse(srcDoc: string): Document {
  return new DOMParser().parseFromString(srcDoc, "text/html");
}

describe("buildSafeMailHtml: 動くものを取り除く", () => {
  it("script・iframe・object・embed・base・meta refresh は中身ごと消す", () => {
    const { srcDoc } = buildSafeMailHtml(
      [
        '<html><head><base href="https://evil.example/"><meta http-equiv="refresh" content="0;url=https://evil.example/">',
        "<script>alert(1)</script></head><body>",
        "<p>本文です</p>",
        '<iframe src="https://evil.example/"></iframe>',
        '<object data="https://evil.example/x.swf"></object>',
        '<embed src="https://evil.example/x.swf">',
        '<svg><script>alert(2)</script><a xlink:href="javascript:alert(3)"><text>x</text></a></svg>',
        "<noscript><p>noscript</p></noscript>",
        '<link rel="stylesheet" href="https://evil.example/a.css">',
        "</body></html>",
      ].join(""),
    );
    const doc = parse(srcDoc);
    expect(doc.querySelector("script, iframe, object, embed, svg, noscript, link")).toBeNull();
    expect(doc.querySelector('meta[http-equiv="refresh"]')).toBeNull();
    // base は自分で入れる1つ(target だけ。行き先は持たない)だけが残る。
    expect(doc.querySelectorAll("base")).toHaveLength(1);
    expect(doc.querySelector("base")?.getAttribute("href")).toBeNull();
    expect(srcDoc).not.toContain("evil.example");
    expect(srcDoc).not.toContain("alert(");
    expect(doc.body.textContent).toContain("本文です");
  });

  it("on〜の属性はすべて外す", () => {
    const { srcDoc } = buildSafeMailHtml(
      '<body onload="alert(1)"><img src="data:image/png;base64,AAAA" onerror="alert(2)"><a href="https://example.com" onclick="alert(3)" onmouseover="x()">リンク</a><div ONCLICK="y()">z</div></body>',
    );
    const doc = parse(srcDoc);
    for (const el of Array.from(doc.querySelectorAll("*"))) {
      for (const attr of Array.from(el.attributes)) expect(attr.name.toLowerCase().startsWith("on"), attr.name).toBe(false);
    }
  });

  it("javascript: などのリンクは行き先ごと外し、普通のリンクは新しいタブで開く", () => {
    const { srcDoc } = buildSafeMailHtml(
      [
        '<a id="js" href="javascript:alert(1)">a</a>',
        '<a id="tab" href="java\tscript:alert(1)">b</a>',
        '<a id="spaced" href="  JavaScript:alert(1)">c</a>',
        '<a id="data" href="data:text/html,<script>alert(1)</script>">d</a>',
        '<a id="vb" href="vbscript:msgbox(1)">e</a>',
        '<a id="rel" href="/settings">f</a>',
        '<a id="hash" href="#top">g</a>',
        '<a id="ok" href="https://example.com/news" target="_top">h</a>',
        '<a id="mail" href="mailto:hr@example.com">i</a>',
        '<a id="proto" href="//example.com/x">j</a>',
      ].join(""),
    );
    const doc = parse(srcDoc);
    for (const id of ["js", "tab", "spaced", "data", "vb", "rel", "hash"]) {
      expect(doc.getElementById(id)?.hasAttribute("href"), id).toBe(false);
    }
    const ok = doc.getElementById("ok")!;
    expect(ok.getAttribute("href")).toBe("https://example.com/news");
    expect(ok.getAttribute("target")).toBe("_blank");
    expect(ok.getAttribute("rel")).toBe("noopener noreferrer");
    expect(doc.getElementById("mail")?.getAttribute("href")).toBe("mailto:hr@example.com");
    expect(doc.getElementById("proto")?.getAttribute("href")).toBe("https://example.com/x");
  });

  it("form は外して中の文章だけ残し、入力欄は消す", () => {
    const { srcDoc } = buildSafeMailHtml(
      '<form action="https://evil.example/collect" method="post"><p>アンケートのお願い</p><input name="pw" type="password"><button formaction="https://evil.example/">送る</button></form>',
    );
    const doc = parse(srcDoc);
    expect(doc.querySelector("form, input, button")).toBeNull();
    expect(srcDoc).not.toContain("evil.example");
    expect(doc.body.textContent).toContain("アンケートのお願い");
  });

  it("srcdoc・ping のような属性も外す", () => {
    const { srcDoc } = buildSafeMailHtml('<a href="https://example.com" ping="https://tracker.example/p">x</a><div srcdoc="<script>1</script>">y</div>');
    expect(srcDoc).not.toContain("tracker.example");
    expect(srcDoc).not.toContain("srcdoc");
  });
});

describe("buildSafeMailHtml: 先頭に入れる守り", () => {
  it('CSP と <base target="_blank"> を head の先頭に入れる', () => {
    const { srcDoc } = buildSafeMailHtml("<html><head><style>p{color:red}</style></head><body><p>x</p></body></html>");
    expect(srcDoc.startsWith("<!DOCTYPE html>")).toBe(true);
    const doc = parse(srcDoc);
    const first = doc.head.firstElementChild!;
    expect(first.localName).toBe("meta");
    expect(first.getAttribute("http-equiv")).toBe("Content-Security-Policy");
    expect(first.getAttribute("content")).toBe("default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; form-action 'none'");
    expect(doc.querySelector("base")?.getAttribute("target")).toBe("_blank");
    expect(doc.querySelector('meta[name="referrer"]')?.getAttribute("content")).toBe("no-referrer");
    // メール自身の CSS は土台の後ろに残す(メールの見た目の方を優先させる)。
    const styles = Array.from(doc.querySelectorAll("style")).map((s) => s.textContent);
    expect(styles[styles.length - 1]).toBe("p{color:red}");
  });

  it("土台の CSS はどれも強さ0(:where)にして、メール側の見た目を塗り替えない", () => {
    // 「a[href]{color}」のままだと、メールの「.btn{color:#fff}」より強く、黒いボタンの文字が青緑になっていた。
    const doc = parse(buildSafeMailHtml("<p>x</p>").srcDoc);
    const base = doc.head.querySelector("style")?.textContent ?? "";
    const selectors = base.split("}").filter(Boolean).map((rule) => rule.slice(0, rule.indexOf("{")));
    expect(selectors.length).toBeGreaterThan(0);
    for (const selector of selectors) expect(selector, selector).toMatch(/^:where\(.+\)$/);
  });

  it("head の無い断片でも、同じように守りを入れる", () => {
    const { srcDoc } = buildSafeMailHtml("<p>本文だけ</p>");
    const doc = parse(srcDoc);
    expect(doc.head.firstElementChild?.getAttribute("http-equiv")).toBe("Content-Security-Policy");
    expect(doc.body.textContent).toBe("本文だけ");
  });

  it("メール側の CSP の meta は消して、こちらの1つだけにする", () => {
    const { srcDoc } = buildSafeMailHtml(
      '<head><meta http-equiv="Content-Security-Policy" content="img-src *"></head><body>x</body>',
    );
    const doc = parse(srcDoc);
    expect(doc.querySelectorAll('meta[http-equiv="Content-Security-Policy"]')).toHaveLength(1);
    expect(srcDoc).not.toContain("img-src *");
  });

  it("画像を出す時だけ CSP に https: を足す", () => {
    expect(mailContentSecurityPolicy(false)).toContain("img-src data:;");
    expect(mailContentSecurityPolicy(false)).not.toContain("https:");
    expect(mailContentSecurityPolicy(true)).toContain("img-src data: https:;");
    expect(mailContentSecurityPolicy(true)).toContain("default-src 'none'");
  });
});

describe("buildSafeMailHtml: 外の画像", () => {
  const newsletter = [
    "<body>",
    '<img id="logo" src="https://cdn.example.com/logo.png" alt="ロゴ">',
    '<img id="pixel" src="http://tracker.example/open.gif?u=1" width="1" height="1">',
    '<img id="srcset" srcset="https://cdn.example.com/a.png 1x, https://cdn.example.com/a@2x.png 2x">',
    '<table><tr><td id="bg" background="https://cdn.example.com/bg.png">x</td></tr></table>',
    '<img id="data" src="data:image/png;base64,AAAA">',
    "</body>",
  ].join("");

  it("既定では読み込まない(開いたことが送り主に伝わらないように)", () => {
    const { srcDoc, hasRemoteImages } = buildSafeMailHtml(newsletter);
    expect(hasRemoteImages).toBe(true);
    const doc = parse(srcDoc);
    expect(doc.getElementById("logo")?.hasAttribute("src")).toBe(false);
    expect(doc.getElementById("pixel")?.hasAttribute("src")).toBe(false);
    expect(doc.getElementById("srcset")?.hasAttribute("srcset")).toBe(false);
    expect(doc.getElementById("bg")?.hasAttribute("background")).toBe(false);
    // 説明の文字は残す(画像の代わりに読める)。
    expect(doc.getElementById("logo")?.getAttribute("alt")).toBe("ロゴ");
    expect(srcDoc).not.toContain("tracker.example");
    expect(srcDoc).not.toContain("cdn.example.com");
    // メールの中に入っている画像(data:)は外へ出ないので、そのまま出す。
    expect(doc.getElementById("data")?.getAttribute("src")).toBe("data:image/png;base64,AAAA");
  });

  it("「画像を表示する」の後は読み込む。http は https に直す", () => {
    const { srcDoc, hasRemoteImages } = buildSafeMailHtml(newsletter, { allowRemoteImages: true });
    expect(hasRemoteImages).toBe(true);
    const doc = parse(srcDoc);
    expect(doc.getElementById("logo")?.getAttribute("src")).toBe("https://cdn.example.com/logo.png");
    expect(doc.getElementById("pixel")?.getAttribute("src")).toBe("https://tracker.example/open.gif?u=1");
    expect(doc.getElementById("srcset")?.getAttribute("srcset")).toContain("https://cdn.example.com/a@2x.png");
    expect(doc.getElementById("bg")?.getAttribute("background")).toBe("https://cdn.example.com/bg.png");
    expect(doc.head.firstElementChild?.getAttribute("content")).toContain("img-src data: https:");
  });

  it("CSS の背景画像も外の画像として数える(止めるのは CSP)", () => {
    expect(buildSafeMailHtml('<div style="background:url(https://cdn.example.com/bg.png)">x</div>').hasRemoteImages).toBe(true);
    expect(buildSafeMailHtml("<style>.hero{background-image:url('//cdn.example.com/a.png')}</style><p>x</p>").hasRemoteImages).toBe(true);
  });

  it("外の画像が無いメールでは「画像を表示する」を出さない", () => {
    expect(buildSafeMailHtml('<p>文字だけ</p><img src="data:image/gif;base64,R0lG">').hasRemoteImages).toBe(false);
  });

  it("javascript: や data:text の画像は外す", () => {
    const { srcDoc } = buildSafeMailHtml('<img id="a" src="javascript:alert(1)"><img id="b" src="data:text/html,<b>x</b>">');
    const doc = parse(srcDoc);
    expect(doc.getElementById("a")?.hasAttribute("src")).toBe(false);
    expect(doc.getElementById("b")?.hasAttribute("src")).toBe(false);
  });

  it("同封画像(cid:)は渡された data: URL に置き換え、無いものは外す", () => {
    const { srcDoc, hasRemoteImages } = buildSafeMailHtml(
      '<img id="a" src="cid:image001.png@01DA"><img id="b" src="cid:image%40002"><img id="c" src="cid:missing">',
      { inlineImages: { "image001.png@01DA": "data:image/png;base64,AAAA", "image@002": "data:image/png;base64,BBBB" } },
    );
    const doc = parse(srcDoc);
    expect(hasRemoteImages).toBe(false);
    expect(doc.getElementById("a")?.getAttribute("src")).toBe("data:image/png;base64,AAAA");
    expect(doc.getElementById("b")?.getAttribute("src")).toBe("data:image/png;base64,BBBB");
    expect(doc.getElementById("c")?.hasAttribute("src")).toBe(false);
  });

  it("遅れて読む指定(loading)は外す(枠の高さを測った後に画像が増えないように)", () => {
    const { srcDoc } = buildSafeMailHtml('<img src="https://cdn.example.com/a.png" loading="lazy">', { allowRemoteImages: true });
    expect(srcDoc).not.toContain("loading=");
  });
});
