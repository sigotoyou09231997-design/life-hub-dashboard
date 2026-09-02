import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Plus, X } from "lucide-react";
import { db } from "../../db/schema";
import { nextPersonColor, nextSortOrder, personColorHex, sortPeople } from "../../lib/eventPeople";
import { Field } from "../ui/Field";

interface Props {
  value: string[];
  onChange: (personIds: string[]) => void;
}

/**
 * 予定を編集する画面の「誰の予定」。押すたびに入る・外れる(1件に何人でも付けられる)。
 *
 * ここから直接その場で人を足せるようにしてあるのは、予定を入れている途中で
 * 「妻」を作りたくなった時に、設定画面まで往復させないため。名前の変更・色の変更・
 * 削除は設定の中(src/components/settings/EventPeopleManager.tsx)に置いてある —
 * 予定を1件書いている最中に出す用の操作ではないため。
 */
export function EventPeopleField({ value, onChange }: Props) {
  const peopleResult = useLiveQuery(() => db.eventPeople.toArray(), []);
  const people = sortPeople(peopleResult ?? []);
  const [adding, setAdding] = useState(false);
  const [draftName, setDraftName] = useState("");

  function toggle(id: string): void {
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  }

  async function add(): Promise<void> {
    const name = draftName.trim();
    if (!name) return;
    // 同じ名前が既にいるならそれを選ぶだけにする。押し間違いで「妻」が2人に
    // 増えると、色が分かれて予定が2色で出てしまうため。
    const existing = people.find((person) => person.name === name);
    if (existing?.id) {
      if (!value.includes(existing.id)) onChange([...value, existing.id]);
    } else {
      const id = await db.eventPeople.add({
        name,
        color: nextPersonColor(people),
        sortOrder: nextSortOrder(people),
        createdAt: Date.now(),
      });
      onChange([...value, String(id)]);
    }
    setDraftName("");
    setAdding(false);
  }

  return (
    <Field
      as="div"
      label="誰の予定"
      optional
      hint={
        people.length === 0
          ? "名前を足すと、カレンダーの点がその人の色になります。付けなくても今までどおり使えます。"
          : "何人でも付けられます。名前と色の変更・削除は設定から。"
      }
    >
      <div className="person-chips">
        {people.map((person) => {
          const on = person.id != null && value.includes(person.id);
          return (
            <button
              key={person.id}
              type="button"
              className={`person-chip${on ? " is-on" : ""}`}
              style={{ ["--person" as string]: personColorHex(person) }}
              aria-pressed={on}
              onClick={() => person.id && toggle(person.id)}
            >
              <span className="person-chip__dot" aria-hidden="true" />
              {person.name}
            </button>
          );
        })}

        {adding ? (
          <span className="person-add">
            <input
              autoFocus
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => {
                // フォームの中なので、Enterがそのまま予定の保存に化けないよう止める。
                if (e.key === "Enter") {
                  e.preventDefault();
                  void add();
                }
                if (e.key === "Escape") {
                  setDraftName("");
                  setAdding(false);
                }
              }}
              placeholder="例: 妻"
              aria-label="足す人の名前"
              maxLength={20}
            />
            <button type="button" className="person-chip" onClick={() => void add()}>
              足す
            </button>
            <button
              type="button"
              className="person-manage__remove"
              aria-label="やめる"
              onClick={() => {
                setDraftName("");
                setAdding(false);
              }}
            >
              <X size={15} />
            </button>
          </span>
        ) : (
          <button type="button" className="person-chip person-chip--add" onClick={() => setAdding(true)}>
            <Plus size={14} />
            追加
          </button>
        )}
      </div>
    </Field>
  );
}
