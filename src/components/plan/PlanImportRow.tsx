import { Check, TriangleAlert } from "lucide-react";
import type { PlanDestination, TripImportRow } from "../../lib/mailPlanImport";
import type { TripScheduleType } from "../../types";
import { TRIP_SCHEDULE_TYPES } from "../../lib/tripCategories";
import { Input } from "../ui/Input";
import { Select } from "../ui/Select";
import { SwitchField } from "../ui/SwitchField";
import { DateField } from "../ui/DateField";
import { Field } from "../ui/Field";

interface Props {
  row: TripImportRow;
  /** 何に起こすか。項目の見出しと、出す欄がこれで変わる。 */
  destination: Exclude<PlanDestination, "route">;
  /** 同じ内容が入れ先に既にある。チェックできなくする。 */
  already: boolean;
  /** 旅行の期間から外れた日付。入れられるが、日程表には出てこないので印を出す。 */
  outside: boolean;
  /** 金額が読み取れなかった時に、費用のスイッチに出す注記。 */
  missingAmountHint: string;
  onChange: (changes: Partial<TripImportRow>) => void;
}

/**
 * AIが読み取った1件を、確認・修正してから入れるための行。
 *
 * 読み取った内容をそのまま保存しないのがこの画面の要点 — 日付や時刻の読み違いが
 * そのまま入ると、当日それを信じて動いてしまう。メールからの取り込み
 * (src/components/gmail/MailPlanImport.tsx)と、旅行計画の写真・文章からの取り込み
 * (src/components/trips/TripPlanScanForm.tsx)で同じ行を使う。
 */
export function PlanImportRow({ row, destination, already, outside, missingAmountHint, onChange }: Props) {
  return (
    <div className={`glass-row space-y-2 rounded-xl p-3 ${already ? "opacity-70" : ""}`}>
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={row.checked && !already}
          disabled={already}
          onChange={(e) => onChange({ checked: e.target.checked })}
          aria-label={`${row.title}を入れる`}
          className="mt-1 h-4 w-4 shrink-0 accent-[color:var(--hub-accent,#4f6fff)] disabled:opacity-50"
        />
        <span className="min-w-0 flex-1 text-sm font-medium text-slate-900">{row.title}</span>
      </label>

      {already && (
        <p className="flex items-start gap-1.5 px-1 text-xs leading-relaxed text-success">
          <Check size={13} className="mt-0.5 shrink-0" />
          すでに登録されています
        </p>
      )}

      {row.checked && !already && (
        <div className="space-y-2">
          <Input
            label={destination === "task" ? "やること" : "内容"}
            value={row.title}
            onChange={(e) => onChange({ title: e.target.value })}
          />
          <DateField
            label={destination === "task" ? "期限" : "日付"}
            value={row.date}
            onChange={(date) => onChange({ date })}
          />
          <Field label={destination === "task" ? "時刻" : "開始 → 終了"} as="div">
            {destination === "task" ? (
              <input
                type="time"
                aria-label="時刻"
                className="field-shell"
                value={row.startTime ?? ""}
                onChange={(e) => onChange({ startTime: e.target.value })}
              />
            ) : (
              // 予定フォーム(EventForm)と同じ並び。移動なら「10:05 〜 13:20」と
              // 出るので、当日の動きが一目で分かる。
              <div className="range-field range-field--time">
                <input
                  type="time"
                  aria-label="開始時刻"
                  className="field-shell"
                  value={row.startTime ?? ""}
                  onChange={(e) => onChange({ startTime: e.target.value })}
                />
                <span className="range-field__arrow" aria-hidden="true">
                  〜
                </span>
                <input
                  type="time"
                  aria-label="終了時刻"
                  className="field-shell"
                  value={row.endTime ?? ""}
                  onChange={(e) => onChange({ endTime: e.target.value })}
                />
              </div>
            )}
          </Field>
          {/* 種類は旅行の日程だけが持つ項目。 */}
          {destination === "trip" && (
            <Select label="種類" value={row.type} onChange={(e) => onChange({ type: e.target.value as TripScheduleType })}>
              {TRIP_SCHEDULE_TYPES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          )}
          {destination !== "task" && (
            <Input
              label="場所"
              optional
              value={row.location ?? ""}
              onChange={(e) => onChange({ location: e.target.value })}
            />
          )}
          {/* 費用は旅行の日程に入れる時だけ。新幹線なら交通費、宿なら宿泊費として
              同じ旅行に積む(種類がそのまま費用の分類になる)。 */}
          {destination === "trip" && (
            <>
              <SwitchField
                label="費用にも入れる"
                hint={row.amount ? undefined : missingAmountHint}
                checked={row.withExpense}
                onChange={(withExpense) => onChange({ withExpense })}
              />
              {row.withExpense && (
                <Input
                  label="金額"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={row.amount != null ? String(row.amount) : ""}
                  onChange={(e) => onChange({ amount: e.target.value ? Number(e.target.value) : undefined })}
                  placeholder="例: 12540"
                />
              )}
            </>
          )}
          {row.memo && <p className="px-1 text-xs leading-relaxed text-slate-500">{row.memo}</p>}
          {outside && (
            <p className="flex items-start gap-1.5 px-1 text-xs leading-relaxed text-warning">
              <TriangleAlert size={13} className="mt-0.5 shrink-0" />
              この旅行の期間の外です。入れても日程表には出てこないので、日付か旅行の期間を直してください
            </p>
          )}
        </div>
      )}
    </div>
  );
}
