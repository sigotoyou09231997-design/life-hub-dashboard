import { describe, expect, it } from "vitest";
import { parseSoccerMatch, soccerCrestUrl } from "./soccerMatch";

describe("parseSoccerMatch", () => {
  it("取り込んだ試合から、チームのid・題名・大会・U-NEXTを読む", () => {
    const m = parseSoccerMatch({
      title: "⚽ リバプール vs アーセナル",
      memo: "プレミアリーグ\n配信: U-NEXT(サッカーパック)でライブ配信\n日本時間・ESPN の日程から自動で入れた予定です\nESPN#401 (364-359)",
    });
    expect(m).toEqual({
      espnId: "401",
      homeId: "364",
      awayId: "359",
      title: "リバプール vs アーセナル",
      homeName: "リバプール",
      awayName: "アーセナル",
      competition: "プレミアリーグ",
      unext: true,
    });
  });

  it("チームのidが無い古い予定も試合として読む(紋章だけ出せない)", () => {
    const m = parseSoccerMatch({ title: "⚽ A vs B", memo: "UEFAチャンピオンズリーグ リーグフェーズ\nESPN#9" });
    expect(m).toMatchObject({ espnId: "9", title: "A vs B", competition: "UEFAチャンピオンズリーグ リーグフェーズ", unext: false });
    expect(m?.homeId).toBeUndefined();
    expect(m).toMatchObject({ homeName: "A", awayName: "B" });
  });

  it("ふつうの予定は null。メモの先頭が配信の行なら大会名にしない", () => {
    expect(parseSoccerMatch({ title: "歯医者", memo: "メモ" })).toBeNull();
    expect(parseSoccerMatch({ title: "歯医者" })).toBeNull();
    expect(parseSoccerMatch({ title: "⚽ A vs B", memo: "配信: U-NEXT\nESPN#1" })?.competition).toBeUndefined();
  });

  it("「 vs 」が無い題名は、全体をホーム側の名前にする", () => {
    expect(parseSoccerMatch({ title: "⚽ 特別試合", memo: "ESPN#2" })).toMatchObject({ homeName: "特別試合" });
    expect(parseSoccerMatch({ title: "⚽ 特別試合", memo: "ESPN#2" })?.awayName).toBeUndefined();
  });

  it("紋章のアドレス", () => {
    expect(soccerCrestUrl("359")).toBe("https://a.espncdn.com/combiner/i?img=/i/teamlogos/soccer/500/359.png&w=64&h=64");
  });
});
