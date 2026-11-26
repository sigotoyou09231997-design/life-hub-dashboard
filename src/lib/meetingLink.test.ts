import { describe, expect, it } from "vitest";
import { eventMeetingLink, findMeetingLink } from "./meetingLink";

describe("会議のリンクを探す", () => {
  it("Zoom のリンクを拾う(サブドメイン付きも)", () => {
    expect(findMeetingLink("https://us02web.zoom.us/j/81234567890?pwd=abc")).toEqual({
      url: "https://us02web.zoom.us/j/81234567890?pwd=abc",
      service: "Zoom",
    });
    expect(findMeetingLink("https://zoom.us/j/123")?.service).toBe("Zoom");
  });

  it("Google Meet・Teams・Webex・Whereby を見分ける", () => {
    expect(findMeetingLink("https://meet.google.com/gge-eoum-hxx")?.service).toBe("Meet");
    expect(findMeetingLink("https://teams.microsoft.com/l/meetup-join/19%3a")?.service).toBe("Teams");
    expect(findMeetingLink("https://teams.live.com/meet/9876")?.service).toBe("Teams");
    expect(findMeetingLink("https://acme.webex.com/meet/taro")?.service).toBe("Webex");
    expect(findMeetingLink("https://whereby.com/room-1")?.service).toBe("Whereby");
  });

  it("日本語の文の中から、句読点や括弧を含めずに切り出す", () => {
    expect(findMeetingLink("一次面接はこちら：https://meet.google.com/abc-defg-hij。よろしくお願いします")?.url).toBe(
      "https://meet.google.com/abc-defg-hij",
    );
    expect(findMeetingLink("（https://zoom.us/j/555）")?.url).toBe("https://zoom.us/j/555");
    expect(findMeetingLink("URL https://zoom.us/j/555 から入ってください")?.url).toBe("https://zoom.us/j/555");
  });

  it("https:// が無い書き方も拾い、https を付けて開く", () => {
    expect(findMeetingLink("meet.google.com/abc-defg-hij")?.url).toBe("https://meet.google.com/abc-defg-hij");
  });

  it("会議サービスではない URL は拾わない(押したら別の所が開く取り違えを防ぐ)", () => {
    expect(findMeetingLink("https://example.com/recruit")).toBeNull();
    expect(findMeetingLink("https://maps.google.com/?q=岡山駅")).toBeNull();
    expect(findMeetingLink("https://evilzoom.us/j/1")).toBeNull();
    expect(findMeetingLink("https://zoom.us.example.com/j/1")).toBeNull();
  });

  it("パスの無い、ただの言及は拾わない", () => {
    expect(findMeetingLink("Zoom(zoom.us)で実施予定、URL は後日")).toBeNull();
    expect(findMeetingLink("https://zoom.us/")).toBeNull();
  });

  it("空・未入力なら null", () => {
    expect(findMeetingLink(undefined, null, "")).toBeNull();
  });

  it("予定からは 場所 → メモ → 名前 の順に探す", () => {
    expect(
      eventMeetingLink({
        title: "面接 https://zoom.us/j/3",
        memo: "https://zoom.us/j/2",
        location: "https://meet.google.com/aaa-bbbb-ccc",
      })?.service,
    ).toBe("Meet");
    expect(eventMeetingLink({ title: "面接", memo: "当日はこちら https://zoom.us/j/2" })?.url).toBe("https://zoom.us/j/2");
    expect(eventMeetingLink({ title: "歯医者", location: "駅前クリニック" })).toBeNull();
  });
});
