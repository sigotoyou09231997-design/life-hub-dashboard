import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarDays, CheckSquare, StickyNote, Wallet, type LucideIcon } from "lucide-react";
import { Sheet } from "../ui/Sheet";

/** どこからでも「何を追加しますか?」を開くための合図(ホームの「＋」・PCの上の帯の「＋追加」)。 */
const OPEN_EVENT = "lifehub:open-add-chooser";

export function openAddChooser() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

interface Choice {
  label: string;
  note: string;
  icon: LucideIcon;
  /** 開いた先の画面が ?new= を見て、追加のフォームを開いた状態で始める
   * (ホーム画面のショートカット vite.config.ts の manifest.shortcuts と同じ入口)。 */
  to: string;
}

// 支出をいちばん前に — 追加の回数がいちばん多いのは支出なので、ホームから2タップで
// 入れられるようにする(UI/UX 調査メモ A-3)。
const CHOICES: Choice[] = [
  { label: "支出", note: "使ったお金", icon: Wallet, to: "/records/expense?new=expense" },
  { label: "予定", note: "時間が決まっているもの", icon: CalendarDays, to: "/schedule?new=event" },
  { label: "タスク", note: "終わらせたいこと", icon: CheckSquare, to: "/schedule?new=task" },
  { label: "メモ", note: "メモ・リスト", icon: StickyNote, to: "/records/notes?new=note" },
];

/**
 * 「何を追加しますか?」のシート。App に1つだけ置き、openAddChooser() で開く。
 * 予定画面の「＋」が出すシート(SchedulePage.tsx)と同じ見た目(choice-grid)にしてある。
 */
export function AddChooserHost() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const handleOpen = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, handleOpen);
    return () => window.removeEventListener(OPEN_EVENT, handleOpen);
  }, []);

  return (
    <Sheet open={open} onClose={() => setOpen(false)} title="何を追加しますか?">
      <div className="choice-grid">
        {CHOICES.map(({ label, note, icon: Icon, to }) => (
          <button
            key={label}
            type="button"
            className="choice-grid__option"
            onClick={() => {
              setOpen(false);
              navigate(to);
            }}
          >
            <span className="choice-grid__icon">
              <Icon size={22} />
            </span>
            <strong>{label}</strong>
            <small>{note}</small>
          </button>
        ))}
      </div>
    </Sheet>
  );
}
