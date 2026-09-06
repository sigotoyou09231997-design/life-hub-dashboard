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

/** 何列×何段に並べるか。6個のときだけ3列×2段に折り返す */
export function tabGridLayout(count: number) {
  const cols = COLS_FOR_COUNT[count] ?? 3;
  const rows = Math.max(1, Math.ceil(count / cols));
  return { cols, rows };
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
 *
 * 2026-09-06に「ボタンはそれぞれ分けて表示がいい」（本人）で、**1つの入れ物に
 * 詰めて白いつまみを滑らせる形をやめた**。お金管理のように6個あって2段に折り返すと、
 * 溝の中で2行に割れた見た目になり、どこからどこまでが1つのボタンなのか分かり
 * にくかったため。いまは1つずつ独立した丸ボタンを隙間を空けて並べ、選んでいる
 * ものだけ白く浮かせる（つまみの span は無くなった）。
 */
export function Tabs<T extends string>({ options, value, onChange, dense = false, className = "" }: Props<T>) {
  const { cols } = tabGridLayout(options.length);
  return (
    <div
      role="tablist"
      className={`spatial-tabs grid gap-2 ${COLS_CLASS[cols] ?? "grid-cols-3"} ${className}`}
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
            className={`spatial-tabs__tab min-h-12 border px-1 py-3 font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50 ${
              dense ? "text-[11px]" : "text-sm"
            } ${
              selected
                ? "is-selected border-white/50 bg-white/55 font-semibold text-accent"
                : "border-white/35 bg-white/18 text-slate-500 hover:text-slate-700"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
