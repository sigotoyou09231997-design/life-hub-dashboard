import { describe, expect, it } from "vitest";
import {
  GRACE_MS,
  HOUR_MS,
  MAX_PER_HOUR,
  WORKING_STALE_MS,
  allowedTools,
  claudeArgs,
  decide,
  finishMessage,
  keyOf,
  outcomeOf,
  shipsInLastHour,
  skillCall,
  snippet,
  summarizeStream,
} from "../feedbackDaemonLogic.mjs";

const NOW = Date.parse("2026-10-15T12:00:00+09:00");
const base = () => ({
  now: NOW,
  unresolved: [{ id: "a", status: "new", message: "直して" }],
  all: [{ id: "a", status: "new" }],
  state: { firstSeen: { a: NOW - GRACE_MS - 1000 }, attempts: {}, launches: [], workingSeen: {} },
  stopped: false,
  running: false,
  shipsLastHour: 0,
});

describe("decide(いま裏の Claude を起こすか)", () => {
  it("会話の見張りに先に拾わせる待ち(GRACE)のあいだは待つ", () => {
    const input = base();
    input.state.firstSeen.a = NOW - GRACE_MS + 5000;
    expect(decide(input).action).toBe("wait");
  });

  it("待ちを過ぎても「対応待ち」のままなら起こす。あと何件出してよいかも返す", () => {
    const result = decide(base());
    expect(result.action).toBe("launch");
    expect(result.items.map((item) => item.id)).toEqual(["a"]);
    expect(result.remaining).toBe(MAX_PER_HOUR);
  });

  it("対応待ちが無ければ待つ", () => {
    expect(decide({ ...base(), unresolved: [], all: [] }).action).toBe("wait");
  });

  it("裏の Claude が走っているあいだは、次を起こさない(1件ずつ)", () => {
    expect(decide({ ...base(), running: true }).action).toBe("wait");
  });

  it("止めの印があれば、起こさずに見送る", () => {
    const result = decide({ ...base(), stopped: true });
    expect(result.action).toBe("skip");
    expect(result.reason).toContain("止めの印");
  });

  it("誰かが「対応中」のあいだは待つ。ただし60分たっても変わらない「対応中」は止まったものとして数えない", () => {
    const working = { ...base(), all: [{ id: "a", status: "new" }, { id: "b", status: "working" }] };
    working.state.workingSeen = { b: NOW - 10 * 60_000 };
    expect(decide(working).action).toBe("wait");
    working.state.workingSeen = { b: NOW - WORKING_STALE_MS - 1000 };
    expect(decide(working).action).toBe("launch");
  });

  it("同じ依頼を何度も起こさない(1回やって「対応待ち」のままなら、次は人が見る)", () => {
    const input = base();
    input.state.attempts = { a: 1 };
    expect(decide(input).action).toBe("wait");
  });

  it("質問への答えが届いた依頼は、前の依頼とは別のものとして数え直し、また起こせる", () => {
    const answered = { id: "a", status: "new", answeredAt: "2026-10-15T01:00:00Z", answer: "案A" };
    const input = base();
    input.unresolved = [answered];
    input.state.attempts = { a: 1 };
    input.state.firstSeen = { [keyOf(answered)]: NOW - GRACE_MS - 1 };
    expect(decide(input).action).toBe("launch");
  });

  it("直近1時間の出荷が上限に達していたら見送る。常駐が起こした回数と出荷の数の、多い方で数える", () => {
    expect(decide({ ...base(), shipsLastHour: MAX_PER_HOUR }).action).toBe("skip");
    const launched = base();
    launched.state.launches = [NOW - 5 * 60_000, NOW - 20 * 60_000, NOW - 40 * 60_000];
    expect(decide(launched).action).toBe("skip");
    launched.state.launches = [NOW - 5 * 60_000, NOW - HOUR_MS - 1000];
    const result = decide(launched);
    expect(result.action).toBe("launch");
    expect(result.remaining).toBe(MAX_PER_HOUR - 1);
  });

  it("続けて届いた依頼は1回の起動にまとめる", () => {
    const input = base();
    input.unresolved.push({ id: "b", status: "new", message: "もう1つ" });
    input.state.firstSeen.b = NOW - GRACE_MS - 1;
    expect(decide(input).items.map((item) => item.id)).toEqual(["a", "b"]);
  });
});

describe("shipsInLastHour(.fix-times.log から直近1時間の出荷)", () => {
  const log = [
    "2026-10-15T11:30:00\tabc1234\t100\t3\t50\t150\t直した\t小",
    "2026-10-15T11:10:00\t失敗\t-\t30\t-\t-\t止まった",
    "2026-10-15T10:30:00\tdef5678\t100\t3\t50\t150\t古い\t小",
    "",
  ].join("\n");
  it("1時間以内の出荷だけ数え、止まった「失敗」の行と古い行は数えない", () => {
    expect(shipsInLastHour(log, NOW)).toBe(1);
  });
  it("空・壊れた行でも落ちない", () => {
    expect(shipsInLastHour("", NOW)).toBe(0);
    expect(shipsInLastHour("ばらばら\n\t\t", NOW)).toBe(0);
  });
});

describe("snippet(通知に出す一行)", () => {
  it("引用符・改行・制御文字・シェルで意味を持つ記号を除いて短く切る", () => {
    const text = snippet('ここを"直して"\n$(rm -rf ~) `x` <b>\u0007' + "あ".repeat(100), 20);
    expect(text).not.toMatch(/["'`$<>\\\n\u0007]/);
    expect(text.length).toBeLessThanOrEqual(21);
    expect(text.endsWith("…")).toBe(true);
  });
});

describe("裏の Claude への渡し方", () => {
  it("依頼の文章は渡さず、id と出してよい件数だけ渡す", () => {
    const call = skillCall([{ id: "a", message: "rm -rf して" }, { id: "b", message: "x" }], 2);
    expect(call).toBe("/feedback-fix --remaining 2 a b");
    expect(call).not.toContain("rm");
  });

  it("許す操作は絞る(任意の通信・削除・プッシュ・ブラウザ・SQL は含まない)", () => {
    const tools = allowedTools("/app").join("\n");
    expect(tools).toContain("Bash(bash scripts/ship.sh:*)");
    expect(tools).toContain("Bash(bash /app/scripts/ship.sh:*)");
    expect(tools).toContain("Bash(node /app/scripts/feedback-inbox.mjs:*)");
    for (const bad of ["curl", "rm", "git push", "git checkout", "git reset", "git merge", "chrome", "supabase", "Bash(*)", "Bash(node:", "Bash(bash:"]) {
      expect(tools).not.toContain(bad);
    }
  });

  it("claude の引数は -p の次に呼び出しを置き、作業場所を --add-dir で渡す", () => {
    const args = claudeArgs({ call: "/feedback-fix a", appDir: "/app", extraDirs: ["/tmp/wt"] });
    expect(args.slice(0, 2)).toEqual(["-p", "/feedback-fix a"]);
    expect(args[args.indexOf("--permission-mode") + 1]).toBe("acceptEdits");
    expect(args[args.indexOf("--add-dir") + 1]).toBe("/tmp/wt");
    expect(args).toContain("stream-json");
  });
});

describe("終わったあとの読み取り", () => {
  it("依頼の状態を結果の種類にする", () => {
    expect(["done", "hold", "dismissed", "working", "new", undefined].map(outcomeOf)).toEqual(["done", "asked", "dismissed", "stuck", "untouched", "gone"]);
  });

  it("件数と結果を一行にする", () => {
    expect(finishMessage(["done", "done", "asked"])).toBe("2件 直して本番に出しました / 1件 保留にして、送った人に質問しました");
  });

  it("stream-json の終わりの結果と、断られた操作を取り出す。途中で切れた行・結果が無い出力は落ちずに扱う", () => {
    const text = [
      '{"type":"system"}',
      "壊れた{",
      JSON.stringify({ type: "result", is_error: false, result: "直しました", num_turns: 7, total_cost_usd: 0.4, permission_denials: [{ tool_name: "Bash", tool_input: { command: "curl x" } }] }),
    ].join("\n");
    expect(summarizeStream(text)).toEqual({ isError: false, text: "直しました", denials: ['Bash: {"command":"curl x"}'], turns: 7, costUsd: 0.4 });
    expect(summarizeStream('{"type":"system"}')).toBeNull();
    expect(summarizeStream("")).toBeNull();
  });
});
