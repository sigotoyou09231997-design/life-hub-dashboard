import { useMemo, useState } from "react";
import { db } from "../../db/schema";
import type { TripRoutePlace, TripScheduleItem } from "../../types";
import { parseLocationRemap, planLocationRemap } from "../../lib/tripLocationRemap";
import { Button } from "../ui/Button";
import { Textarea } from "../ui/Input";
import { useConfirm } from "../ui/ConfirmProvider";
import { PlaceSuggestPanel } from "./PlaceSuggestPanel";
import { useToast } from "../ui/ToastProvider";

interface Props {
  /** AI の提案(旅行の名前・行き先を手がかりにする)。 */
  tripName?: string;
  destination?: string;
  schedule: TripScheduleItem[];
  routePlaces: TripRoutePlace[];
  onClose: () => void;
}

const PLACEHOLDER = "霊山寺 → 霊山寺 徳島県鳴門市大麻町\n小金井駅 → 小金井駅 栃木県下野市";

/**
 * 日程の場所を「元の場所 → 新しい場所」の表でまとめて書き換えるシート
 * (表の読み方と対象は src/lib/tripLocationRemap.ts)。
 * 書き換える前に、どの行が何件に当たるかを見せる。当たらない行(綴りの違いなど)は
 * 黙って捨てず「当たりません」と出す — 直したつもりで直っていないのが一番気づきにくいため。
 */
export function TripLocationRemapSheet({ tripName = "", destination = "", schedule, routePlaces, onClose }: Props) {
  const confirm = useConfirm();
  const showToast = useToast();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const parsed = useMemo(() => parseLocationRemap(text), [text]);
  const plan = useMemo(
    () => planLocationRemap(parsed.rules, schedule, routePlaces),
    [parsed.rules, schedule, routePlaces],
  );
  const total = plan.scheduleCount + plan.routeCount;

  async function handleApply() {
    const ok = await confirm({
      title: `日程${plan.scheduleCount}件・ルート${plan.routeCount}件の場所を書き換えますか?`,
      message: "元に戻すときは、元の場所と新しい場所を入れ替えた表を貼り直します。",
      confirmLabel: "書き換える",
      tone: "default",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await db.transaction("rw", db.tripSchedule, db.tripRoutePlaces, async () => {
        for (const { rule, scheduleIds, endIds, routeIds } of plan.rules) {
          for (const id of scheduleIds) await db.tripSchedule.update(id, { location: rule.to });
          for (const id of endIds) await db.tripSchedule.update(id, { endLocation: rule.to });
          for (const id of routeIds) await db.tripRoutePlaces.update(id, { address: rule.to });
        }
      });
      showToast(`${total}件の場所を書き換えました`);
      onClose();
    } catch (error) {
      console.error("[remap] failed to rewrite locations:", error);
      showToast("書き換えられませんでした");
    } finally {
      setBusy(false);
    }
  }

  /** AI の提案から選んだ行を、対応表に足す(同じ元の場所が先にあれば、その行を置き換える)。 */
  function addLines(lines: string) {
    const incoming = lines.split("\n").filter(Boolean);
    const fromOf = (line: string) => line.split("→")[0].trim();
    const replaced = new Set(incoming.map(fromOf));
    const kept = text.split(/\r\n|\r|\n/).filter((line) => line.trim() && !replaced.has(fromOf(line)));
    setText([...kept, ...incoming].join("\n"));
  }

  return (
    <div className="flex flex-col gap-4">
      <PlaceSuggestPanel tripName={tripName} destination={destination} schedule={schedule} routePlaces={routePlaces} onUse={addLines} />
      <p className="text-sm text-slate-600">
        「元の場所 → 新しい場所」を1行ずつ貼ってください。この旅行の日程とルートの場所のうち、元の場所と
        <span className="font-semibold text-slate-800">ぴったり同じ</span>
        ものだけを、新しい場所に書き換えます。
      </p>

      <Textarea
        label="対応表"
        rows={8}
        spellCheck={false}
        placeholder={PLACEHOLDER}
        value={text}
        onChange={(e) => setText(e.target.value)}
        hint="施設名に都道府県・市区町村を足すと、地図が同じ名前の別の場所を選びにくくなります。「#」で始まる行は読み飛ばします。"
      />

      <Button disabled={total === 0 || busy} onClick={() => void handleApply()}>
        書き換える（日程{plan.scheduleCount}件・ルート{plan.routeCount}件）
      </Button>

      {plan.rules.length > 0 && (
        <ul className="flex flex-col gap-1.5 text-sm" aria-label="書き換えの内容">
          {plan.rules.map(({ rule, scheduleIds, endIds, routeIds }) => {
            const hit = scheduleIds.length + endIds.length + routeIds.length > 0;
            return (
              <li key={rule.from} className={hit ? "text-slate-700" : "text-slate-400"}>
                <span>
                  {rule.from} → {rule.to}
                </span>
                <span className="ml-2 text-xs">
                  {hit
                    ? `日程${scheduleIds.length + endIds.length}件${routeIds.length > 0 ? `・ルート${routeIds.length}件` : ""}`
                    : "当たる場所がありません"}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {parsed.ignored.length > 0 && (
        <div className="rounded-xl bg-amber-50/70 p-3">
          <p className="text-sm font-medium text-slate-700">読み飛ばす行（{parsed.ignored.length}件）</p>
          <ul className="mt-1.5 space-y-0.5 text-sm text-slate-600">
            {parsed.ignored.map((line) => (
              <li key={line.line}>
                {line.line}行目: {line.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
