import { lazy, Suspense, useEffect, useState } from "react";
import { CalendarDays, CheckSquare, StickyNote, Wallet, type LucideIcon } from "lucide-react";
import { Sheet } from "../ui/Sheet";
import type { QuickAddKind } from "./QuickAddForms";

// 入力のフォームは選ばれた時に初めて読む(各画面のフォームと同じ部品なので、最初の読み込みに入れない)。
const QuickAddForms = lazy(() => import("./QuickAddForms"));

/** どこからでも「何を追加しますか?」を開くための合図(ホームの「＋」・PCの上の帯の「＋追加」)。 */
const OPEN_EVENT = "lifehub:open-add-chooser";

export function openAddChooser() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

interface Choice {
  label: string;
  note: string;
  icon: LucideIcon;
  /** 今いる画面の上で開く入力(QuickAddForms.tsx)。以前は各画面へ ?new= で移っていたが、
   * それだとホームから入れてもホームに戻らなかった(UI/UX 調査メモ 第3弾 N-3)。
   * ?new= の入口は、ホーム画面のショートカット(vite.config.ts)と検索パレットのために残してある。 */
  kind: QuickAddKind;
}

// 支出をいちばん前に — 追加の回数がいちばん多いのは支出なので、ホームから2タップで
// 入れられるようにする(UI/UX 調査メモ A-3)。
const CHOICES: Choice[] = [
  { label: "支出", note: "使ったお金", icon: Wallet, kind: "expense" },
  { label: "予定", note: "時間が決まっているもの", icon: CalendarDays, kind: "event" },
  { label: "タスク", note: "終わらせたいこと", icon: CheckSquare, kind: "task" },
  { label: "メモ", note: "メモ・リスト", icon: StickyNote, kind: "note" },
];

/**
 * 「何を追加しますか?」のシート。App に1つだけ置き、openAddChooser() で開く。
 * 予定画面の「＋」が出すシート(SchedulePage.tsx)と同じ見た目(choice-grid)にしてある。
 */
export function AddChooserHost() {
  const [open, setOpen] = useState(false);
  /** 選んだあとに開いている入力。 */
  const [kind, setKind] = useState<QuickAddKind | null>(null);
  /** 一度でも選んだら入力の部品を置いたままにする(閉じる時の動きを途中で切らないため)。 */
  const [formsLoaded, setFormsLoaded] = useState(false);

  useEffect(() => {
    const handleOpen = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, handleOpen);
    return () => window.removeEventListener(OPEN_EVENT, handleOpen);
  }, []);

  return (
    <>
      <Sheet open={open} onClose={() => setOpen(false)} title="何を追加しますか?">
        <div className="choice-grid">
          {CHOICES.map(({ label, note, icon: Icon, kind: choice }) => (
            <button
              key={label}
              type="button"
              className="choice-grid__option"
              onClick={() => {
                setOpen(false);
                setFormsLoaded(true);
                setKind(choice);
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
      {formsLoaded && (
        <Suspense fallback={null}>
          <QuickAddForms kind={kind} onClose={() => setKind(null)} />
        </Suspense>
      )}
    </>
  );
}
