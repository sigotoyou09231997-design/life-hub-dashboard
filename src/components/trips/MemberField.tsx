import { useState, type KeyboardEvent } from "react";
import { UserPlus, X } from "lucide-react";
import { MAX_MEMBER_NAME, MAX_MEMBERS, normalizeMembers } from "../../lib/tripMembers";
import { Field } from "../ui/Field";

interface Props {
  value: string[];
  onChange: (next: string[]) => void;
}

/** 旅行の参加者を、名前で足したり外したりする欄(src/lib/tripMembers.ts)。 */
export function MemberField({ value, onChange }: Props) {
  const [draft, setDraft] = useState("");
  const full = value.length >= MAX_MEMBERS;

  function add() {
    const next = normalizeMembers([...value, draft]);
    if (next.length !== value.length) onChange(next);
    setDraft("");
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // Enter で旅行ごと保存されないよう、ここでは「追加」にする。
    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (draft.trim()) add();
    }
  }

  return (
    <Field label="参加者" optional hint="費用で「誰が払ったか」を選べるようになり、割り勘の差額も出ます。" as="div">
      {value.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-1.5" aria-label="参加者">
          {value.map((name) => (
            <li key={name} className="inline-flex items-center gap-1 rounded-full bg-white/80 py-1 pl-3 pr-1 text-sm text-slate-700 shadow-[inset_0_0_0_1px_rgba(28,45,75,0.08)]">
              {name}
              <button
                type="button"
                onClick={() => onChange(value.filter((other) => other !== name))}
                aria-label={`${name}を外す`}
                className="rounded-full p-1 text-slate-400 active:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
              >
                <X size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <input
          className="field-shell min-w-0 flex-1"
          value={draft}
          maxLength={MAX_MEMBER_NAME}
          disabled={full}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={full ? `${MAX_MEMBERS}人までです` : "例: えっくん"}
          aria-label="参加者の名前"
        />
        <button
          type="button"
          onClick={add}
          disabled={full || !draft.trim()}
          className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-white/60 bg-white/50 px-3 text-sm font-medium text-accent disabled:opacity-40"
        >
          <UserPlus size={15} aria-hidden="true" />
          追加
        </button>
      </div>
    </Field>
  );
}
