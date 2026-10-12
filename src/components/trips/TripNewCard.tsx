import { ChevronRight, Plus } from "lucide-react";

interface Props {
  onClick: () => void;
  /** これから行く旅行が1件も無い時。一覧の先頭に立つので、次の旅行を誘う言い方にする。 */
  first?: boolean;
}

/**
 * 旅行一覧の「新しい旅行」の入り口。右下の「＋」だけだと、一覧のカードと並んでいないので
 * 旅行を足す場所だと気づきにくかった(2026-10-12)。カードと同じ面で一覧の中にも置く。
 * PCでは、先頭の大きな旅行カードの右に、同じ高さのタイルとして並ぶ(styles/trips.css)。
 */
export function TripNewCard({ onClick, first = false }: Props) {
  return (
    <button type="button" className={`trip-new${first ? " trip-new--first" : ""}`} onClick={onClick} data-page-block>
      <span className="trip-new__icon" aria-hidden="true">
        <Plus size={20} />
      </span>
      <span className="trip-new__copy">
        <strong>{first ? "次の旅行を計画する" : "新しい旅行"}</strong>
        <small>
          {first
            ? "これから行く旅行はまだありません。行き先と日程を入れて始めましょう。"
            : "行き先と日程を入れると、日程・費用・持ち物をまとめられます。"}
        </small>
      </span>
      <ChevronRight size={18} className="trip-new__go" aria-hidden="true" />
    </button>
  );
}
