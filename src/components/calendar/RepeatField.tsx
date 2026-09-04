import { useState } from "react";
import type { RepeatRule } from "../../types";
import { WEEKDAY_LABELS, makeWeekdayRepeat, parseWeekdayRepeat } from "../../lib/repeatRule";
import { SegmentedField } from "../ui/SegmentedField";

interface Props {
  value: RepeatRule;
  onChange: (value: RepeatRule) => void;
}

/** 上の段の選択肢。曜日指定は「曜日」を選んでから、下の段で曜日を選ぶ2段構えにする —
 * 曜日7つを他の選択肢と同じ段に並べると、1行で11個になって指で押せない。 */
type Mode = "none" | "daily" | "weekly" | "monthly" | "weekdays";

const MODE_OPTIONS = [
  { value: "none" as Mode, label: "しない" },
  { value: "daily" as Mode, label: "毎日" },
  { value: "weekly" as Mode, label: "毎週" },
  { value: "monthly" as Mode, label: "毎月" },
  { value: "weekdays" as Mode, label: "曜日" },
];

function modeOf(value: RepeatRule): Mode {
  if (parseWeekdayRepeat(value)) return "weekdays";
  if (value === "daily" || value === "weekly" || value === "monthly") return value;
  return "none";
}

/** 予定・タスクの繰り返し欄。決め打ちの4つに加えて、曜日を複数選べる。 */
export function RepeatField({ value, onChange }: Props) {
  const mode = modeOf(value);
  const selectedDays = parseWeekdayRepeat(value) ?? [];
  // 「曜日」を選んだ直後はまだ1つも選べていない。その状態を repeat には書かず
  // (書くと "none" に潰れて上の段の選択が戻ってしまう)、この画面の中だけで覚える。
  const [weekdayMode, setWeekdayMode] = useState(mode === "weekdays");
  const showWeekdays = mode === "weekdays" || weekdayMode;

  function handleMode(next: Mode) {
    setWeekdayMode(next === "weekdays");
    if (next === "weekdays") {
      // すでに選んだ曜日があればそれを保つ。無ければ曜日が決まるまで "none" のまま。
      onChange(selectedDays.length > 0 ? makeWeekdayRepeat(selectedDays) : "none");
      return;
    }
    onChange(next);
  }

  function toggleDay(day: number) {
    const next = selectedDays.includes(day) ? selectedDays.filter((d) => d !== day) : [...selectedDays, day];
    onChange(makeWeekdayRepeat(next));
  }

  return (
    <>
      <SegmentedField label="繰り返し" value={mode} options={MODE_OPTIONS} onChange={handleMode} columns={3} />
      {showWeekdays && (
        <div>
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAY_LABELS.map((label, day) => {
              const on = selectedDays.includes(day);
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => toggleDay(day)}
                  aria-pressed={on}
                  aria-label={`${label}曜日`}
                  className={`h-9 w-9 rounded-full border text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
                    on ? "border-accent bg-accent text-white" : "border-slate-200 text-slate-500"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
          {selectedDays.length === 0 && (
            <p className="mt-1.5 text-xs text-slate-400">曜日を選ぶまでは繰り返しません。</p>
          )}
        </div>
      )}
    </>
  );
}
