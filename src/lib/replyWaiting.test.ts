import { describe, expect, it } from "vitest";
import type { SyncedEmail } from "../types";
import { pickReplyWaiting, replyWaitingForCompany, sentAtOf } from "./replyWaiting";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 15, 0, 0, 0);
const accounts = [{ id: "acc-1", email: "me@example.com" }];

let seq = 0;
function mail(overrides: Partial<SyncedEmail>): SyncedEmail {
  seq += 1;
  return {
    id: `mail-${seq}`,
    accountId: "acc-1",
    gmailMessageId: `g-${seq}`,
    threadId: "thread-1",
    from: "株式会社サンプル 採用担当 <recruit@sample.co.jp>",
    subject: "面接日程のご案内",
    snippet: "",
    receivedAt: NOW - 10 * DAY,
    status: "unprocessed",
    createdAt: NOW - 10 * DAY,
    ...overrides,
  };
}

describe("pickReplyWaiting", () => {
  it("返信を送ってから3日以上、相手から返事が無いやり取りを出す", () => {
    const replied = mail({ status: "sent" });
    const items = pickReplyWaiting([replied], [{ emailId: replied.id!, sentAt: NOW - 4 * DAY }], accounts, NOW);
    expect(items).toEqual([{ email: replied, sentAt: NOW - 4 * DAY, waitingDays: 4 }]);
  });

  it("送ってから日が浅いうちは出さない", () => {
    const replied = mail({ status: "sent" });
    expect(pickReplyWaiting([replied], [{ emailId: replied.id!, sentAt: NOW - 2 * DAY }], accounts, NOW)).toEqual([]);
  });

  it("相手から返事が来たら外れる(同じスレッドに、まだ返信していない新しい受信がある)", () => {
    const replied = mail({ status: "sent" });
    const answer = mail({ receivedAt: NOW - 1 * DAY, subject: "Re: 面接日程のご案内" });
    expect(
      pickReplyWaiting([replied, answer], [{ emailId: replied.id!, sentAt: NOW - 5 * DAY }], accounts, NOW),
    ).toEqual([]);
  });

  it("送った時刻が遅れて記録されていても、その前に届いていた相手の返事で外れる", () => {
    // Gmail側で送った返信は、次の同期で見つかった時刻が sentAt になる。相手の返事がその間に
    // 届いていても、「一番新しい受信に返信済みか」で見るので取り違えない。
    const replied = mail({ status: "sent", receivedAt: NOW - 9 * DAY });
    const answer = mail({ receivedAt: NOW - 6 * DAY });
    expect(
      pickReplyWaiting([replied, answer], [{ emailId: replied.id!, sentAt: NOW - 4 * DAY }], accounts, NOW),
    ).toEqual([]);
  });

  it("相手の返事にもまた返信したら、そこから数え直す", () => {
    const first = mail({ status: "sent", receivedAt: NOW - 9 * DAY });
    const second = mail({ status: "sent", receivedAt: NOW - 6 * DAY });
    const items = pickReplyWaiting(
      [first, second],
      [
        { emailId: first.id!, sentAt: NOW - 8 * DAY },
        { emailId: second.id!, sentAt: NOW - 5 * DAY },
      ],
      accounts,
      NOW,
    );
    expect(items).toHaveLength(1);
    expect(items[0].email.id).toBe(second.id);
    expect(items[0].waitingDays).toBe(5);
  });

  it("自分から自分に届いたメールは、相手の返事として数えない", () => {
    const replied = mail({ status: "sent" });
    const self = mail({ from: "Me <ME@example.com>", receivedAt: NOW - 1 * DAY });
    const items = pickReplyWaiting([replied, self], [{ emailId: replied.id!, sentAt: NOW - 4 * DAY }], accounts, NOW);
    expect(items.map((item) => item.email.id)).toEqual([replied.id]);
  });

  it("別のスレッドのメールは関係ない", () => {
    const replied = mail({ status: "sent" });
    const other = mail({ threadId: "thread-2", receivedAt: NOW - 1 * DAY });
    const items = pickReplyWaiting([replied, other], [{ emailId: replied.id!, sentAt: NOW - 4 * DAY }], accounts, NOW);
    expect(items.map((item) => item.email.id)).toEqual([replied.id]);
  });

  it("待っている日数の長い順に並べる", () => {
    const a = mail({ status: "sent", threadId: "t-a" });
    const b = mail({ status: "sent", threadId: "t-b" });
    const items = pickReplyWaiting(
      [a, b],
      [
        { emailId: a.id!, sentAt: NOW - 3 * DAY },
        { emailId: b.id!, sentAt: NOW - 7 * DAY },
      ],
      accounts,
      NOW,
    );
    expect(items.map((item) => item.email.id)).toEqual([b.id, a.id]);
  });
});

describe("sentAtOf", () => {
  it("下書きの送信時刻が無い(ほかの端末で送った)時は、状態を変えた時刻で数える", () => {
    expect(sentAtOf({ stateUpdatedAt: 5, receivedAt: 1 })).toBe(5);
    expect(sentAtOf({ stateUpdatedAt: 5, receivedAt: 1 }, 9)).toBe(9);
    expect(sentAtOf({ receivedAt: 1 })).toBe(1);
  });
});

describe("replyWaitingForCompany", () => {
  it("差出人・件名に会社名が出てくる返信待ちを、応募先に結び付ける", () => {
    const replied = mail({ status: "sent" });
    const items = pickReplyWaiting([replied], [{ emailId: replied.id!, sentAt: NOW - 4 * DAY }], accounts, NOW);
    expect(replyWaitingForCompany("株式会社サンプル", items)?.email.id).toBe(replied.id);
    expect(replyWaitingForCompany("サンプル", items)?.email.id).toBe(replied.id);
    expect(replyWaitingForCompany("別の会社", items)).toBeUndefined();
  });
});
