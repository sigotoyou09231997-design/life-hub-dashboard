import { describe, expect, it } from "vitest";
import { detailsForSave, hasScheduleDetails, normalizeUrl, telHref, urlLabel } from "./scheduleDetails";

const empty = { address: "", phone: "", url: "", openingHours: "", checkInTime: "", checkOutTime: "" };

describe("予定の詳細", () => {
  it("URL の頭が無ければ https:// を付ける(付いていればそのまま、空は無し)", () => {
    expect(normalizeUrl("www.uzusio.com")).toBe("https://www.uzusio.com");
    expect(normalizeUrl(" http://example.com/a ")).toBe("http://example.com/a");
    expect(normalizeUrl("HTTPS://Example.com")).toBe("HTTPS://Example.com");
    expect(normalizeUrl("   ")).toBeUndefined();
  });

  it("電話は数字と+だけ残して tel: にする。短すぎる・番号が無い時は作らない", () => {
    expect(telHref("088-687-0613")).toBe("tel:0886870613");
    expect(telHref("０８８（６８７）０６１３")).toBe("tel:0886870613");
    expect(telHref("+81 88 687 0613")).toBe("tel:+81886870613");
    expect(telHref("なし")).toBeUndefined();
    expect(telHref(undefined)).toBeUndefined();
  });

  it("URL は一覧では短く(www. を外したホスト)", () => {
    expect(urlLabel("https://www.uzusio.com/cruise/")).toBe("uzusio.com");
    expect(urlLabel("not a url")).toBe("not a url");
  });

  it("保存する形: 空は無し、チェックイン/アウトは宿泊の時だけ", () => {
    const values = { ...empty, address: " 徳島県鳴門市 ", url: "example.com", checkInTime: "15:00", checkOutTime: "10:00", openingHours: "9:00〜17:00" };
    expect(detailsForSave("sightseeing", values)).toEqual({
      address: "徳島県鳴門市", phone: undefined, url: "https://example.com", openingHours: "9:00〜17:00", checkInTime: undefined, checkOutTime: undefined,
    });
    expect(detailsForSave("lodging", values)).toMatchObject({ checkInTime: "15:00", checkOutTime: "10:00" });
  });

  it("詳細があるかどうか", () => {
    expect(hasScheduleDetails(undefined)).toBe(false);
    expect(hasScheduleDetails({})).toBe(false);
    expect(hasScheduleDetails({ phone: "1" })).toBe(true);
  });
});
