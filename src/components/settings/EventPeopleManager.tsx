import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Trash2, UsersRound } from "lucide-react";
import { db } from "../../db/schema";
import type { EventPerson } from "../../types";
import {
  PERSON_COLORS,
  getPersonColor,
  nextPersonColor,
  nextSortOrder,
  personIdsOf,
  sortPeople,
} from "../../lib/eventPeople";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { useToast } from "../ui/ToastProvider";
import { useConfirm } from "../ui/ConfirmProvider";

/**
 * 設定の「誰の予定か」。名前の変更・色の変更・削除をここでまとめて行う。
 * 足すだけなら予定を書いている最中にもできる(src/components/calendar/EventPeopleField.tsx)。
 *
 * 削除は、その人が付いている予定から印だけを外す。予定そのものは消さない —
 * 「妻」を消したいだけで予定まで消えたら取り返しがつかないため。
 */
export function EventPeopleManager() {
  const peopleResult = useLiveQuery(() => db.eventPeople.toArray(), []);
  const people = sortPeople(peopleResult ?? []);
  const [draftName, setDraftName] = useState("");
  const showToast = useToast();
  const confirm = useConfirm();

  async function add(): Promise<void> {
    const name = draftName.trim();
    if (!name) return;
    if (people.some((person) => person.name === name)) {
      showToast(`「${name}」はもう登録されています`, "error");
      return;
    }
    await db.eventPeople.add({
      name,
      color: nextPersonColor(people),
      sortOrder: nextSortOrder(people),
      createdAt: Date.now(),
    });
    setDraftName("");
    showToast(`「${name}」を足しました`);
  }

  async function rename(person: EventPerson, name: string): Promise<void> {
    if (!person.id) return;
    // 空にはできない。名前が消えると予定の側は色だけになり、どれが誰か分からなくなる。
    const next = name.trim();
    if (!next || next === person.name) return;
    await db.eventPeople.update(person.id, { name: next });
  }

  async function recolor(person: EventPerson, color: string): Promise<void> {
    if (!person.id) return;
    await db.eventPeople.update(person.id, { color });
  }

  async function remove(person: EventPerson): Promise<void> {
    if (!person.id) return;
    const ok = await confirm({
      title: `「${person.name}」を消しますか?`,
      message: "付けてある予定は消えません(印だけ外れます)。",
      confirmLabel: "消す",
    });
    if (!ok) return;
    const personId = person.id;
    await db.transaction("rw", db.eventPeople, db.calendarEvents, async () => {
      const affected = await db.calendarEvents.filter((event) => personIdsOf(event).includes(personId)).toArray();
      for (const event of affected) {
        if (!event.id) continue;
        await db.calendarEvents.update(event.id, {
          personIds: personIdsOf(event).filter((id) => id !== personId),
        });
      }
      await db.eventPeople.delete(personId);
    });
    showToast(`「${person.name}」を消しました`);
  }

  return (
    <Card className="system-section system-section--people">
      <div className="system-section__header">
        <div className="system-section__identity">
          <span>
            <UsersRound size={17} />
          </span>
          <div>
            <h2>誰の予定か</h2>
          </div>
        </div>
        <div className={`system-status ${people.length > 0 ? "is-online" : ""}`}>
          <i />
          {people.length > 0 ? `${people.length} 人` : "未設定"}
        </div>
      </div>
      <p className="system-section__description text-xs text-slate-500">
        カレンダーの予定に「誰の予定か」を付けられるようにします。付けた予定は、その人の色の点で月の表に出ます。
        仕事・プライベートなどのカテゴリとは別の印なので、両方を付けられます。1件の予定に何人でも付けられます。
      </p>

      {people.length > 0 && (
        <div className="person-manage">
          {people.map((person) => (
            <div className="person-manage__row" key={person.id}>
              <input
                type="text"
                defaultValue={person.name}
                aria-label={`${person.name}の名前`}
                maxLength={20}
                onBlur={(e) => void rename(person, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
              />
              <div className="person-manage__colors" role="group" aria-label={`${person.name}の色`}>
                {PERSON_COLORS.map((color) => (
                  <button
                    key={color.value}
                    type="button"
                    className={`person-manage__color${getPersonColor(person.color).value === color.value ? " is-on" : ""}`}
                    style={{ ["--person" as string]: color.hex }}
                    aria-label={color.label}
                    aria-pressed={getPersonColor(person.color).value === color.value}
                    onClick={() => void recolor(person, color.value)}
                  />
                ))}
              </div>
              <button
                type="button"
                className="person-manage__remove"
                aria-label={`${person.name}を消す`}
                onClick={() => void remove(person)}
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="person-manage__row mt-3">
        <input
          type="text"
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void add();
            }
          }}
          placeholder="例: 自分、妻、子供"
          aria-label="足す人の名前"
          maxLength={20}
        />
        <Button variant="secondary" onClick={() => void add()} disabled={!draftName.trim()}>
          足す
        </Button>
      </div>
    </Card>
  );
}
