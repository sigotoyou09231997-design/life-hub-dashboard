import { useState } from "react";
import { ChevronDown, PiggyBank } from "lucide-react";
import { monthlyEquivalent, type SubscriptionSummary } from "../../lib/subscriptions";
import { CATEGORY_COLORS, OTHER_COLOR, categoryColor } from "./categoryColors";
import { ServiceIcon } from "./ServiceIcon";
import type { AmountUnit } from "./SubscriptionRow";

function yen(n: number): string {
  return `¥${Math.round(n).toLocaleString()}`;
}

/** 割合の書き方。0% に見える小さいものは「1%未満」。 */
function percent(part: number, whole: number): string {
  if (whole <= 0) return "0%";
  const value = (part / whole) * 100;
  return value > 0 && value < 1 ? "1%未満" : `${Math.round(value)}%`;
}

/** 暮らしの固定費。家賃が全体の9割を占めて、サブスクの内訳が細い線になって読めなくなる
 * (2026-10-12 のスクショで確認)ので、分析では最初これらを外して見せる。 */
const LIVING_CATEGORIES = ["家賃", "水道光熱費", "保険"];

type Scope = "subs" | "all";

/** 円グラフの切れは「その他」を入れて最大6つ(それより多いと見分けられない)。 */
const MAX_SLICES = 6;
const RADIUS = 46;
const STROKE = 15;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
/** 切れと切れの間の白いすき間(円周の長さで)。 */
const GAP = 1.6;

interface Slice {
  key: string;
  label: string;
  monthly: number;
  color: string;
  /** この切れにまとめたカテゴリ。 */
  categories: string[];
}

/** カテゴリを円グラフの切れにする。色の決まっていないカテゴリと、6切れを超えたぶんの
 * 小さいものは灰色の「その他」1切れにまとめる。 */
export function buildSlices(byCategory: SubscriptionSummary["byCategory"]): Slice[] {
  const colored = byCategory.filter((share) => share.category in CATEGORY_COLORS);
  const rest = byCategory.filter((share) => !(share.category in CATEGORY_COLORS));
  const room = rest.length > 0 || colored.length > MAX_SLICES ? MAX_SLICES - 1 : MAX_SLICES;
  const kept = colored.slice(0, room);
  const folded = [...colored.slice(room), ...rest];
  const slices: Slice[] = kept.map((share) => ({
    key: share.category,
    label: share.category,
    monthly: share.monthly,
    color: categoryColor(share.category),
    categories: [share.category],
  }));
  if (folded.length > 0) {
    slices.push({
      key: "__other",
      label: "その他",
      monthly: folded.reduce((sum, share) => sum + share.monthly, 0),
      color: OTHER_COLOR,
      categories: folded.map((share) => share.category),
    });
  }
  return slices;
}

interface Props {
  summary: SubscriptionSummary;
  unit: AmountUnit;
}

/**
 * 分析(参考: サブスクBOX の「分析」)。カテゴリ別の円グラフと、その一覧(押すと中の
 * サービスが開く)、解約で浮いたお金。一覧にはカテゴリごとの金額と割合を全部書くので、
 * 色だけに頼らずに読める。
 */
export function SubscriptionAnalysis({ summary, unit }: Props) {
  // 強調する切れ。マウスを乗せている間(hover)と、指で押して止めたもの(pinned)。
  // 指の操作では mouseenter が押した後も残り、他の切れが薄いままになるので、乗せるのはマウスだけ。
  const [hover, setHover] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>("subs");
  const factor = unit === "year" ? 12 : 1;
  const hasLiving = summary.byCategory.some((share) => LIVING_CATEGORIES.includes(share.category));
  const shares =
    scope === "subs" ? summary.byCategory.filter((share) => !LIVING_CATEGORIES.includes(share.category)) : summary.byCategory;
  const total = shares.reduce((sum, share) => sum + share.monthly, 0);
  const count = shares.reduce((sum, share) => sum + share.items.length, 0);
  const slices = buildSlices(shares);
  const sliceOf = (category: string) => slices.find((slice) => slice.categories.includes(category));
  const active = hover ?? pinned;
  const activeSlice = slices.find((slice) => slice.key === active);
  const hoverWithMouse = (key: string | null) => (event: React.PointerEvent) => {
    if (event.pointerType === "mouse") setHover(key);
  };

  function changeScope(next: Scope) {
    setScope(next);
    setPinned(null);
    setOpen(null);
  }

  let offset = 0;
  const arcs = slices.map((slice) => {
    const length = total > 0 ? (slice.monthly / total) * CIRCUMFERENCE : 0;
    const arc = { slice, length, offset };
    offset += length;
    return arc;
  });

  return (
    <div className="subs-analysis">
      <section className="lh-section">
        <div className="lh-section__head">
          <h2 className="lh-section__title">カテゴリ別</h2>
          <span className="lh-section__note">{unit === "year" ? "1年あたり" : "1か月あたり"}</span>
        </div>
        {hasLiving && (
          <div className="subs-chips" role="group" aria-label="分析に入れるもの">
            <button type="button" className="subs-chip" aria-pressed={scope === "subs"} onClick={() => changeScope("subs")}>
              サブスクだけ
            </button>
            <button type="button" className="subs-chip" aria-pressed={scope === "all"} onClick={() => changeScope("all")}>
              家賃なども含める
            </button>
          </div>
        )}
        <div className="warm-card subs-analysis__card">
          {total <= 0 ? (
            <p className="subs-empty">請求が続いているサブスクがまだありません。</p>
          ) : (
            <>
              <div className="subs-donut">
                <svg viewBox="0 0 120 120" role="img" aria-label="カテゴリ別の割合">
                  <circle cx="60" cy="60" r={RADIUS} className="subs-donut__track" strokeWidth={STROKE} />
                  {arcs.map(({ slice, length, offset: start }) => (
                    <circle
                      key={slice.key}
                      cx="60"
                      cy="60"
                      r={RADIUS}
                      fill="none"
                      stroke={slice.color}
                      strokeWidth={STROKE}
                      strokeDasharray={`${Math.max(0, length - (slices.length > 1 ? GAP : 0))} ${CIRCUMFERENCE}`}
                      strokeDashoffset={-start}
                      transform="rotate(-90 60 60)"
                      className={`subs-donut__slice${active && active !== slice.key ? " is-dim" : ""}`}
                      onPointerEnter={hoverWithMouse(slice.key)}
                      onPointerLeave={hoverWithMouse(null)}
                      onClick={() => setPinned(pinned === slice.key ? null : slice.key)}
                    >
                      <title>{`${slice.label} ${yen(slice.monthly * factor)}`}</title>
                    </circle>
                  ))}
                </svg>
                <div className="subs-donut__center" aria-live="polite">
                  <span>{activeSlice ? activeSlice.label : scope === "subs" && hasLiving ? "サブスク合計" : "合計"}</span>
                  <strong>{yen((activeSlice ? activeSlice.monthly : total) * factor)}</strong>
                  <small>{activeSlice ? percent(activeSlice.monthly, total) : `${count}件`}</small>
                </div>
              </div>

              <div className="lh-group subs-legend">
                {shares.map((share) => {
                  const slice = sliceOf(share.category);
                  const isOpen = open === share.category;
                  return (
                    <div key={share.category} className={`subs-legend__group${isOpen ? " is-open" : ""}`}>
                      <button
                        type="button"
                        className={`lh-row lh-row--plain subs-legend__row${active && slice?.key !== active ? " is-dim" : ""}`}
                        aria-expanded={isOpen}
                        onClick={() => {
                          setOpen(isOpen ? null : share.category);
                          setPinned(isOpen ? null : (slice?.key ?? null));
                        }}
                        onPointerEnter={hoverWithMouse(slice?.key ?? null)}
                        onPointerLeave={hoverWithMouse(null)}
                      >
                        <span className="subs-legend__dot" style={{ background: slice?.color ?? OTHER_COLOR }} />
                        <span className="lh-row__copy">
                          <strong className="lh-row__label">{share.category}</strong>
                          <small>
                            {share.items.length}件 · {percent(share.monthly, total)}
                          </small>
                        </span>
                        <span className="lh-row__value">{yen(share.monthly * factor)}</span>
                        <ChevronDown size={15} className="subs-legend__chev" aria-hidden="true" />
                      </button>
                      {isOpen && (
                        <ul className="subs-legend__items">
                          {share.items.map((item) => (
                            <li key={item.cost.id ?? item.cost.title}>
                              <ServiceIcon title={item.cost.title} serviceKey={item.detail?.serviceKey} size="sm" />
                              <span>{item.cost.title}</span>
                              <span className="subs-legend__amount">{yen(monthlyEquivalent(item) * factor)}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </section>

      <section className="lh-section">
        <div className="lh-section__head">
          <h2 className="lh-section__title">解約で浮いたお金</h2>
        </div>
        <div className="warm-card lh-savings subs-saved">
          {summary.savedMonthly > 0 ? (
            <>
              <p className="lh-savings__kicker">解約してから、これまでに</p>
              <p className="lh-savings__amount tabular-nums">{yen(summary.savedSoFar)}</p>
              <p className="subs-saved__note">
                <PiggyBank size={15} aria-hidden="true" />
                毎月 {yen(summary.savedMonthly)} ずつ浮いています(1年で {yen(summary.savedMonthly * 12)})
              </p>
            </>
          ) : (
            <p className="subs-saved__note">
              <PiggyBank size={15} aria-hidden="true" />
              使っていないサブスクを「解約する」で記録すると、ここに浮いたお金が出ます。
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
