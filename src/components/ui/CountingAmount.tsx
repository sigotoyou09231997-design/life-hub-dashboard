import { useRef } from "react";
import { formatSignedYen } from "../../lib/amountDelta";
import { useAmountTransition } from "../../hooks/useAmountTransition";

interface Props {
  value: number | undefined;
  /** 数字の書き方。既定は「12,345」(¥ は呼ぶ側が外に置く)。 */
  format?: (value: number) => string;
  /** 値がまだ無い時(読み込み中)の文字。 */
  placeholder?: string;
  /** 数えている物が替わった印(月・給料日の期間)。替わった時は数え上げも差額も出さない。 */
  resetKey?: string;
  /** 差額を「+¥1,280」と浮かべるか。お金管理の「使えるお金」は数え上げだけにする。 */
  showDelta?: boolean;
}

const defaultFormat = (value: number) => Math.round(value).toLocaleString();

/**
 * 値が変わると、前の値から新しい値へ数え上がる金額(UI/UX 調査メモ 第4弾 A-5)。
 *
 * 1フレームごとに描き直すのはこの小さな部品だけにして、ホーム全体を毎フレーム
 * 描き直さないようにしてある。開いた直後の 0 からの数え上げは useDesignMotion.ts のまま
 * (ここの文字を後から書き換える。React の文字を1つの <span> に入れてあるので、そのまま効く)。
 */
export function CountingAmount({ value, format = defaultFormat, placeholder = "—", resetKey, showDelta = false }: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const { display, delta } = useAmountTransition(value, ref, resetKey);
  return (
    <span ref={ref} className="num-count">
      {display === undefined ? placeholder : format(display)}
      {showDelta && delta && (
        // 読み上げでは合計の新しい値だけを読めばよいので、浮かぶ差額は読ませない。
        <span key={delta.id} className={`num-delta ${delta.amount < 0 ? "is-down" : "is-up"}`} aria-hidden="true">
          {formatSignedYen(delta.amount)}
        </span>
      )}
    </span>
  );
}
