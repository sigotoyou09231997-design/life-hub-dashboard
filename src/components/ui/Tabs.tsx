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
  const activeIndex = Math.max(0, options.findIndex((option) => option.value === value));
  return (
    <div
      role="tablist"
      className={`spatial-tabs relative grid gap-0 border border-white/45 bg-white/18 p-1 ${COLS_CLASS[options.length] ?? "grid-cols-3"} ${className}`}
    >
      <span
        className="spatial-tabs__indicator pointer-events-none absolute bottom-1 top-1 border border-white/45 bg-white/42 shadow-[0_7px_18px_rgba(53,78,108,.07),inset_0_1px_0_rgba(255,255,255,.58)] transition-transform duration-200 ease-out motion-reduce:transition-none"
        style={{ width: `calc((100% - 0.5rem) / ${options.length})`, left: "0.25rem", transform: `translateX(${activeIndex * 100}%)` }}
        aria-hidden="true"
      />
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(opt.value)}
            className={`relative z-10 min-h-9 py-2 font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50 ${
              dense ? "text-[11px]" : "text-sm"
            } ${selected ? "font-semibold text-accent" : "text-slate-500 hover:text-slate-700"}`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
