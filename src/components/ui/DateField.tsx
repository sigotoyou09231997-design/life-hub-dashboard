import { useEffect, useRef, useState, type ReactNode } from "react";
import { parseISO, isValid } from "date-fns";
import { ArrowRight, CalendarDays, ChevronDown } from "lucide-react";
import { formatDisplayDate, formatShortDate, todayStr, tripDurationLabel } from "../../lib/date";
import { MonthView } from "../calendar/MonthView";
import { Field } from "./Field";

const NO_DATES: Set<string> = new Set();

interface TriggerProps {
  value: string;
  open: boolean;
  onToggle: () => void;
  placeholder?: string;
  ariaLabel?: string;
  /** 期間の2つ並びで使う短い表記。長い表記のままだと狭い画面で日付が切れる。 */
  compact?: boolean;
}

/** 押すと下にカレンダーが開くボタン。OSの日付入力(08/22/2026 のアメリカ式)を
 *  使わないための部品で、開くのは app 自身のカレンダー(MonthView)。 */
function DateTrigger({ value, open, onToggle, placeholder = "日付を選ぶ", ariaLabel, compact }: TriggerProps) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-expanded={open}
      onClick={onToggle}
      className={`field-shell field-shell--button ${open ? "is-open" : ""} ${value ? "" : "is-empty"}`}
    >
      <span className="flex min-w-0 items-center gap-2 truncate">
        {!compact && <CalendarDays size={16} />}
        {value ? (compact ? formatShortDate(value) : formatDisplayDate(value)) : placeholder}
      </span>
      <ChevronDown
        size={16}
        style={{ transform: open ? "rotate(180deg)" : undefined, transition: "transform 220ms" }}
      />
    </button>
  );
}

interface PopoverProps {
  value: string;
  onSelect: (date: string) => void;
  onClose: () => void;
  minDate?: string;
}

/** カレンダーは、押したボタンの真下ではなく項目の幅いっぱいに開く。ボタンの幅に
 *  収めると、期間のように2つ並んだときに7列が潰れて日付が読めなくなる。 */
function DatePopover({ value, onSelect, onClose, minDate }: PopoverProps) {
  const [month, setMonth] = useState(() => {
    const parsed = parseISO(value || todayStr());
    return isValid(parsed) ? parsed : new Date();
  });

  return (
    <div className="date-popover">
      <div className="date-popover__inner">
        <MonthView
          currentMonth={month}
          onMonthChange={setMonth}
          selectedDate={value}
          onSelectDate={onSelect}
          eventDates={NO_DATES}
          taskDates={NO_DATES}
          minDate={minDate}
        />
      </div>
      <div className="date-popover__foot">
        <button
          type="button"
          className="date-popover__today"
          onClick={() => {
            setMonth(new Date());
            onSelect(todayStr());
          }}
        >
          今日にする
        </button>
        <button type="button" className="date-popover__done" onClick={onClose}>
          閉じる
        </button>
      </div>
    </div>
  );
}

/** 開いたまま別の場所を触ったら閉じる。フォームの中で開きっぱなしになると、
 *  下の項目がずっと押し下げられたままになる。 */
function useCloseOnOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      if (!ref.current?.contains(event.target as Node)) close();
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open, close]);
  return ref;
}

interface Props {
  label?: string;
  optional?: boolean;
  hint?: ReactNode;
  error?: ReactNode;
  value: string;
  onChange: (value: string) => void;
  minDate?: string;
  placeholder?: string;
}

export function DateField({ label, optional, hint, error, value, onChange, minDate, placeholder }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useCloseOnOutside(open, () => setOpen(false));

  return (
    <Field label={label} optional={optional} hint={hint} error={error} as="div">
      <div ref={ref}>
        <DateTrigger
          value={value}
          open={open}
          onToggle={() => setOpen((v) => !v)}
          placeholder={placeholder}
          ariaLabel={label}
        />
        {open && (
          <DatePopover
            value={value}
            minDate={minDate}
            onClose={() => setOpen(false)}
            onSelect={(date) => {
              onChange(date);
              setOpen(false);
            }}
          />
        )}
      </div>
    </Field>
  );
}

interface RangeProps {
  label?: string;
  start: string;
  end: string;
  onChangeStart: (value: string) => void;
  onChangeEnd: (value: string) => void;
  error?: ReactNode;
  /** 「3泊4日」のように、選んだ範囲が何日ぶんなのかをその場で返す。 */
  summary?: boolean;
  /** 旅行の「n泊m日」ではない言い方をしたいときの差し替え(予定は「3日間」)。 */
  summaryText?: string;
  /** 終了日が空のときに出す文言。予定のように終了日を省ける場面で使う。 */
  endPlaceholder?: string;
  /** 開始日を選んだら、そのまま終了日のカレンダーへ進むか。旅行は必ず両方を選ぶので
   * 進めた方が早いが、予定はほとんどが1日で終わるため、勝手に開くと余計な操作になる。 */
  advanceToEnd?: boolean;
}

/** 開始と終了を1つの項目として見せる。別々の項目として離して置くと、どちらが
 *  期間の話なのか分からなくなる。カレンダーは同時に1つだけ開く。 */
export function DateRangeField({
  label,
  start,
  end,
  onChangeStart,
  onChangeEnd,
  error,
  summary = true,
  summaryText,
  endPlaceholder,
  advanceToEnd = true,
}: RangeProps) {
  const [editing, setEditing] = useState<"start" | "end" | null>(null);
  const ref = useCloseOnOutside(editing !== null, () => setEditing(null));
  const duration = summaryText ?? (summary ? tripDurationLabel(start, end) : "");

  return (
    <Field label={label} error={error} as="div">
      <div ref={ref}>
        <div className="range-field">
          <DateTrigger
            compact
            value={start}
            open={editing === "start"}
            onToggle={() => setEditing((v) => (v === "start" ? null : "start"))}
            ariaLabel={`${label ?? ""}の開始日`}
          />
          <span className="range-field__arrow" aria-hidden="true">
            <ArrowRight size={16} />
          </span>
          <DateTrigger
            compact
            value={end}
            open={editing === "end"}
            onToggle={() => setEditing((v) => (v === "end" ? null : "end"))}
            placeholder={endPlaceholder}
            ariaLabel={`${label ?? ""}の終了日`}
          />
        </div>

        {editing && (
          <DatePopover
            // 終了日がまだ空のときは、今日ではなく開始日の月を開く。宿泊のように
            // 先の日付を選んでいる最中に今月へ飛ぶと、そこから何度も送ることになる。
            value={editing === "start" ? start : end || start}
            minDate={editing === "end" ? start || undefined : undefined}
            onClose={() => setEditing(null)}
            onSelect={(date) => {
              if (editing === "start") onChangeStart(date);
              else onChangeEnd(date);
              // 開始を選んだら、そのまま終了を選ぶ流れが自然(旅行)。予定のように
              // 1日で終わることの方が多い場面では、そこで閉じる。
              setEditing(editing === "start" && advanceToEnd ? "end" : null);
            }}
          />
        )}
      </div>
      {duration && <span className="range-field__summary">{duration}</span>}
    </Field>
  );
}
