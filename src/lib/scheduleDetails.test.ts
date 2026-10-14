import { describe, expect, it } from "vitest";
import { detailsForSave, formatPhone, formatPhoneTyping, hasScheduleDetails, mapQueryFor, normalizeUrl, phoneLabel, telHref, urlLabel } from "./scheduleDetails";

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

describe("formatPhone(電話用のテンキーにはハイフンが無いので、こちらで入れる)", () => {
  it("日本の番号は、局番の長さに合わせて区切る", () => {
    expect(formatPhone("0886870613")).toBe("088-687-0613");
    expect(formatPhone("09012345678")).toBe("090-1234-5678");
    expect(formatPhone("0312345678")).toBe("03-1234-5678");
    expect(formatPhone("0120123456")).toBe("0120-123-456");
  });

  it("全角の数字や、すでにハイフンが入っていても同じ形にそろえる", () => {
    expect(formatPhone("０８８６８７０６１３")).toBe("088-687-0613");
    expect(formatPhone("088-687-0613")).toBe("088-687-0613");
    expect(formatPhone("+81886870613")).toBe("088-687-0613");
  });

  it("番号として読めない・言葉が混ざっている時は、打ったまま", () => {
    expect(formatPhone("088687")).toBe("088687");
    expect(formatPhone("088-687-0613(代表)")).toBe("088-687-0613(代表)");
    expect(formatPhone("  ")).toBe("");
  });

  it("保存する時にも入れる(欄を離れずに保存を押した時のため)", () => {
    expect(detailsForSave("sightseeing", { address: "", phone: "0886870613", url: "", openingHours: "", checkInTime: "", checkOutTime: "" }).phone).toBe(
      "088-687-0613",
    );
  });
});

describe("formatPhoneTyping(打っている間にハイフンを入れる)", () => {
  it("数字を足すたびに、局番に合わせて区切っていく", () => {
    let value = "";
    const typed: string[] = [];
    for (const digit of "0886870613") {
      value = formatPhoneTyping(value + digit, value);
      typed.push(value);
    }
    expect(typed).toEqual(["0", "08", "088", "088-6", "088-68", "088-687", "088-687-0", "088-687-06", "088-687-061", "088-687-0613"]);
  });

  it("消している時は触らない(消したハイフンが戻って消せなくならないように)", () => {
    expect(formatPhoneTyping("088-", "088-6")).toBe("088-");
    expect(formatPhoneTyping("088-68", "088-687")).toBe("088-68");
  });

  it("内線などの言葉が混ざっていたら、打ったまま(言葉を落とさない)", () => {
    expect(formatPhoneTyping("088-687-0613 内線1", "088-687-0613 内線")).toBe("088-687-0613 内線1");
    expect(formatPhoneTyping("0886870613(代", "0886870613(")).toBe("0886870613(代");
  });
});

describe("phoneLabel(一覧に出す電話番号)", () => {
  it("ハイフン無しで保存してある番号も、ハイフン付きで見せる", () => {
    expect(phoneLabel("0886870613")).toBe("088-687-0613");
    expect(phoneLabel("088-687-0613")).toBe("088-687-0613");
  });

  it("番号として読めなければ、保存してあるまま", () => {
    expect(phoneLabel("088-687-0613(代表)")).toBe("088-687-0613(代表)");
    expect(phoneLabel("088687")).toBe("088687");
  });
});

describe("mapQueryFor(地図・経路に渡す文字。住所が入っていれば住所)", () => {
  it("詳細の住所があれば住所、無ければ場所。どちらも無ければ undefined", () => {
    expect(mapQueryFor({ location: "霊山寺", address: "徳島県鳴門市大麻町板東塚鼻126" })).toBe("徳島県鳴門市大麻町板東塚鼻126");
    expect(mapQueryFor({ location: "霊山寺", address: "  " })).toBe("霊山寺");
    expect(mapQueryFor({ location: " 霊山寺 " })).toBe("霊山寺");
    expect(mapQueryFor({ address: "徳島県鳴門市" })).toBe("徳島県鳴門市");
    expect(mapQueryFor({})).toBeUndefined();
    expect(mapQueryFor({ location: "  ", address: "" })).toBeUndefined();
  });

  it("先頭の郵便番号・余計な空白は外す", () => {
    expect(mapQueryFor({ address: "〒779-0230 徳島県鳴門市大麻町  板東塚鼻126" })).toBe("徳島県鳴門市大麻町 板東塚鼻126");
    expect(mapQueryFor({ address: "7790230 徳島県鳴門市" })).toBe("徳島県鳴門市");
    expect(mapQueryFor({ address: "〒 779-0230\u3000徳島県鳴門市" })).toBe("徳島県鳴門市");
  });
});
