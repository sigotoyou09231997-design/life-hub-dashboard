interface Props {
  rows?: number;
}

export function ListSkeleton({ rows = 3 }: Props) {
  return (
    <div className="space-y-2" role="status" aria-label="読み込み中">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-16 animate-pulse rounded-xl border border-slate-100 bg-slate-100 p-3.5" />
      ))}
    </div>
  );
}
