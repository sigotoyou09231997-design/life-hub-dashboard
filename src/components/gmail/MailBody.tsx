import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildSafeMailHtml } from "../../lib/mailHtml";

/** HTMLメールを入れる枠の sandbox。
 *
 * allow-scripts は絶対に付けない — これが無い限り、メールの中のスクリプトはブラウザが
 * 一切動かさない(下ごしらえ側の取り除きが漏れても止まる、一番外側の守り)。
 * allow-same-origin は、この画面から枠の中の高さを測って枠を中身の高さに合わせるため
 * (スクリプトが動かない枠なので、同じ出どころ扱いでも中から外は触れない)。
 * allow-popups と allow-popups-to-escape-sandbox は、メールの中のリンクを新しいタブで
 * 普通のページとして開くため。 */
export const MAIL_FRAME_SANDBOX = "allow-same-origin allow-popups allow-popups-to-escape-sandbox";

/** 横幅が決め打ち(600px など)のメールを、枠の幅に収まるまで縮める下限。
 * これより小さくすると文字が読めないので、残りは枠の中で横に動かして読む。 */
const MIN_FIT_ZOOM = 0.5;

interface MailHtmlFrameProps {
  srcDoc: string;
}

/** 安全にしたHTMLメールを、スクリプトの動かない枠に入れて見せる。
 * 枠の中にスクロールを作らず、中身の高さに合わせて伸ばす(ページごと普通にスクロールできるように)。 */
export function MailHtmlFrame({ srcDoc }: MailHtmlFrameProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const lastWidthRef = useRef(0);

  const fit = useCallback(() => {
    const frame = frameRef.current;
    const doc = frame?.contentDocument;
    const root = doc?.documentElement;
    if (!frame || !doc?.body || !root) return;
    lastWidthRef.current = frame.clientWidth;

    // 幅に収まらないメールは、Gmail のアプリと同じく全体を縮めて枠に収める。
    root.style.removeProperty("zoom");
    const available = frame.clientWidth;
    if (available > 0 && root.scrollWidth > available + 1) {
      // はみ出した時の横幅には、右側の余白(body の padding)が入らない。足さずに縮めると
      // 右端だけ余白の無い、片寄った見た目になる。
      const bodyStyle = doc.defaultView?.getComputedStyle(doc.body);
      const rightGap = (parseFloat(bodyStyle?.paddingRight ?? "") || 0) + (parseFloat(bodyStyle?.marginRight ?? "") || 0);
      root.style.setProperty("zoom", String(Math.max(MIN_FIT_ZOOM, available / (root.scrollWidth + rightGap))));
    }

    // いったん高さを0にしてから測る。そのまま測ると、幅が広がって中身が短くなった時も
    // 前の高さが「中身の高さ」として返り、下に余白が残り続けるため。
    frame.style.height = "0px";
    const scrollbar = root.scrollWidth > root.clientWidth + 1 ? 16 : 0;
    frame.style.height = `${Math.ceil(root.scrollHeight) + scrollbar + 2}px`;
  }, []);

  // 画面の回転・幅の変化で折り返しが変わるので、幅が変わった時だけ測り直す
  // (高さの変化にまで反応すると、自分で伸ばした高さに反応して回り続ける)。
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (frame.clientWidth !== lastWidthRef.current) fit();
    });
    observer.observe(frame);
    return () => observer.disconnect();
  }, [fit]);

  // 読み込みが終わった直後に加えて、少し後にもう一度測る(文字の組み直しが遅れて
  // 高さが変わることがあるため)。
  const timerRef = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timerRef.current), []);
  const handleLoad = useCallback(() => {
    fit();
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(fit, 400);
  }, [fit]);

  return (
    <div className="mail-html-frame-wrap">
      <iframe
        ref={frameRef}
        className="mail-html-frame"
        title="メールの本文"
        sandbox={MAIL_FRAME_SANDBOX}
        referrerPolicy="no-referrer"
        srcDoc={srcDoc}
        onLoad={handleLoad}
      />
    </div>
  );
}

interface MailBodyProps {
  loading: boolean;
  /** 文章としての本文(取れなかった時は一覧の抜粋)。 */
  text: string;
  /** text が一覧の抜粋の時 true。 */
  isFallback: boolean;
  /** HTMLの部分(無ければ空)。保存はせず、この画面を開いている間だけ持つ。 */
  html: string;
  /** 平文が無い・「HTMLで見てください」の案内だけ、で最初から元の見た目で見せるか。 */
  preferHtml: boolean;
  /** 同封画像(cid:)の対応表。 */
  inlineImages: Record<string, string>;
}

/** メール画面の本文。文章で見るか、元の見た目(HTML)で見るかを切り替えられる。
 *
 * 平文のあるメールは今までどおり文章で出し、HTMLもあれば「元の見た目で見る」を出す。
 * 平文が無い・案内だけのメールは、最初から元の見た目で出す。どちらの時も、外の画像は
 * 本人が「画像を表示する」を押すまで読み込まない。
 * メールを切り替えた時に前のメールの選択を持ち越さないよう、呼び出し側でメールごとに key を変える。 */
export function MailBody({ loading, text, isFallback, html, preferHtml, inlineImages }: MailBodyProps) {
  // null = まだ本人が選んでいない(メールの形に合わせた既定で出す)。
  const [chosenView, setChosenView] = useState<"text" | "html" | null>(null);
  const [showImages, setShowImages] = useState(false);

  const canShowHtml = !loading && html.length > 0;
  const view = canShowHtml ? (chosenView ?? (preferHtml ? "html" : "text")) : "text";

  // 文章で見ている間は、HTMLの下ごしらえ自体をしない(長いメルマガで無駄に重くしない)。
  const safeHtml = useMemo(
    () => (view === "html" ? buildSafeMailHtml(html, { allowRemoteImages: showImages, inlineImages }) : null),
    [view, html, showImages, inlineImages],
  );

  if (loading) {
    return <div className="whitespace-pre-wrap break-words text-sm text-slate-700">本文を読み込み中...</div>;
  }

  const imagesBlocked = view === "html" && !!safeHtml?.hasRemoteImages && !showImages;

  return (
    <div>
      {isFallback && view === "text" && <p className="mb-2 text-xs text-slate-400">本文は保存済みの抜粋を表示しています</p>}
      {canShowHtml && (
        // ボタンは1つずつ分けて並べる(1つの溝に詰めない — 本人の好み)。
        <div className="mail-body-tools">
          <button type="button" className="mail-body-tool" onClick={() => setChosenView(view === "html" ? "text" : "html")}>
            {view === "html" ? "文字だけで見る" : "元の見た目で見る"}
          </button>
          {imagesBlocked && (
            <button type="button" className="mail-body-tool" onClick={() => setShowImages(true)}>
              画像を表示する
            </button>
          )}
        </div>
      )}
      {imagesBlocked && (
        <p className="mail-body-note">
          画像は止めています。画像を開くと、メールを開いたことが送り主に伝わる場合があるためです。
        </p>
      )}
      {view === "html" && safeHtml ? (
        <MailHtmlFrame srcDoc={safeHtml.srcDoc} />
      ) : (
        <div className="whitespace-pre-wrap break-words text-sm text-slate-700">
          {/* 画像だけのメルマガは、文章に直すと何も残らない。空白のままだと壊れて見えるので一言添える。 */}
          {text || (canShowHtml ? "文字の部分はありません。「元の見た目で見る」で読めます。" : "")}
        </div>
      )}
    </div>
  );
}
