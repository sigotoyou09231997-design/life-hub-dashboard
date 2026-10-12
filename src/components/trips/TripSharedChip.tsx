import { Users } from "lucide-react";

/** 他人の旅行に招かれて一緒に編集している旅行の印。削除ボタンと同じ場所に出る
 * (その旅行は、参加している人が消すことはできない。抜けるのは旅行の中の「一緒に編集」から)。 */
export function TripSharedChip({ variant = "overlay" }: { variant?: "overlay" | "inline" }) {
  return (
    <span className={`trip-shared-chip trip-shared-chip--${variant}`} role="img" aria-label="共有された旅行(一緒に編集中)" title="共有された旅行">
      <Users size={13} aria-hidden="true" />
      共有
    </span>
  );
}
