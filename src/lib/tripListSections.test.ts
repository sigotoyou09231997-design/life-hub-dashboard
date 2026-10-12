import { describe, expect, it } from "vitest";
import type { Trip, TripStatus } from "../types";
import { splitTrips } from "./tripListSections";

function trip(name: string, startDate: string, endDate: string, status: TripStatus = "planning"): Trip {
  return { id: name, name, destination: "", startDate, endDate, status, createdAt: 0 };
}

const TODAY = "2026-10-12";

describe("splitTrips(旅行一覧の並び)", () => {
  it("次に出発する旅行を先頭に、残りを出発の近い順に並べる", () => {
    const { lead, upcoming, past } = splitTrips(
      [trip("沖縄", "2027-03-01", "2027-03-03"), trip("四国", "2026-12-27", "2027-01-02"), trip("京都", "2027-01-20", "2027-01-21")],
      TODAY,
    );
    expect(lead?.name).toBe("四国");
    expect(upcoming.map((t) => t.name)).toEqual(["京都", "沖縄"]);
    expect(past).toEqual([]);
  });

  it("最終日が過ぎた旅行は、「完了」にしていなくても過去の旅行に入れる(新しい順)", () => {
    const { lead, past } = splitTrips(
      [
        trip("札幌", "2026-02-01", "2026-02-03"),
        trip("金沢", "2026-09-01", "2026-09-02", "ongoing"),
        trip("箱根", "2026-05-01", "2026-05-02", "completed"),
        trip("四国", "2026-12-27", "2027-01-02"),
      ],
      TODAY,
    );
    expect(lead?.name).toBe("四国");
    expect(past.map((t) => t.name)).toEqual(["金沢", "箱根", "札幌"]);
  });

  it("出発日を過ぎてまだ終わっていない旅行は、「計画中」のままでも、これから出発する旅行より先に来る", () => {
    const { lead, upcoming } = splitTrips([trip("四国", "2026-12-27", "2027-01-02"), trip("伊豆", "2026-10-11", "2026-10-13")], TODAY);
    expect(lead?.name).toBe("伊豆");
    expect(upcoming.map((t) => t.name)).toEqual(["四国"]);
  });

  it("最終日の当日は、まだ過去にしない", () => {
    const { lead, past } = splitTrips([trip("伊豆", "2026-10-10", TODAY)], TODAY);
    expect(lead?.name).toBe("伊豆");
    expect(past).toEqual([]);
  });

  it("これから行く旅行が無ければ、先頭は空(終わった旅行を「次の旅行」として立てない)", () => {
    const { lead, upcoming, past } = splitTrips([trip("箱根", "2026-05-01", "2026-05-02", "completed")], TODAY);
    expect(lead).toBeNull();
    expect(upcoming).toEqual([]);
    expect(past.map((t) => t.name)).toEqual(["箱根"]);
  });

  it("「旅行中」の印の旅行は、出発日が後でも先頭に立てる", () => {
    const { lead } = splitTrips([trip("四国", "2026-10-12", "2026-10-15"), trip("台湾", "2026-10-13", "2026-10-16", "ongoing")], TODAY);
    expect(lead?.name).toBe("台湾");
  });
});
