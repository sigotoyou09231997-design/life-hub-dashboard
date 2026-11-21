// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildAuthUrl } from "./gmail";

/**
 * Google の OAuth 同意画面(ブランディング)に載せる公開ページ(2026-11-21)。
 * 同意画面が「テスト中」だと更新用トークンが7日で切れ、PC・スマホで毎週「つなぎ直す」が出ていた。
 * 「本番」に公開するには、ホームページ・プライバシーポリシーのURLが要る。
 *
 * ログイン無しで開ける静的ページとして public/ に置く(Vercel は実在するファイルを先に返す)。
 * Google に頼む権限を変えたら、プライバシーポリシーの説明も一緒に直すこと — このテストが気づかせる。
 */
const read = (name: string) => readFileSync(join(__dirname, "../../public", name), "utf8");

describe("Google の同意画面に載せる公開ページ", () => {
  it("ホーム・プライバシーポリシー・利用規約が、互いにリンクしている", () => {
    const about = read("about.html");
    const privacy = read("privacy.html");
    const terms = read("terms.html");
    expect(about).toContain('href="/privacy.html"');
    expect(about).toContain('href="/terms.html"');
    expect(privacy).toContain('href="/about.html"');
    expect(terms).toContain('href="/privacy.html"');
  });

  it("アプリが Google に頼む権限は、全部プライバシーポリシーに書いてある", () => {
    const scopes = new URL(buildAuthUrl("state")).searchParams.get("scope")!.split(" ");
    const privacy = read("privacy.html");
    const described: Record<string, string> = {
      "https://www.googleapis.com/auth/gmail.readonly": "gmail.readonly",
      "https://www.googleapis.com/auth/gmail.send": "gmail.send",
      "https://www.googleapis.com/auth/calendar.events": "calendar.events",
      openid: "openid",
      email: "email",
    };
    for (const scope of scopes) {
      expect(described[scope], `${scope} の説明がプライバシーポリシーに無い`).toBeTruthy();
      expect(privacy).toContain(described[scope]);
    }
  });

  it("Google のユーザーデータの方針(限定使用)を書いている", () => {
    expect(read("privacy.html")).toContain("Limited Use");
  });
});
