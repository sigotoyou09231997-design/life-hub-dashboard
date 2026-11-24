import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  settings: [] as { id: string; autoTriageEnabled?: boolean }[],
  emails: [] as Record<string, unknown>[],
  pushed: [] as { accountEmail: string; id: unknown; changes: Record<string, unknown> }[],
}));

vi.mock("../db/schema", () => ({
  db: {
    settings: { toCollection: () => ({ first: async () => store.settings[0] }) },
    syncedEmails: {
      where: () => ({ equals: (accountId: string) => ({ toArray: async () => store.emails.filter((e) => e.accountId === accountId) }) }),
      update: async (id: string, patch: Record<string, unknown>) => {
        const row = store.emails.find((e) => e.id === id);
        if (row) Object.assign(row, patch);
      },
    },
  },
}));

// 既読を他の端末へ配る道。本人が既読を押した時と同じ関数を通ることだけ確かめる。
vi.mock("./gmailMessageState", () => ({
  updateMessageState: async (accountEmail: string, email: Record<string, unknown>, changes: Record<string, unknown>) => {
    store.pushed.push({ accountEmail, id: email.id, changes });
    const row = store.emails.find((e) => e.id === email.id);
    if (row) Object.assign(row, changes);
  },
}));

import { autoTriageEmails, classifyAutoTriage } from "./mailAutoTriage";

const mail = (from: string, subject: string, snippet = "") => ({ from, subject, snippet });

describe("classifyAutoTriage: 返事のいらないメールだけを片付ける(2026-11-24 に実際に届いたもの)", () => {
  it.each([
    ["荻野 <t-ogino@r-agent.com>", "【11/24新着おすすめ求人】ＤＢＪデジタルソリューションズ株式会社【リクルートエージェント】"],
    ["荻野 <t-ogino@r-agent.com>", "船田様に株式会社テクノプロのオファーが届いています"],
    ["荻野 <t-ogino@email.mypage.r-agent.com>", "船田様に株式会社テクノプロから再度オファーが届いています"],
    ["荻野 <t-ogino@r-agent.com>", "船田様がご検討中の【株式会社テクノラボ】などの求人一覧"],
    ["type <type_editor@mh.type.jp>", "昨日船田さまに5件いいねが届きました！"],
    ["type <type_editor@mh.type.jp>", "20代に注目されているエンジニア求人"],
    ["type <info_u@ml-type.jp>", "【未読リマインド】応募した企業のメッセージを確認しましょう"],
    ["マイナビ転職 <mtuser@tmn.mynavi.jp>", "2026/11/24【新着】あなたの希望条件に合った求人＆本日の新着求人情報をお届けします【新着求人メール】"],
    ["ミドルの転職 <newjobs@mid-tenshoku.com>", "【11/24 新着】船田様の希望にマッチした求人が掲載されました！"],
    ["アンビ <newjobs@en-ambi.com>", "【11/24 新着情報】船田様の希望条件にマッチした求人が掲載されました！／アンビ（AMBI）"],
    ["エン転職 <agent-mailnews@employment.en-japan.com>", "【エージェントサービス】船田悦司様に新着の求人紹介です（10件） / エン転職"],
    ["Green <info-marketing@mail.green-japan.com>", "船田さん、次に検討いただきたい求人をお送りします"],
    ["Re就活 <rekatsu-mail@gakujo.ne.jp>", "【本日1通】希望条件にマッチした求人案内をお届けします【Ｒｅ就活】"],
    ["ビズリーチ <noreply@bizreach.co.jp>", "「転職しようと思うのは、暇だからだよ」友人が見透かした心 私を変えた言葉【注目コラム】"],
    ["ビズリーチ <noreply@bizreach.co.jp>", "船田様へ 観光に関わる求人特集がまもなく終了します"],
    ["ビズリーチ <noreply@bizreach.co.jp>", "【アンケート結果】初めての転職について"],
    ["SHEIN <shein@email.shein.com>", "デイリー編集、ここから"],
    ["楽天 <rakuten-area-news@emagazine.rakuten.co.jp>", "【ポイント超増量】最大35万ポイント全額もらえるチャンス！"],
    ["セブンマイル <info@sevenmp.omni7.jp>", "【期間限定】大当たりで30マイル カプセルくじ開催中！"],
    ["Indeed <donotreply@jobalert.indeed.com>", "株式会社オープンアップITエンジニアのITエンジニア(クラウド・インフラ構築)の求人と他に新着求人24件"],
  ])("片付ける: %s 「%s」", (from, subject) => {
    expect(classifyAutoTriage(mail(from, subject))).not.toBeNull();
  });

  it.each([
    ["type <noreply@notification.type.jp>", "応募先の企業からメッセージが届きました"],
    ["Green <info@green-japan.com>", "株式会社 ソニックムーブより新しいメッセージが届きました"],
    ["マイナビ転職 <mtuser@mynavi.jp>", "船田 悦司様に企業からメッセージが届きました"],
    ["荻野 <t-ogino@r-agent.com>", "書類選考結果のご連絡　【現在の選考中企業：残り5社】"],
    ["荻野 <t-ogino@r-agent.com>", "※再送※【ご挨拶】リクルートエージェント荻野と申します"],
    ["株式会社SI <abc@candidacy.herp.cloud>", "【株式会社SI】カジュアル面談のご案内"],
    ["採用サポート <saiyou@lfield.co.jp>", "Re: 【書類提出】船田悦司（マイナビ転職よりご応募）"],
    ["Offers <no-reply@offers.jp>", "【Offers（オファーズ）】オファーがきています"],
    ["PCA <pcaid@pcaservice.jp>", "【PCAサービス】2段階認証コード：910495"],
    ["友だち <friend@example.com>", "今週末の件"],
  ])("残す: %s 「%s」", (from, subject) => {
    expect(classifyAutoTriage(mail(from, subject))).toBeNull();
  });

  it("一斉配信の差出人でも、抜粋に面接・日程の話があれば残す", () => {
    expect(
      classifyAutoTriage(mail("Green <info-marketing@mail.green-japan.com>", "ご案内", "面接の日程についてご連絡いたします")),
    ).toBeNull();
  });
});

const NOW = new Date("2026-11-24T18:00:00+09:00").getTime();
const DAY = 24 * 60 * 60 * 1000;

function row(id: string, over: Record<string, unknown>) {
  return { id, accountId: "acc", gmailMessageId: `g-${id}`, status: "unprocessed", receivedAt: NOW - 60_000, snippet: "", ...over };
}

describe("autoTriageEmails", () => {
  beforeEach(() => {
    store.settings = [{ id: "s" }];
    store.emails = [];
    store.pushed = [];
  });

  it("未処理の案内メールだけを既読にし、他の端末へも配る", async () => {
    store.emails = [
      row("1", { from: "マイナビ <mtuser@tmn.mynavi.jp>", subject: "本日の新着求人情報をお届けします" }),
      row("2", { from: "type <noreply@notification.type.jp>", subject: "応募先の企業からメッセージが届きました" }),
    ];
    const count = await autoTriageEmails({ email: "me@example.com" }, "acc", NOW);
    expect(count).toBe(1);
    expect(store.emails[0]).toMatchObject({ readAt: NOW, autoTriagedAt: NOW });
    expect(store.emails[1].readAt).toBeUndefined();
    expect(store.pushed).toEqual([{ accountEmail: "me@example.com", id: "1", changes: { readAt: NOW } }]);
  });

  it("本人が未読に戻したもの(印あり)・既読・重要・送信済み・30日より前は触らない", async () => {
    const from = "マイナビ <mtuser@tmn.mynavi.jp>";
    const subject = "本日の新着求人情報をお届けします";
    store.emails = [
      row("back", { from, subject, autoTriagedAt: NOW - DAY }),
      row("read", { from, subject, readAt: NOW - DAY }),
      row("imp", { from, subject, importantAt: NOW - DAY }),
      row("sent", { from, subject, status: "sent" }),
      row("old", { from, subject, receivedAt: NOW - 31 * DAY }),
    ];
    expect(await autoTriageEmails({ email: "me@example.com" }, "acc", NOW)).toBe(0);
    expect(store.pushed).toEqual([]);
  });

  it("設定で切ってあれば何もしない", async () => {
    store.settings = [{ id: "s", autoTriageEnabled: false }];
    store.emails = [row("1", { from: "マイナビ <mtuser@tmn.mynavi.jp>", subject: "本日の新着求人情報をお届けします" })];
    expect(await autoTriageEmails({ email: "me@example.com" }, "acc", NOW)).toBe(0);
    expect(store.emails[0].readAt).toBeUndefined();
  });
});
