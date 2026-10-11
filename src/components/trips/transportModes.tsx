import { Bike, Bus, Car, CarTaxiFront, Footprints, Plane, Ship, TrainFront, TramFront, type LucideIcon } from "lucide-react";
import type { TripTransportMode } from "../../types";
import { transportModeLabel } from "../../lib/tripCategories";

/** 移動手段ごとの絵(src/lib/tripCategories.ts の TRIP_TRANSPORT_MODES と同じ並び)。 */
export const TRANSPORT_MODE_ICON: Record<TripTransportMode, LucideIcon> = {
  train: TramFront,
  shinkansen: TrainFront,
  bus: Bus,
  car: Car,
  taxi: CarTaxiFront,
  walk: Footprints,
  plane: Plane,
  ferry: Ship,
  bicycle: Bike,
};

/** 日程の一覧・共有したしおりに出す「新幹線」などの小さな印。 */
export function TransportModeChip({ mode }: { mode: TripTransportMode }) {
  const Icon = TRANSPORT_MODE_ICON[mode];
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium text-slate-600">
      <Icon size={12} aria-hidden="true" />
      {transportModeLabel(mode)}
    </span>
  );
}
