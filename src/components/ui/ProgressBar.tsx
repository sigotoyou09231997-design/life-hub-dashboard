interface Props {
  value: number; // 0-100
  colorClass?: string;
}

export function ProgressBar({ value, colorClass = "bg-accent" }: Props) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-white/40">
      <div
        className={`h-full rounded-full transition-[width] duration-500 ease-out ${colorClass}`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
