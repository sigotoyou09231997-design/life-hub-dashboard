import type { TripRoutePlace, TripScheduleItem } from "../types";

/**
 * 日程の「場所」を、「元の場所 → 新しい場所」の表でまとめて書き換える。
 *
 * 場所が「霊山寺」のように名前だけだと、Googleマップやマイマップは同じ名前の別の場所
 * (奈良のお寺など)を選んでしまう。施設名に都道府県・市区町村を足した形
 * (「霊山寺 徳島県鳴門市大麻町」)なら迷わない。60か所を1つずつ編集し直す代わりに、
 * 表を貼って一度に直せるようにする。
 *
 * 書き換えるのは、この旅行の日程(TripScheduleItem.location)と、ルートの場所
 * (TripRoutePlace.address)のうち、元の場所と**ぴったり同じ**もの。ルートは日程の場所を
 * そのまま住所に写して作るので、日程だけ直すと「ルートに入っている場所」と
 * 「日程にある場所」が食い違い、日程の場所がまたルートの候補に出てしまう。
 */
export interface RemapRule {
  from: string;
  to: string;
}

export interface IgnoredLine {
  /** 貼った文章の何行目か(1始まり)。 */
  line: number;
  text: string;
  reason: string;
}

export interface ParsedRemap {
  rules: RemapRule[];
  ignored: IgnoredLine[];
}

export interface PlannedRule {
  rule: RemapRule;
  scheduleIds: string[];
  routeIds: string[];
}

export interface RemapPlan {
  rules: PlannedRule[];
  scheduleCount: number;
  routeCount: number;
}

/** 「元 → 新」の区切り。タブも許すのは、表計算ソフトから2列を貼ったときにタブで区切られるため。 */
const SEPARATOR = /→|->|=>|\t/;

/** 新しい場所の欄に「載せない」と書いてある行。地図に出さない場所の印で、場所の文字ではない。 */
const SKIP_MARKS = new Set(["(載せない)", "（載せない）", "載せない"]);

export function parseLocationRemap(text: string): ParsedRemap {
  const rules: RemapRule[] = [];
  const ignored: IgnoredLine[] = [];
  const seen = new Set<string>();

  text.split(/\r\n|\r|\n/).forEach((raw, index) => {
    const line = index + 1;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) return;

    const reject = (reason: string) => ignored.push({ line, text: trimmed, reason });

    const match = SEPARATOR.exec(trimmed);
    if (!match) return void reject("「→」がありません");
    const from = trimmed.slice(0, match.index).trim();
    const to = trimmed.slice(match.index + match[0].length).trim();

    if (!from) return void reject("元の場所が空です");
    if (!to) return void reject("新しい場所が空です");
    if (SKIP_MARKS.has(to)) return void reject("「載せない」は書き換えません");
    if (from === to) return void reject("元と新しい場所が同じです");
    if (seen.has(from)) return void reject("同じ元の場所が2回あります(最初の行を使います)");

    seen.add(from);
    rules.push({ from, to });
  });

  return { rules, ignored };
}

/** どの日程・ルートの場所が、どの行で書き換わるかを決める。まだ何も書き換えない。 */
export function planLocationRemap(
  rules: RemapRule[],
  schedule: TripScheduleItem[],
  routePlaces: TripRoutePlace[],
): RemapPlan {
  const planned = rules.map((rule) => ({
    rule,
    scheduleIds: schedule.filter((item) => item.id && item.location?.trim() === rule.from).map((item) => item.id!),
    routeIds: routePlaces.filter((place) => place.id && place.address.trim() === rule.from).map((place) => place.id!),
  }));
  return {
    rules: planned,
    scheduleCount: planned.reduce((sum, p) => sum + p.scheduleIds.length, 0),
    routeCount: planned.reduce((sum, p) => sum + p.routeIds.length, 0),
  };
}
