import { afterEach, describe, expect, it, vi } from "vitest";
import handler, { espnUrlFor } from "../../api/soccer";

function fakeRes() {
  const res: any = { statusCode: 0, headers: {} as Record<string, string>, body: undefined as unknown };
  res.status = (code: number) => ((res.statusCode = code), res);
  res.json = (body: unknown) => ((res.body = body), res);
  res.setHeader = (k: string, v: string) => void (res.headers[k] = v);
  return res;
}

afterEach(() => vi.unstubAllGlobals());

describe("api/soccer", () => {
  it("決まった形の問い合わせだけを ESPN のアドレスにする", () => {
    expect(espnUrlFor("teams", "eng.1")).toBe("https://site.api.espn.com/apis/v2/sports/soccer/eng.1/standings");
    expect(espnUrlFor("fixtures", "359")).toBe("https://site.api.espn.com/apis/site/v2/sports/soccer/all/teams/359/schedule?fixture=true");
    for (const [kind, value] of [["teams", "../x"], ["teams", "eng.1/../../a"], ["fixtures", "359/x"], ["other", "359"], ["teams", undefined], ["fixtures", ["1", "2"]]]) {
      expect(espnUrlFor(kind, value)).toBeUndefined();
    }
  });

  it("ESPN の答えをそのまま返し、使い回してよいと伝える", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ events: [] }) })));
    const res = fakeRes();
    await handler({ method: "GET", query: { kind: "fixtures", value: "359" } } as any, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ events: [] });
    expect(res.headers["Cache-Control"]).toContain("s-maxage");
  });

  it("形が違う・ESPN が落ちている時は 400 / 502", async () => {
    const bad = fakeRes();
    await handler({ method: "GET", query: { kind: "teams", value: "x" } } as any, bad);
    expect(bad.statusCode).toBe(400);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })));
    const down = fakeRes();
    await handler({ method: "GET", query: { kind: "teams", value: "eng.1" } } as any, down);
    expect(down.statusCode).toBe(502);
    const post = fakeRes();
    await handler({ method: "POST", query: {} } as any, post);
    expect(post.statusCode).toBe(405);
  });
});
