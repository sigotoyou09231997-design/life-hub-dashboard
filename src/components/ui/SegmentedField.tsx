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
  /** 絵を上・文字を下に積む。選択肢が多く1つの幅が狭い時(移動手段の5列×2行など)、絵と文字を横に並べると
   * 文字が1字ずつ縦に折れてしまう(2026-10-11、スマホで「タクシー」が4行になった)。 */
  stacked?: boolean;
  /** 1つの溝に入れず、1つずつ分けたボタンとして並べる。2段に折り返す時は、溝の中で行が割れて
   * どこまでが1つのボタンか分からなくなるので、こちらにする(本人の好み、2026-09-06)。 */
  separate?: boolean;
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
  stacked = false,
  separate = false,
}: Props<T>) {
  return (
    <Field label={label} optional={optional} hint={hint} as="div">
      <div
        className={`segmented${separate ? " segmented--separate" : ""}`}
        style={{ gridTemplateColumns: `repeat(${columns ?? options.length}, minmax(0, 1fr))` }}
      >
        {options.map((option) => {
          const Icon = option.icon;
          return (
            <button
              key={option.value}
              type="button"
              className={`segmented__option${stacked ? " segmented__option--stacked" : ""}`}
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
