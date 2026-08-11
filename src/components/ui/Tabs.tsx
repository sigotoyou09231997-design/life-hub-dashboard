const COLS_CLASS: Record<number, string> = {
  2: "grid-cols-2",
  3: "grid-cols-3",
  5: "grid-cols-5",
};

export interface TabOption<T extends string> {
  value: T;
  label: string;
}

interface Props<T extends string> {
  options: TabOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** text-sm fits 2-3 columns; text-[11px] keeps 5 columns from wrapping at 320px */
  dense?: boolean;
  className?: string;
}

export function Tabs<T extends string>({ options, value, onChange, dense = false, className = "" }: Props<T>) {
  return (
    <div
      role="tablist"
      className={`grid gap-1 rounded-xl bg-slate-100 p-1 ${COLS_CLASS[options.length] ?? "grid-cols-3"} ${className}`}
    >
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(opt.value)}
            className={`rounded-lg py-2 font-medium transition-all duration-150 active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
              dense ? "text-[11px]" : "text-sm"
            } ${selected ? "bg-white font-semibold text-accent shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
