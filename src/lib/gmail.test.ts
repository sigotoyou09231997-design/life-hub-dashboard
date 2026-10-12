import { describe, expect, it, vi } from "vitest";
import {
  attachmentsTotalBytes,
  buildSyncSummary,
  describeGmailConnectError,
  base64UrlDecode,
  base64UrlEncode,
  buildRawMessage,
  decodeHtmlEntities,
  encodeHeaderWord,
  extractMessageContent,
  extractPlainText,
  findInlineImageParts,
  htmlToText,
  isHtmlOnlyNotice,
  isUnhandledEmail,
  mapWithConcurrency,
  snippetText,
} from "./gmail";

describe("base64UrlEncode/base64UrlDecode", () => {
  it("round-trips ASCII text", () => {
    const text = "Hello, world!";
    expect(base64UrlDecode(base64UrlEncode(text))).toBe(text);
  });

  it("round-trips Japanese text", () => {
    const text = "こんにちは、これはテストメールです。";
    expect(base64UrlDecode(base64UrlEncode(text))).toBe(text);
  });

  it("produces URL-safe output with no padding", () => {
    const encoded = base64UrlEncode("any carnal pleasure.");
    expect(encoded).not.toMatch(/[+/=]/);
  });
});

describe("encodeHeaderWord", () => {
  it("leaves plain ASCII text untouched", () => {
    expect(encodeHeaderWord("Re: Meeting notes")).toBe("Re: Meeting notes");
  });

  it("encodes non-ASCII text as an RFC 2047 encoded-word", () => {
    const encoded = encodeHeaderWord("Re: 会議のお知らせ");
    expect(encoded).toMatch(/^=\?UTF-8\?B\?.+\?=$/);
  });
});

describe("buildRawMessage", () => {
  const headers = { to: "taro@example.com", subject: "テスト" };

  it("builds a plain text/plain message when there are no attachments", () => {
    const raw = buildRawMessage(headers, "本文です", []);
    expect(raw).toContain("To: taro@example.com");
    expect(raw).toContain("Content-Type: text/plain; charset=UTF-8");
    expect(raw).not.toContain("multipart/mixed");
    expect(raw.endsWith("本文です")).toBe(true);
  });

  it("builds a multipart/mixed message with a boundary-delimited attachment part", () => {
    const raw = buildRawMessage(headers, "本文です", [{ filename: "test.txt", mimeType: "text/plain", base64Data: "aGVsbG8=" }]);
    expect(raw).toMatch(/Content-Type: multipart\/mixed; boundary="([^"]+)"/);
    const boundary = raw.match(/boundary="([^"]+)"/)?.[1];
    expect(boundary).toBeTruthy();
    // Body text and the attachment's base64 payload both appear as separate parts.
    expect(raw).toContain("本文です");
    expect(raw).toContain("aGVsbG8=");
    expect(raw).toContain('Content-Disposition: attachment; filename="test.txt"');
    expect(raw).toContain("Content-Transfer-Encoding: base64");
    // The message ends with the closing boundary marker.
    expect(raw.trim().endsWith(`--${boundary}--`)).toBe(true);
  });

  it("wraps a long base64 attachment payload at 76 characters per line", () => {
    const longBase64 = "A".repeat(200);
    const raw = buildRawMessage(headers, "本文", [{ filename: "big.bin", mimeType: "application/octet-stream", base64Data: longBase64 }]);
    const wrappedLines = raw.split("\r\n").filter((line) => /^A+$/.test(line));
    expect(wrappedLines.every((line) => line.length <= 76)).toBe(true);
    expect(wrappedLines.join("")).toBe(longBase64);
  });

  it("includes multiple attachments as separate parts", () => {
    const raw = buildRawMessage(headers, "本文", [
      { filename: "a.txt", mimeType: "text/plain", base64Data: "YQ==" },
      { filename: "b.txt", mimeType: "text/plain", base64Data: "Yg==" },
    ]);
    expect(raw).toContain('filename="a.txt"');
    expect(raw).toContain('filename="b.txt"');
  });
});

describe("attachmentsTotalBytes", () => {
  it("sums the byte sizes of a list of files", () => {
    const files = [new File(["a".repeat(10)], "a.txt"), new File(["b".repeat(20)], "b.txt")];
    expect(attachmentsTotalBytes(files)).toBe(30);
  });

  it("returns 0 for an empty list", () => {
    expect(attachmentsTotalBytes([])).toBe(0);
  });
});

describe("mapWithConcurrency", () => {
  it("同時に走る本数を上限までに抑える", async () => {
    const items = Array.from({ length: 10 }, (_, i) => i);
    let running = 0;
    let peak = 0;
    const done: number[] = [];

    await mapWithConcurrency(items, 3, async (item) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 1));
      done.push(item);
      running--;
    });

    expect(peak).toBeLessThanOrEqual(3);
    expect(done.sort((a, b) => a - b)).toEqual(items);
  });

  it("空の配列でも止まらない", async () => {
    const run = vi.fn();
    await mapWithConcurrency([], 3, run);
    expect(run).not.toHaveBeenCalled();
  });
});

describe("isUnhandledEmail", () => {
  it("重要を付けたものは「すべて」から外す(重要タブへ移す)", () => {
    // 押しても「すべて」に残っていると、移した実感が無い。
    expect(isUnhandledEmail({ status: "unprocessed", importantAt: 1_000 })).toBe(false);
    expect(isUnhandledEmail({ status: "unprocessed", importantAt: undefined })).toBe(true);
  });

  it("未読でまだ返信していないメールは残す", () => {
    expect(isUnhandledEmail({ status: "unprocessed" })).toBe(true);
    expect(isUnhandledEmail({ status: "drafted" })).toBe(true);
    expect(isUnhandledEmail({ status: "edited" })).toBe(true);
  });

  it("既読にしたメールは外す", () => {
    expect(isUnhandledEmail({ status: "unprocessed", readAt: 1_700_000_000_000 })).toBe(false);
  });

  it("返信を送ったメールは、未読のままでも外す", () => {
    expect(isUnhandledEmail({ status: "sent" })).toBe(false);
  });
});

describe("buildSyncSummary", () => {
  const none = {
    freshAdded: 0,
    handledElsewhere: 0,
    blockedAdded: 0,
    reconciled: 0,
    removed: 0,
    pushedStates: 0,
    pulledStates: 0,
    failed: 0,
    deferred: 0,
  };

  it("一覧に出る新着だけを「新着メール」として数える", () => {
    expect(buildSyncSummary({ ...none, freshAdded: 3 })).toBe("3件の新着メールしました");
  });

  // 実際に出た不具合(2026-08-24): 取り込んだ7件が全て他の端末で既読済みだったのに
  // 「7件の新着メール」と出て、一覧には何も増えていなかった。
  it("他の端末で処理済みの分は新着に数えず、理由を添える", () => {
    expect(buildSyncSummary({ ...none, handledElsewhere: 7 })).toBe(
      "新着メールはありませんでした(7件は他の端末で処理済み(既読・送信済みタブ))",
    );
  });

  it("ブロック中の送信者の分も新着に数えない", () => {
    expect(buildSyncSummary({ ...none, blockedAdded: 2 })).toBe(
      "新着メールはありませんでした(2件はブロック中の送信者)",
    );
  });

  it("新着と、出ない分が混ざる場合は両方を出す", () => {
    expect(buildSyncSummary({ ...none, freshAdded: 1, handledElsewhere: 4, blockedAdded: 2 })).toBe(
      "1件の新着メールしました(4件は他の端末で処理済み(既読・送信済みタブ)・2件はブロック中の送信者)",
    );
  });

  it("何も無ければこれまでどおりの文言", () => {
    expect(buildSyncSummary(none)).toBe("新着メールはありませんでした");
  });

  it("取得できなかった分・持ち越した分はこれまでどおり伝える", () => {
    expect(buildSyncSummary({ ...none, freshAdded: 2, failed: 1, deferred: 30 })).toBe(
      "2件の新着メール・1件は取得できず次回に持ち越し・残り30件は次回の同期で取り込みしました",
    );
  });
});

describe("describeGmailConnectError", () => {
  it("サーバーに接続情報が無い場合は、どの環境変数かまで伝える", () => {
    expect(describeGmailConnectError(new Error("Google OAuth is not configured on the server"))).toContain(
      "GOOGLE_CLIENT_ID",
    );
  });

  it("リダイレクトURIの不一致は、どこを見ればよいかまで伝える", () => {
    expect(describeGmailConnectError(new Error("Google token exchange failed: redirect_uri_mismatch"))).toContain(
      "リダイレクトURI",
    );
  });

  it("認証コードの期限切れは、やり直せばよいと伝える", () => {
    expect(describeGmailConnectError(new Error('{"error":"invalid_grant"}'))).toContain("もう一度やり直して");
  });

  it("テストユーザー未登録で断られた場合は、その設定を指す", () => {
    expect(describeGmailConnectError(new Error("access_denied"))).toContain("テストユーザー");
  });

  it("当てはまるものが無ければ、元のメッセージをそのまま出す", () => {
    // 知らない失敗を「連携に失敗しました」で潰すと、設定を直しようがなくなる。
    expect(describeGmailConnectError(new Error("Googleがrefresh_tokenを返しませんでした"))).toBe(
      "Googleがrefresh_tokenを返しませんでした",
    );
  });
});

describe("htmlToText", () => {
  it("<style>の中のCSSは本文として残さない", () => {
    // サーバーは本文の先頭12,000文字しかAIに渡さない。CSSで先頭が埋まると、
    // 日時が書いてあるのにAIまで届かず「見つかりませんでした」になっていた。
    const text = htmlToText(
      "<html><head><style>.x{color:#fff;font-size:14px}</style></head><body><p>9月3日 10:00 一次面接</p></body></html>",
    );
    expect(text).not.toContain("font-size");
    expect(text).toContain("9月3日 10:00 一次面接");
  });

  it("<script>と<!--コメント-->も落とす", () => {
    const text = htmlToText("<script>var a=1;</script><!-- 配信ID:12345 --><p>面接のご案内</p>");
    expect(text).not.toContain("var a");
    expect(text).not.toContain("配信ID");
    expect(text).toContain("面接のご案内");
  });

  it("改行になるタグは改行にする(表組みの日時が1行に潰れないように)", () => {
    const text = htmlToText("<tr><td>9月3日</td></tr><tr><td>9月10日</td></tr>");
    expect(text.split("\n").map((line) => line.trim())).toEqual(["9月3日", "9月10日"]);
  });

  it("文字参照は元の文字に戻す", () => {
    expect(htmlToText("<p>10:00&nbsp;&#12316;&nbsp;11:00 A&amp;B&#x30d3;ル</p>")).toBe("10:00 〜 11:00 A&Bビル");
  });

  it("範囲外の文字参照はそのまま残す(落とさない)", () => {
    expect(htmlToText("<p>&#99999999;面接</p>")).toBe("&#99999999;面接");
  });
});

describe("snippetText / decodeHtmlEntities", () => {
  it("一覧の抜粋の &amp; などを元の字に戻す(Gmail API の抜粋は文字参照のまま届く)", () => {
    expect(snippetText("Agoda.com ホテル &amp; 一軒家")).toBe("Agoda.com ホテル & 一軒家");
    expect(snippetText("&lt;予約番号&gt; &quot;特集&quot; It&#39;s")).toBe("<予約番号> \"特集\" It's");
  });

  it("数字の文字参照(10進・16進)も戻す", () => {
    expect(snippetText("&#12304;特集&#12305; &#x1F4DA; &#X30D3;ル")).toBe("【特集】 📚 ビル");
  });

  it("1回だけ戻す — 「&amp;lt;」は「&lt;」で止まり、「<」まで戻さない", () => {
    // メールに「&lt;」という文字そのものが書いてある時、Gmail は「&amp;lt;」で返す。
    expect(snippetText("HTMLでは &amp;lt; と書く")).toBe("HTMLでは &lt; と書く");
    expect(decodeHtmlEntities("&amp;amp;")).toBe("&amp;");
  });

  it("知らない名前・範囲外の数字・文字参照でない & はそのまま残す", () => {
    expect(decodeHtmlEntities("&copy; &#99999999; AT&T Q&A & と")).toBe("&copy; &#99999999; AT&T Q&A & と");
  });
});

describe("extractPlainText", () => {
  const part = (mimeType: string, text: string) => ({ mimeType, body: { data: base64UrlEncode(text) } });

  it("平文の部分があればそれを読む", () => {
    const payload = {
      mimeType: "multipart/alternative",
      parts: [part("text/plain", "9月3日 10:00 一次面接"), part("text/html", "<p>読まない</p>")],
    };
    expect(extractPlainText(payload)).toBe("9月3日 10:00 一次面接");
  });

  it("平文がHTMLより後ろにあっても、平文を先に読む", () => {
    // 添付付き(multipart/mixed)では、この並びになることがある。手前から順に
    // 最初に見つかった方を返していた頃は、HTMLの方を読んでいた。
    const payload = {
      mimeType: "multipart/mixed",
      parts: [
        { mimeType: "multipart/related", parts: [part("text/html", "<p>HTML版</p>")] },
        part("text/plain", "平文版"),
      ],
    };
    expect(extractPlainText(payload)).toBe("平文版");
  });

  it("平文が空の時はHTMLを文章に直して読む", () => {
    const payload = {
      mimeType: "multipart/alternative",
      parts: [part("text/plain", "   "), part("text/html", "<p>9月3日 10:00 一次面接</p>")],
    };
    expect(extractPlainText(payload)).toBe("9月3日 10:00 一次面接");
  });

  it("読めるものが無ければ空で返す", () => {
    expect(extractPlainText(undefined)).toBe("");
    expect(extractPlainText({ mimeType: "multipart/mixed", parts: [] })).toBe("");
  });

  it("平文が「HTMLで見てください」の案内だけなら、HTMLの方を文章に直して読む", () => {
    // 日本のメルマガに多い形。平文を優先していた頃は、画面にもAIにもこの一文しか届いていなかった。
    const payload = {
      mimeType: "multipart/alternative",
      parts: [
        part("text/plain", "このメールはHTML形式で配信しています。HTMLメールを表示できる環境でご覧ください。"),
        part("text/html", "<p>秋のセールのお知らせ</p><p>10月20日(月)から10月26日(日)まで、全品20%オフです。</p>"),
      ],
    };
    expect(extractPlainText(payload)).toContain("10月20日(月)から10月26日(日)まで");
  });
});

describe("isHtmlOnlyNotice", () => {
  it("HTMLで見るよう促すだけの短い文を案内とみなす", () => {
    expect(isHtmlOnlyNotice("このメールはHTMLメールです。HTML形式で表示できるメーラーでご覧ください。")).toBe(true);
    expect(isHtmlOnlyNotice("※本メールはHTML形式です。正しく表示されない場合はブラウザでご覧ください")).toBe(true);
    expect(isHtmlOnlyNotice("This is an HTML email. Please use an HTML-capable email client to view it.")).toBe(true);
  });

  it("中身のある平文や、HTMLと関係のない文は案内とみなさない", () => {
    expect(isHtmlOnlyNotice("")).toBe(false);
    expect(isHtmlOnlyNotice("9月3日 10:00 一次面接のご案内です。ご都合をお知らせください。")).toBe(false);
    // 長い文は本物の本文(案内の一文がたまたま含まれていても、平文のまま読む)。
    expect(isHtmlOnlyNotice(`HTML形式で表示できない場合はこちら。${"本文".repeat(200)}`)).toBe(false);
  });
});

describe("extractMessageContent", () => {
  const part = (mimeType: string, text: string) => ({ mimeType, body: { data: base64UrlEncode(text) } });

  it("平文とHTMLの両方があれば、文章は平文・HTMLも持つ・最初は文章で見せる", () => {
    const content = extractMessageContent({
      mimeType: "multipart/alternative",
      parts: [part("text/plain", "平文の本文"), part("text/html", "<p>HTMLの本文</p>")],
    });
    expect(content).toEqual({ text: "平文の本文", html: "<p>HTMLの本文</p>", preferHtml: false });
  });

  it("HTMLしか無いメールは、最初から元の見た目で見せる", () => {
    const content = extractMessageContent(part("text/html", "<p>HTMLだけの本文</p>"));
    expect(content).toEqual({ text: "HTMLだけの本文", html: "<p>HTMLだけの本文</p>", preferHtml: true });
  });

  it("平文が案内だけのメールも、最初から元の見た目で見せる", () => {
    const content = extractMessageContent({
      mimeType: "multipart/alternative",
      parts: [part("text/plain", "HTMLメールが表示できない場合は、ブラウザでご覧ください。"), part("text/html", "<p>本当の本文がここにあります</p>")],
    });
    expect(content.preferHtml).toBe(true);
    expect(content.text).toBe("本当の本文がここにあります");
  });

  it("平文しか無いメールは今までどおり(HTMLは空)", () => {
    expect(extractMessageContent(part("text/plain", "平文だけ"))).toEqual({ text: "平文だけ", html: "", preferHtml: false });
  });
});

describe("findInlineImageParts", () => {
  it("Content-ID の付いた画像の部分だけを集める(山かっこは外す)", () => {
    const payload = {
      mimeType: "multipart/related",
      parts: [
        { mimeType: "text/html", body: { data: base64UrlEncode('<img src="cid:logo@x">') } },
        {
          mimeType: "image/png",
          headers: [{ name: "Content-ID", value: "<logo@x>" }],
          body: { data: "AAAA", size: 3 },
        },
        {
          mimeType: "image/jpeg",
          headers: [{ name: "content-id", value: "<photo@x>" }],
          body: { attachmentId: "att-1", size: 120000 },
        },
        // Content-ID の無い添付は、本文の中に出てこないので取らない。
        { mimeType: "image/png", filename: "a.png", headers: [], body: { attachmentId: "att-2", size: 10 } },
      ],
    };
    expect(findInlineImageParts(payload)).toEqual([
      { contentId: "logo@x", mimeType: "image/png", data: "AAAA", attachmentId: undefined, size: 3 },
      { contentId: "photo@x", mimeType: "image/jpeg", data: undefined, attachmentId: "att-1", size: 120000 },
    ]);
  });
});
