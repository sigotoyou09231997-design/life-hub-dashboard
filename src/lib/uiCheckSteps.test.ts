// @vitest-environment node
import { describe, expect, it } from "vitest";

// scripts/uiCheckSteps.mjs(型の無い素の JS)なので、動的に読む。
// @ts-expect-error 型の宣言が無い JS ファイルを読む(試験でだけ)
const load = async () => (await import("../../scripts/uiCheckSteps.mjs")) as unknown as {
  parseStep: (text: string) => Record<string, any>;
  parseTarget: (text: string) => Record<string, any>;
  parseStub: (text: string) => { real: string; stub: string };
  asMatcher: (text: string) => string | RegExp;
};

describe("ui-check の操作の読み方", () => {
  it("役割+名前で押す。名前は文字でも /正規表現/ でも書ける", async () => {
    const { parseStep } = await load();
    expect(parseStep("click:role:button:この予定をコピーして追加")).toMatchObject({ action: "click", target: { kind: "role", role: "button", name: "この予定をコピーして追加", pick: null } });
    const re = parseStep("click:role:button:/昼食.*を編集/").target.name as RegExp;
    expect(re).toBeInstanceOf(RegExp);
    expect(re.test("昼食（湯葉）を編集")).toBe(true);
  });

  it("末尾の @first / @last / @nth=N で、複数の当たりを1つに絞る", async () => {
    const { parseTarget } = await load();
    expect(parseTarget("role:button:予定を追加@last").pick).toEqual({ last: true });
    expect(parseTarget("css:.card@first").pick).toEqual({ first: true });
    expect(parseTarget("text:入れる@nth=2").pick).toEqual({ nth: 2 });
    expect(parseTarget("text:入れる").pick).toBeNull();
  });

  it("入れる・文字の確認は、最後の「=」より後ろが値", async () => {
    const { parseStep } = await load();
    expect(parseStep("fill:placeholder:例: 五稜郭=霊山寺")).toMatchObject({ action: "fill", value: "霊山寺", target: { kind: "placeholder", value: "例: 五稜郭" } });
    expect(parseStep("expect-text:css:h1=旅行計画")).toMatchObject({ action: "expect-text", value: "旅行計画" });
  });

  it("待つ・キー・画像は、「:」のあとをそのまま渡す", async () => {
    const { parseStep } = await load();
    expect(parseStep("wait:800")).toMatchObject({ action: "wait", arg: "800" });
    expect(parseStep("press:Enter")).toMatchObject({ action: "press", arg: "Enter" });
    expect(parseStep("shot:/tmp/probe/a.png")).toMatchObject({ action: "shot", arg: "/tmp/probe/a.png" });
  });

  it("書き方が違えば、何が違うかを言って止まる(黙って違う所を押さない)", async () => {
    const { parseStep, parseTarget, parseStub } = await load();
    expect(() => parseStep("押す")).toThrow(/操作:場所/);
    expect(() => parseStep("tap:text:x")).toThrow(/知らない操作/);
    expect(() => parseStep("fill:text:x")).toThrow(/=値/);
    expect(() => parseTarget("button")).toThrow(/種類:中身/);
    expect(() => parseTarget("xpath:/a")).toThrow(/知らない場所の種類/);
    expect(() => parseStub("src/lib/a.ts")).toThrow(/元のファイル=差し替えのファイル/);
  });

  it("差し替えは「元=差し替え」", async () => {
    const { parseStub } = await load();
    expect(parseStub("src/lib/appFeedback.ts=.stubs/appFeedback.ts")).toEqual({ real: "src/lib/appFeedback.ts", stub: ".stubs/appFeedback.ts" });
  });
});
