/** HTMLメールを、元の見た目のまま安全に見せるための下ごしらえ(2026-10-12 の見直し A-7)。
 *
 * 以前は本文を文章に直して出すだけだったので、HTMLでしか中身を書いていないメールは
 * 「このメールはHTMLメールです…」の一文しか読めなかった。ここで作った文書を
 * `<iframe sandbox srcdoc>`(src/components/gmail/MailHtmlFrame.tsx)に入れて見せる。
 *
 * 守りは3重にしてある。どれか1つが破られても残りで止まるように:
 * 1. iframe の sandbox に allow-scripts を付けない → ブラウザがスクリプトを一切動かさない。
 * 2. ここで危ないもの(script・iframe・form・on〜属性・javascript: のリンク…)を取り除く。
 * 3. 文書の先頭に CSP を入れ、外への読み込みを止める(画像は本人が押すまで出さない)。
 *
 * 外の画像を止めるのは、開いた瞬間に「読んだこと」が送り主に伝わる仕組み(見えない
 * 1ピクセルの画像)がメルマガによく入っているため。Gmail 本体と同じ考え方。
 *
 * 元のHTMLは保存しない — 画面を開いている間だけ持ち、Dexie にも同期にも載せない
 * (一覧が持つのは抜粋だけ、という今までの決め事のまま)。 */

export interface SafeMailHtmlOptions {
  /** true にすると外の画像(https)を読み込む。既定は止める。 */
  allowRemoteImages?: boolean;
  /** メールに同封された画像(cid:〜)を data: URL に置き換える対応表。キーは山かっこを外した Content-ID。 */
  inlineImages?: Record<string, string>;
}

export interface SafeMailHtml {
  /** iframe の srcdoc にそのまま入れる文書。 */
  srcDoc: string;
  /** 外の画像が入っていたか(「画像を表示する」ボタンを出すかどうか)。 */
  hasRemoteImages: boolean;
}

/** 文書の先頭に入れる CSP。何も読み込ませない所から始めて、見た目に要る分だけ開ける。
 * 画像を出す時だけ https: を足す(http: は混在コンテンツになるので、https に直してから読む)。 */
export function mailContentSecurityPolicy(allowRemoteImages: boolean): string {
  const imgSrc = allowRemoteImages ? "img-src data: https:" : "img-src data:";
  return `default-src 'none'; style-src 'unsafe-inline'; ${imgSrc}; font-src data:; form-action 'none'`;
}

/** 中身ごと捨てる要素。動くもの・外を読み込むもの・別の文書を埋め込むもの、と
 * 送り手が仕込んだ base/meta(リンクの行き先や再読み込みを書き換えられる)。
 * svg/math は中で名前空間が切り替わり、取り除いた後に組み直されて別物になる
 * (いわゆる mXSS)入口になりやすいので、メールではまず使われないこともあって丸ごと外す。 */
const DROP_TAGS = new Set([
  "script",
  "noscript",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "applet",
  "portal",
  "fencedframe",
  "base",
  "link",
  "meta",
  "svg",
  "math",
  "template",
  "input",
  "button",
  "select",
  "textarea",
]);

/** 要素は外すが、中の文章は残すもの。form の中にアンケートの説明文などが入っていることがある。 */
const UNWRAP_TAGS = new Set(["form"]);

/** 値に関係なく外す属性。srcdoc は入れ子の文書、ping はリンクを押した時の追跡通知、
 * manifest は昔のキャッシュ指定。 */
const DROP_ATTRS = new Set(["srcdoc", "formaction", "action", "ping", "http-equiv", "manifest", "lowsrc", "dynsrc", "longdesc", "cite", "loading"]);

/** スタイル属性の中で、昔のブラウザがスクリプトとして動かしていた書き方。今は動かないが、残す理由も無い。 */
const DANGEROUS_STYLE = /expression\s*\(|javascript:|vbscript:|behavior\s*:|-moz-binding/i;
/** CSS の中の外の画像(背景画像など)。CSP で止まるが、「画像を表示する」を出すかの判定に使う。 */
const REMOTE_CSS_URL = /url\(\s*['"]?\s*(?:https?:)?\/\//i;

/** HTMLメールを、iframe の srcdoc に入れられる安全な文書にする。 */
export function buildSafeMailHtml(rawHtml: string, options: SafeMailHtmlOptions = {}): SafeMailHtml {
  const allowRemoteImages = options.allowRemoteImages ?? false;
  const inlineImages = options.inlineImages ?? {};
  // DOMParser で作った文書はスクリプトが動かず、画像も読みに行かない(ここで触っても外に何も出ない)。
  const doc = new DOMParser().parseFromString(rawHtml, "text/html");
  let hasRemoteImages = false;

  // 消したり付け替えたりしながら回るので、先に一覧を写し取っておく。
  for (const el of Array.from(doc.querySelectorAll("*"))) {
    if (!el.isConnected) continue; // 先に親ごと消えたもの
    const tag = el.localName;
    if (DROP_TAGS.has(tag)) {
      el.remove();
      continue;
    }
    if (UNWRAP_TAGS.has(tag)) {
      el.replaceWith(...Array.from(el.childNodes));
    }

    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on") || DROP_ATTRS.has(name)) {
        el.removeAttribute(attr.name);
        continue;
      }
      if (name === "style") {
        if (DANGEROUS_STYLE.test(attr.value)) el.removeAttribute(attr.name);
        else if (REMOTE_CSS_URL.test(attr.value)) hasRemoteImages = true;
        continue;
      }
      if (name === "href" || name === "xlink:href") {
        const safe = (tag === "a" || tag === "area") && name === "href" ? safeLinkUrl(attr.value) : null;
        if (safe) el.setAttribute("href", safe);
        else el.removeAttribute(attr.name);
        continue;
      }
      if (name === "src" || name === "background" || name === "poster") {
        const isImage = name === "background" || tag === "img" || (tag === "source" && el.parentElement?.localName === "picture");
        if (!isImage) {
          // 動画・音声などは CSP で止まって出せないので、行き先ごと外す。
          el.removeAttribute(attr.name);
          continue;
        }
        const result = resolveImageUrl(attr.value, allowRemoteImages, inlineImages);
        if (result.remote) hasRemoteImages = true;
        if (result.url) el.setAttribute(attr.name, result.url);
        else el.removeAttribute(attr.name);
        continue;
      }
      if (name === "srcset") {
        const remote = /(?:^|,)\s*(?:https?:)?\/\//i.test(attr.value);
        if (remote) hasRemoteImages = true;
        // 外の画像を止めている間は丸ごと外す(候補の1つでも読みに行くと、開いたことが伝わる)。
        if (remote && !allowRemoteImages) el.removeAttribute(attr.name);
        continue;
      }
    }

    if (tag === "a" || tag === "area") {
      if (el.hasAttribute("href")) {
        // 新しいタブで開く。opener を渡さないのは、開いた先のページからこの画面を操作させないため。
        el.setAttribute("target", "_blank");
        el.setAttribute("rel", "noopener noreferrer");
      } else {
        el.removeAttribute("target");
      }
    }
  }

  for (const style of Array.from(doc.querySelectorAll("style"))) {
    if (REMOTE_CSS_URL.test(style.textContent ?? "")) hasRemoteImages = true;
  }

  injectHead(doc, allowRemoteImages);
  return { srcDoc: `<!DOCTYPE html>${doc.documentElement.outerHTML}`, hasRemoteImages };
}

/** 先頭に入れる見た目の土台。メールが何も決めていない所だけを埋める。
 * どれも :where() で包んで強さ(詳細度)を0にしてある — 置き場所を先にするだけでは、
 * 「a[href]」のような書き方がメール側の「.btn{color:#fff}」に勝ってしまい、
 * 黒いボタンの白い文字が青緑に塗り替わっていた。 */
const BASE_STYLE = [
  ":where(html){background:#fff;color-scheme:light}",
  ":where(body){margin:0;padding:12px;color:#141618;font-family:-apple-system,BlinkMacSystemFont,\"Hiragino Sans\",\"Hiragino Kaku Gothic ProN\",\"Noto Sans JP\",sans-serif;font-size:14px;line-height:1.6;overflow-wrap:break-word}",
  // 幅いっぱいを超える画像だけ縮める。width/height の両方があるものは縦横比を保って縮む。
  ":where(img){max-width:100%}",
  ":where(img[width][height]){height:auto}",
  ":where(a[href]){color:#0f736e}",
].join("");

function injectHead(doc: Document, allowRemoteImages: boolean): void {
  const meta = (attrs: Record<string, string>) => {
    const el = doc.createElement("meta");
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
    return el;
  };
  const base = doc.createElement("base");
  // リンクはこの枠の中ではなく、新しいタブで開く(枠の中で外のページが開くと戻れなくなる)。
  base.setAttribute("target", "_blank");
  const style = doc.createElement("style");
  style.textContent = BASE_STYLE;
  // CSP は一番先頭に置く。これより前に書かれたものには効かないため。
  doc.head.prepend(
    meta({ "http-equiv": "Content-Security-Policy", content: mailContentSecurityPolicy(allowRemoteImages) }),
    meta({ name: "referrer", content: "no-referrer" }),
    meta({ "http-equiv": "x-dns-prefetch-control", content: "off" }),
    meta({ name: "color-scheme", content: "light" }),
    base,
    style,
  );
}

/** ブラウザは URL の前後の空白・制御文字と、途中のタブ・改行を読み飛ばす
 * (「java\tscript:」も javascript: として動く)。判定の前に同じように詰めておく。 */
function normalizeUrl(value: string): string {
  return value.replace(/[\u0000- \u007f-\u009f]/g, "");
}

/** リンクとして残してよい行き先だけを返す。それ以外(javascript:・data:・相対パス・ページ内の#)は null。
 * 相対パスと # を外すのは、srcdoc の文書ではこのアプリの URL を基準に解決され、
 * 押すとアプリ自身が枠の中や新しいタブで開いてしまうため。 */
function safeLinkUrl(value: string): string | null {
  const url = normalizeUrl(value);
  if (url.startsWith("//")) return `https:${url}`;
  if (/^(https?|mailto|tel):/i.test(url)) return url;
  return null;
}

interface ResolvedImage {
  /** 付け直す URL。null なら属性ごと外す。 */
  url: string | null;
  /** 外の画像だったか。 */
  remote: boolean;
}

function resolveImageUrl(value: string, allowRemote: boolean, inlineImages: Record<string, string>): ResolvedImage {
  const url = normalizeUrl(value);
  if (/^cid:/i.test(url)) {
    return { url: lookupInlineImage(url.slice(4), inlineImages), remote: false };
  }
  if (/^data:image\//i.test(url)) return { url, remote: false };
  const remote = url.startsWith("//") || /^https?:/i.test(url);
  if (!remote) return { url: null, remote: false };
  if (!allowRemote) return { url: null, remote: true };
  // http の画像は https に直して読む(CSP で https: だけを開けているため)。
  return { url: url.startsWith("//") ? `https:${url}` : url.replace(/^http:/i, "https:"), remote: true };
}

/** cid: の後ろは URL として書かれるので、%エンコードされていることがある。両方で引く。 */
function lookupInlineImage(cid: string, inlineImages: Record<string, string>): string | null {
  if (inlineImages[cid]) return inlineImages[cid];
  try {
    return inlineImages[decodeURIComponent(cid)] ?? null;
  } catch {
    return null;
  }
}
