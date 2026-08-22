import type { LucideIcon } from "lucide-react";
import { Field } from "./Field";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: LucideIcon;
}

interface Props<T extends string> {
  label?: string;
  optional?: boolean;
  hint?: string;
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
  /** 選択肢が長い日本語のときは横に並べきれないので縦積みにする。 */
  columns?: number;
}

/** 選択肢が少ないものをプルダウンにしない。全部見えていて、1回で選べる。 */
export function SegmentedField<T extends string>({
  label,
  optional,
  hint,
  value,
  options,
  onChange,
  columns,
}: Props<T>) {
  return (
    <Field label={label} optional={optional} hint={hint} as="div">
      <div
        className="segmented"
        style={{ gridTemplateColumns: `repeat(${columns ?? options.length}, minmax(0, 1fr))` }}
      >
        {options.map((option) => {
          const Icon = option.icon;
          return (
            <button
              key={option.value}
              type="button"
              className="segmented__option"
              aria-pressed={option.value === value}
              onClick={() => onChange(option.value)}
            >
              {Icon && <Icon size={15} strokeWidth={2.1} />}
              {option.label}
            </button>
          );
        })}
      </div>
    </Field>
  );
}
