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
  /**
   * 中身の長さが決まらないタブ（Gmailのアカウント＝メールアドレス、CSV取り込みの
   * 「1列(符号で判定)」など）だけ、文字を小さくする。**大きさ（高さ・余白）は
   * 変えない** — 画面ごとにタブの見た目が違って見える原因がここだったので、
   * 逃がしてよいのは文字の大きさだけにしてある（2026-09-05の依頼）。
   */
  dense?: boolean;
  className?: string;
}

/**
 * 画面やシートの中身を切り替えるタブ。**大きさは1種類しかない。**
 *
 * 2026-09-05まで dense(min-h-9 + 11px) / 既定(min-h-9 + 14px) / large(min-h-12 + 14px)
 * の3つがあり、どれを使うかが画面ごとに揃っていなかった（お金管理は dense、
 * メモ・リストは既定、旅行詳細は large）。同じ「タブ切り替え」が画面ごとに違って
 * 見えるので、大きさは large だった形に一本化した。
 */
export function Tabs<T extends string>({ options, value, onChange, dense = false, className = "" }: Props<T>) {
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
            className={`relative z-10 min-h-12 px-1 py-3 font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50 ${
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
