import { Trash2 } from "lucide-react";
import type { Trip } from "../../types";

interface Props {
  trip: Trip;
  onDelete: (id: string) => void;
  /** アーカイブの行はリンクの外に置くので、写真カードの浮かせ方とは別の見た目にする。 */
  variant?: "overlay" | "inline";
}

/** カード全体がリンクなので、削除はクリックを親に渡さないことが要件になる。
 *  3種類のカードで同じことを書かないための1か所。 */
export function TripRemoveButton({ trip, onDelete, variant = "overlay" }: Props) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (
          trip.id &&
          confirm(`「${trip.name}」を削除しますか?関連するスケジュール・費用・持ち物もすべて削除されます。`)
        ) {
          onDelete(trip.id);
        }
      }}
      aria-label={`「${trip.name}」を削除`}
      className={variant === "overlay" ? "trip-remove" : "trip-archive__remove"}
    >
      <Trash2 size={variant === "overlay" ? 16 : 15} />
    </button>
  );
}
