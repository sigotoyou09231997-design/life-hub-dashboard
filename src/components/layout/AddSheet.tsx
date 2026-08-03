import { Wallet, CheckSquare, CalendarPlus, StickyNote, BookHeart, type LucideIcon } from "lucide-react";
import { Sheet } from "../ui/Sheet";

export type AddType = "expense" | "task" | "event" | "note" | "diary";

interface Props {
  open: boolean;
  onClose: () => void;
  onSelect: (type: AddType) => void;
}

const options: { type: AddType; label: string; icon: LucideIcon }[] = [
  { type: "expense", label: "支出", icon: Wallet },
  { type: "task", label: "タスク", icon: CheckSquare },
  { type: "event", label: "予定", icon: CalendarPlus },
  { type: "note", label: "メモ", icon: StickyNote },
  { type: "diary", label: "日記", icon: BookHeart },
];

export function AddSheet({ open, onClose, onSelect }: Props) {
  return (
    <Sheet open={open} onClose={onClose} title="何を追加しますか?">
      <div className="grid grid-cols-3 gap-3">
        {options.map(({ type, label, icon: Icon }) => (
          <button
            key={type}
            onClick={() => onSelect(type)}
            className="flex flex-col items-center gap-2 rounded-2xl border border-slate-100 bg-slate-50 py-5 active:bg-slate-100"
          >
            <Icon size={24} className="text-accent" />
            <span className="text-sm font-medium text-slate-700">{label}</span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}
