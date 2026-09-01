import { describe, expect, it } from "vitest";
import type { EmailStatus } from "../types";
import {
  detectPlanSignals,
  hasPlanKeyword,
  isPlanSuggestion,
  needsPlanText,
  pickPlanSuggestions,
  planSuggestionHint,
} from "./mailPlanSuggestion";

// テストの中の「今日」。実際の今日を使うと、その日が来ただけで結果が変わってしまう。
const TODAY = "2026-09-01"; // 火曜
const RECEIVED = Date.parse("2026-08-19T09:00:00+09:00"); // 水曜

function mail(
  subject: string,
  snippet = "",
  over: { status?: EmailStatus; planSuggestionDismissedAt?: number; receivedAt?: number } = {},
) {
  return {
    subject,
    snippet,
    status: "unprocessed" as EmailStatus,
    receivedAt: Date.parse("2026-08-31T09:00:00+09:00"),
    ...over,
  };
}

describe("detectPlanSignals", () => {
  it("日本語の日付を見つける", () => {
    expect(detectPlanSignals("9月3日にお越しください", RECEIVED).hasDate).toBe(true);
    expect(detectPlanSignals("2026/9/3 開催", RECEIVED).hasDate).toBe(true);
    expect(detectPlanSignals("9/3 でお願いします", RECEIVED).hasDate).toBe(true);
  });

  it("時刻を見つける(コロンでも「時」でも)", () => {
    expect(detectPlanSignals("14:00 開始").hasTime).toBe(true);
    expect(detectPlanSignals("14時30分から").hasTime).toBe(true);
    expect(detectPlanSignals("14時").hasTime).toBe(true);
    expect(detectPlanSignals("午後2時にお願いします").hasTime).toBe(true);
    expect(detectPlanSignals("10時半に集合").hasTime).toBe(true);
  });

  it("「1時間」は時刻として数えない", () => {
    expect(detectPlanSignals("所要は1時間ほどです").hasTime).toBe(false);
  });

  it("全角で書かれていても読む", () => {
    const signals = detectPlanSignals("９月３日（木）１４：００", RECEIVED);
    expect(signals.dates).toEqual(["2026-09-03"]);
    expect(signals.hasTime).toBe(true);
  });

  it("日付も時刻も無ければ、どちらも false", () => {
    const signals = detectPlanSignals("ご請求書を送付いたします");
    expect(signals.hasDate).toBe(false);
    expect(signals.hasTime).toBe(false);
    expect(signals.hints).toEqual([]);
  });

  it("見つけた手がかりを、日付・時刻・言葉の順に並べる", () => {
    expect(detectPlanSignals("一次面接のご案内 9月3日(水) 14:00", RECEIVED).hints).toEqual([
      "9月3日",
      "14:00",
      "面接",
    ]);
  });

  it("間に空白が入っていても読む", () => {
    expect(detectPlanSignals("9 月 3 日 14 : 00", RECEIVED).hints).toEqual(["9月3日", "14:00"]);
  });

  describe("届いた日を基準に、実際の日付へ直す", () => {
    it("「明日」「本日」「明後日」", () => {
      expect(detectPlanSignals("ご予定は明日です", RECEIVED).dates).toEqual(["2026-08-20"]);
      expect(detectPlanSignals("本日18時開始です", RECEIVED).dates).toEqual(["2026-08-19"]);
      expect(detectPlanSignals("明後日お待ちしています", RECEIVED).dates).toEqual(["2026-08-21"]);
    });

    it("「来週の火曜」「金曜日」", () => {
      // 受信は8/19(水)。今週の金曜は8/21、来週の火曜は8/25。
      expect(detectPlanSignals("金曜日はいかがでしょうか", RECEIVED).dates).toEqual(["2026-08-21"]);
      expect(detectPlanSignals("来週の火曜でお願いします", RECEIVED).dates).toEqual(["2026-08-25"]);
    });

    it("月をまたぐ「1月5日」は翌年にする", () => {
      const received = Date.parse("2026-12-28T09:00:00+09:00");
      expect(detectPlanSignals("1月5日にお願いします", received).dates).toEqual(["2027-01-05"]);
    });

    it("月の書かれていない「20日(木)」も読む", () => {
      expect(detectPlanSignals("20日(木)にお越しください", RECEIVED).dates).toEqual(["2026-08-20"]);
    });

    it("候補日が並んでいれば、全部を古い順に返す", () => {
      expect(detectPlanSignals("候補は9月3日・9月5日・9月8日です", RECEIVED).dates).toEqual([
        "2026-09-03",
        "2026-09-05",
        "2026-09-08",
      ]);
    });

    it("「9月3日(水)」の「3日(水)」を、別の日付として二重に数えない", () => {
      expect(detectPlanSignals("9月3日(水) にお越しください", RECEIVED).dates).toEqual(["2026-09-03"]);
    });
  });
});

describe("hasPlanKeyword", () => {
  it("予定になりやすい言葉に反応する", () => {
    expect(hasPlanKeyword("二次面接のご案内")).toBe(true);
    expect(hasPlanKeyword("ご予約が確定しました")).toBe(true);
    expect(hasPlanKeyword("オンラインでの顔合わせについて")).toBe(true);
    expect(hasPlanKeyword("書類の提出期限のご連絡")).toBe(true);
  });

  it("関係の無い文には反応しない", () => {
    expect(hasPlanKeyword("メールマガジンの配信停止について")).toBe(false);
  });
});

describe("isPlanSuggestion", () => {
  it("日付と時刻が揃っていれば提案する", () => {
    expect(isPlanSuggestion(mail("ご連絡", "9月3日 14:00 にお願いします"), TODAY)).toBe(true);
  });

  it("日付と、予定らしい言葉でも提案する(時刻が無くても)", () => {
    expect(isPlanSuggestion(mail("一次面接のご案内", "9月3日にお越しください"), TODAY)).toBe(true);
  });

  it("「明日」のように書かれていても、届いた日から数えて提案する", () => {
    const email = mail("日程のご案内", "ご予定は明日13:15です", { receivedAt: Date.parse("2026-09-01T09:00:00+09:00") });
    expect(isPlanSuggestion(email, TODAY)).toBe(true);
  });

  it("日付が無ければ提案しない", () => {
    expect(isPlanSuggestion(mail("面接のご案内", "日程は追ってご連絡します"), TODAY)).toBe(false);
  });

  it("日付だけで、時刻も予定らしい言葉も無ければ提案しない", () => {
    // 請求書やお知らせを毎回拾わないための線引き。
    expect(isPlanSuggestion(mail("ご請求書の送付", "9月30日付のご請求書を添付いたします"), TODAY)).toBe(false);
  });

  it("件名と抜粋にまたがっていても拾う", () => {
    expect(isPlanSuggestion(mail("面接のご案内", "9月3日にお越しください"), TODAY)).toBe(true);
  });

  it("日付が過ぎたメールは、もう提案しない", () => {
    // 済んだ面接の案内が「予定候補」に残り続けていた(2026-09-01)。
    const email = mail("面接のご案内", "8月20日 13:15 にお越しください", { receivedAt: RECEIVED });
    expect(isPlanSuggestion(email, "2026-08-19")).toBe(true);
    expect(isPlanSuggestion(email, TODAY)).toBe(false);
  });

  it("当日はまだ提案する(その日のうちは残す)", () => {
    const email = mail("面接のご案内", "9月1日 13:15 にお越しください", { receivedAt: RECEIVED });
    expect(isPlanSuggestion(email, TODAY)).toBe(true);
  });

  it("候補日が並ぶメールは、最後の1日が過ぎるまで残す", () => {
    const email = mail("日程調整のお願い", "候補は8月30日・9月5日です", { receivedAt: RECEIVED });
    expect(isPlanSuggestion(email, TODAY)).toBe(true);
  });

  it("宣伝のメールは、日付と言葉が揃っていても提案しない", () => {
    const email = mail("本日開催のセールのご案内", "9月1日 10:00 スタート、参加はこちらから");
    expect(isPlanSuggestion(email, TODAY)).toBe(false);
  });

  it("返信を送り終えたメールも、これからの日付なら提案する", () => {
    // 日程調整は返信した時点で決まるので、そこで候補から外すと予定に入れそびれる。
    expect(isPlanSuggestion(mail("面接のご案内", "9月3日 14:00", { status: "sent" }), TODAY)).toBe(true);
  });

  it("スキップしたメールは提案しない", () => {
    expect(isPlanSuggestion(mail("面接のご案内", "9月3日 14:00", { status: "skipped" }), TODAY)).toBe(false);
  });

  it("「あとで」を押したメールは、もう提案しない", () => {
    expect(isPlanSuggestion(mail("面接のご案内", "9月3日 14:00", { planSuggestionDismissedAt: 1 }), TODAY)).toBe(false);
  });
});

describe("本文の頭(planText)を使う", () => {
  // 実際に届いた人材紹介会社のメール。日時は抜粋(先頭200文字ほど)より後ろにある。
  const AGENCY_SNIPPET =
    "船田様 お世話になります。 AIdea Career株式会社の福井です。 ご返信ありがとうございました。 " +
    "【株式会社アイフリークモバイル】様より 改めて1次面接日時についてご連絡をいただきましたので、下記ご確認ください。 " +
    "※お時間等問題なければ、必ず了承の旨をご返信ください。 ご返信をいただいてからの日程確定となります。";
  const AGENCY_BODY = `${AGENCY_SNIPPET}
＝＝＝＝＝＝＝＝＝＝＝＝＝＝
【株式会社アイフリークモバイル・1次面接】
■日時
・9月4日（金）19：30～20：30
■URL
https://meet.google.com/dsq-khcm-aii
■お持ち物：筆記用具`;

  it("抜粋だけでは日付が読めない案内メールは、本文を取りに行く", () => {
    expect(needsPlanText(mail("1次面接日時のご連絡", AGENCY_SNIPPET))).toBe(true);
  });

  it("本文を取り込んであれば、その日時で候補にする", () => {
    const email = mail("1次面接日時のご連絡", AGENCY_SNIPPET, { receivedAt: RECEIVED });
    expect(isPlanSuggestion(email, TODAY)).toBe(false);
    expect(isPlanSuggestion({ ...email, planText: AGENCY_BODY }, TODAY)).toBe(true);
    expect(planSuggestionHint({ ...email, planText: AGENCY_BODY })).toBe("9月4日・19:30・面接");
  });

  it("抜粋だけで日付が読めるなら、本文は取りに行かない", () => {
    expect(needsPlanText(mail("一次面接のご案内", "9月3日 14:00 にお越しください"))).toBe(false);
  });

  it("予定らしい言葉が無いメールは取りに行かない", () => {
    expect(needsPlanText(mail("ご請求書の送付", "添付をご確認ください"))).toBe(false);
  });

  it("宣伝のメールは取りに行かない", () => {
    expect(needsPlanText(mail("セール開催のお知らせ", "参加はこちらから"))).toBe(false);
  });

  it("一度取りに行ったら、何も取れなくてもやり直さない", () => {
    expect(needsPlanText({ ...mail("1次面接日時のご連絡", AGENCY_SNIPPET), planText: "" })).toBe(false);
  });
});

describe("planSuggestionHint", () => {
  it("見つけたものを中黒でつなぐ", () => {
    expect(
      planSuggestionHint({ subject: "二次面接のご案内", snippet: "9月3日(水) 14:00 当社会議室", receivedAt: RECEIVED }),
    ).toBe("9月3日・14:00・面接");
  });

  it("「明日」は、直した日付の方を出す(一覧では何日か分からないため)", () => {
    expect(planSuggestionHint({ subject: "日程のご案内", snippet: "予定は明日です", receivedAt: RECEIVED })).toBe(
      "8月20日・日程",
    );
  });

  it("何も見つからなければ空", () => {
    expect(planSuggestionHint({ subject: "お知らせ", snippet: "" })).toBe("");
  });
});

describe("pickPlanSuggestions", () => {
  it("提案できるものだけを残す(並びは変えない)", () => {
    const emails = [
      mail("面接のご案内", "9月3日 14:00"),
      mail("メールマガジン", "今週のおすすめ"),
      mail("ご予約確定", "9/10 にお待ちしております"),
    ];
    expect(pickPlanSuggestions(emails, TODAY).map((email) => email.subject)).toEqual(["面接のご案内", "ご予約確定"]);
  });

  it("1件も無ければ空の配列", () => {
    expect(pickPlanSuggestions([mail("お知らせ", "内容")], TODAY)).toEqual([]);
  });
});
