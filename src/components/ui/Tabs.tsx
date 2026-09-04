/** タブの数 → 1段に並べる列数。6個は3列×2段に折り返す（5個までは1段） */
const COLS_FOR_COUNT: Record<number, number> = {
  2: 2,
  3: 3,
  4: 4,
  5: 5,
  6: 3,
};

const COLS_CLASS: Record<number, string> = {
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
  5: "grid-cols-5",
};

/** つまみの位置・大きさ。折り返す（2段になる）場合も列と行の両方から出す */
export function tabIndicatorLayout(count: number, activeIndex: number) {
  const cols = COLS_FOR_COUNT[count] ?? 3;
  const rows = Math.max(1, Math.ceil(count / cols));
  const index = Math.min(Math.max(0, activeIndex), Math.max(0, count - 1));
  return { cols, rows, col: index % cols, row: Math.floor(index / cols) };
}

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
  /** その画面を移動する主役のタブ用。押しやすいように背を高く、文字も大きくする（dense より優先） */
  large?: boolean;
  className?: string;
}

export function Tabs<T extends string>({ options, value, onChange, dense = false, large = false, className = "" }: Props<T>) {
  const activeIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const { cols, rows, col, row } = tabIndicatorLayout(options.length, activeIndex);
  return (
    <div
      role="tablist"
      className={`spatial-tabs relative grid gap-0 border border-white/45 bg-white/18 p-1 ${COLS_CLASS[cols] ?? "grid-cols-3"} ${className}`}
    >
      <span
        className="spatial-tabs__indicator pointer-events-none absolute border border-white/45 bg-white/42 shadow-[0_7px_18px_rgba(53,78,108,.07),inset_0_1px_0_rgba(255,255,255,.58)] transition-transform duration-200 ease-out motion-reduce:transition-none"
        style={{
          width: `calc((100% - 0.5rem) / ${cols})`,
          height: `calc((100% - 0.5rem) / ${rows})`,
          left: "0.25rem",
          top: "0.25rem",
          transform: `translate(${col * 100}%, ${row * 100}%)`,
        }}
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
            className={`relative z-10 font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50 ${
              large ? "min-h-12 py-3 text-sm" : "min-h-9 py-2"
            } ${large ? "" : dense ? "text-[11px]" : "text-sm"} ${
              selected ? "font-semibold text-accent" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
