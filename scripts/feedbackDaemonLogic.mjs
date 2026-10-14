// 修正依頼の常駐見張り(scripts/feedback-daemon.mjs)の「判断」の部分。通信も起動もしない、数えて決めるだけの関数(試験できるよう別に出してある)。
//
// 背景(2026-10-15): 見張りが Claude Code の会話の中にしか無く、会話が閉じていた朝6:33の依頼を1時間以上拾えなかった。
// 本人が「A」を選んだ: 会話の外(launchd)で見張り、届いたら Mac に知らせ、誰も手を付けなければ裏で Claude を起こして直す。
//
// 会話の中の見張り(feedback-watch.mjs)と取り合わないための決まり:
//   ・会話が開いていれば、そちらは数十秒で「対応中」にする。常駐は、届いてから GRACE_MS(既定150秒)たっても「対応待ち」のままの依頼だけ拾う。
//   ・「対応中」の依頼が(会話でも裏でも)あるあいだは、次を始めない。1件ずつ。ただし常駐が「対応中」を見始めてから
//     WORKING_STALE_MS(60分)たっても変わらなければ、止まったものとして数えない(会話が落ちて「対応中」のまま残った時に、ずっと塞がらないように)。
//   ・自動で本番に出すのは1時間に3件まで(todoアプリ/CLAUDE.md の暴走よけ)。常駐が起こした回数と、.fix-times.log の出荷の数の多い方で数える。

export const GRACE_MS = 150_000;
export const WORKING_STALE_MS = 60 * 60_000;
export const MAX_PER_HOUR = 3;
export const HOUR_MS = 60 * 60_000;
/** 同じ依頼に対して常駐が裏の Claude を起こす回数の上限。失敗した依頼を何度も繰り返さない(次は人が見る)。 */
export const MAX_ATTEMPTS = 1;

/** 見たかどうかの鍵(feedback-watch.mjs の seenKey と同じ。質問への答えが届いた依頼は、答えの時刻を付けて別のものとして数える)。 */
export function keyOf(item) {
  return item.answeredAt ? `${item.id}@${item.answeredAt}` : item.id;
}

/**
 * .fix-times.log(ship.sh が出荷のたびに1行足す)から、直近1時間に出荷した件数を数える。
 * 行は「時刻<TAB>コミット<TAB>…」。止まった時の行は2列目が「失敗」なので数えない。時刻は書いた Mac の地元の時刻。
 */
export function shipsInLastHour(fixTimesText, nowMs) {
  let count = 0;
  for (const line of String(fixTimesText ?? "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [at, mark] = line.split("\t");
    if (mark === "失敗") continue;
    const time = new Date(at).getTime();
    if (Number.isFinite(time) && nowMs - time < HOUR_MS && nowMs - time >= 0) count += 1;
  }
  return count;
}

/**
 * いま裏の Claude を起こすか、待つか、見送るかを決める。
 *   unresolved … いま「対応待ち」(status=new)の依頼
 *   all        … 全部の依頼(対応中を見つけるため)。null なら「対応中」は無いとみなす
 *   state      … { firstSeen:{鍵:時刻}, attempts:{鍵:回数}, launches:[時刻…], workingSeen:{id:時刻} }(呼んだ側が持つ。ここでは書き換えない)
 *   ctx        … { now, stopped(止めの印があるか), running(裏の Claude が走っているか), shipsLastHour }
 * 返す形: { action: "wait" | "launch" | "skip", reason, items(起こす時の依頼), remaining(あと何件出してよいか) }
 */
export function decide({ now, unresolved, all, state, stopped, running, shipsLastHour }) {
  const ripe = unresolved.filter((item) => {
    const key = keyOf(item);
    if ((state.attempts[key] ?? 0) >= MAX_ATTEMPTS) return false;
    const seen = state.firstSeen[key];
    return seen !== undefined && now - seen >= GRACE_MS;
  });
  if (ripe.length === 0) return { action: "wait", reason: "届いてまもない(会話の見張りが先に拾えるよう待つ)か、対応待ちはありません", items: [], remaining: 0 };
  if (running) return { action: "wait", reason: "裏の Claude が別の依頼を直している最中です", items: [], remaining: 0 };
  if (stopped) return { action: "skip", reason: "止めの印(.feedback-daemon-STOP)があります", items: ripe, remaining: 0 };

  const working = (all ?? []).filter((item) => item.status === "working").filter((item) => {
    const since = state.workingSeen[item.id];
    return since === undefined || now - since < WORKING_STALE_MS;
  });
  if (working.length > 0) return { action: "wait", reason: `「対応中」の依頼があるあいだは次を始めません(${working.length}件)`, items: [], remaining: 0 };

  const launchesLastHour = state.launches.filter((time) => now - time < HOUR_MS).length;
  const used = Math.max(launchesLastHour, shipsLastHour);
  if (used >= MAX_PER_HOUR) return { action: "skip", reason: `直近1時間に自動で出した数が上限(${MAX_PER_HOUR}件)に達しています`, items: ripe, remaining: 0 };
  return { action: "launch", reason: "会話の見張りが拾わなかったので、裏で直します", items: ripe, remaining: MAX_PER_HOUR - used };
}

/** Mac の通知に出す一行。依頼の文章は、ほかの人が書いたもの — 引用符や制御文字を除き、短く切る(通知の文字列に命令が混ざらないように)。 */
export function snippet(message, max = 36) {
  const clean = String(message ?? "").replace(/[\u0000-\u001f\u007f"'`\\$<>]/g, " ").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

/** 裏の Claude に渡す呼び出し(skill)。依頼の文章は渡さない — 起こされた Claude が feedback-watch.mjs --show で読む(道具の出力として、データの区切り付きで)。 */
export function skillCall(items, remaining) {
  const ids = items.map((item) => item.id).join(" ");
  return `/feedback-fix --remaining ${remaining} ${ids}`;
}

/**
 * 裏の Claude に許す操作。ほかの人が書いた文章を読みながら動くので、「直して出す」に要る操作だけに絞る。
 * 許していない操作(curl・rm・任意の node・ブラウザ・SQL など)は、ヘッドレスでは断られる。
 * ここに無いものが必要になった依頼は、直さず保留にする(skill に書いてある)。
 */
export function allowedTools(appDir) {
  const run = (cmd) => [`Bash(${cmd})`, `Bash(${cmd.replace("scripts/", `${appDir}/scripts/`)})`];
  return [
    "Bash(date:*)",
    ...run("node scripts/feedback-inbox.mjs:*"),
    ...run("node scripts/feedback-watch.mjs --show:*"),
    ...run("node scripts/estimate-fix.mjs:*"),
    ...run("node scripts/ui-check.mjs:*"),
    ...run("node scripts/probe.mjs:*"),
    ...run("node scripts/fix-times.mjs:*"),
    ...run("bash scripts/new-fix.sh:*"),
    ...run("bash scripts/preflight.sh:*"),
    ...run("bash scripts/ship.sh:*"),
    "Bash(npx tsc --noEmit)",
    "Bash(npm test:*)",
    "Bash(npm run test:changed:*)",
    "Bash(npx vitest:*)",
    "Bash(git add:*)",
    "Bash(git commit:*)",
    "Bash(git status:*)",
    "Bash(git diff:*)",
    "Bash(git log:*)",
    "Bash(git show:*)",
    "Bash(git rev-parse:*)",
    "Bash(git ls-remote:*)",
    "Bash(git worktree list:*)",
    "Edit",
    "Write",
  ];
}

/** claude の引数。-p の次に呼び出しを置く(あとの --allowedTools などが呼び出しを巻き込まないように)。 */
export function claudeArgs({ call, appDir, extraDirs }) {
  const args = ["-p", call, "--permission-mode", "acceptEdits", "--allowedTools", allowedTools(appDir).join(",")];
  for (const dir of extraDirs) args.push("--add-dir", dir);
  args.push("--output-format", "stream-json", "--verbose");
  return args;
}

/**
 * 裏の Claude が終わったあとの、依頼ごとの結果。
 *   done    … 対応済み(本番で確かめて閉じた)
 *   asked   … 保留中(質問つきでも可)にした
 *   dismissed … 見送りにした
 *   stuck   … 対応中のまま止まった(→ 呼んだ側が「対応待ち」に戻す)
 *   untouched … 対応待ちのまま(何もされなかった)
 *   gone    … 受信箱に見当たらない
 */
export function outcomeOf(status) {
  return { done: "done", hold: "asked", dismissed: "dismissed", working: "stuck", new: "untouched" }[status] ?? "gone";
}

export const OUTCOME_LABEL = {
  done: "直して本番に出しました",
  asked: "保留にして、送った人に質問しました",
  dismissed: "見送りにしました",
  stuck: "途中で止まったので、対応待ちに戻しました",
  untouched: "手を付けられませんでした",
  gone: "受信箱に見当たりません",
};

/**
 * 裏の Claude の出力(stream-json の1行1件)から、終わりの結果だけを取り出す。無ければ null(途中で落ちた・そもそも始まらなかった)。
 * denials は「許していない操作を断られた」記録 — 許可の足りなさを見つける手がかり。
 */
export function summarizeStream(text) {
  let result = null;
  for (const line of String(text ?? "").split(/\r?\n/)) {
    if (!line.includes('"type":"result"')) continue;
    try {
      const obj = JSON.parse(line);
      if (obj.type === "result") result = obj;
    } catch {
      // 途中で切れた行は読み飛ばす
    }
  }
  if (!result) return null;
  return {
    isError: Boolean(result.is_error),
    text: String(result.result ?? ""),
    denials: (result.permission_denials ?? []).map((d) => `${d.tool_name}: ${JSON.stringify(d.tool_input ?? {}).slice(0, 140)}`),
    turns: result.num_turns ?? null,
    costUsd: result.total_cost_usd ?? null,
  };
}

/** 終わった結果を、Mac の通知に出す短い文にする(件数と、うまくいかなかった分だけ)。 */
export function finishMessage(outcomes) {
  const counts = {};
  for (const outcome of outcomes) counts[outcome] = (counts[outcome] ?? 0) + 1;
  const order = ["done", "asked", "dismissed", "stuck", "untouched", "gone"];
  return order.filter((key) => counts[key]).map((key) => `${counts[key]}件 ${OUTCOME_LABEL[key]}`).join(" / ");
}
