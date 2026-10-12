import { useState } from "react";
import { NOTE_CATEGORIES } from "../../lib/categories";
import { SegmentedField } from "../ui/SegmentedField";

interface Props {
  value: string;
  onChange: (value: string) => void;
}

/**
 * メモ・チェックリスト・買い物リストのカテゴリ。名前は前のまま(CategorySelect)だが、中身はボタン。
 *
 * プルダウンにしないのは、iPhone ではシートの中のプルダウンを押すとキーボードが閉じてシートが動き、
 * 選択肢が欄から離れた所に出て、押したつもりが外れるため(2026-10-12。2026-10-11の持ち物と同じ直し方)。
 * 4つとも全部見えて1回で選べる。並び・2列は予定の画面のカテゴリ(EventForm)とそろえる。
 */
export function CategorySelect({ value, onChange }: Props) {
  // 一覧に無いカテゴリ(前の版や取り込みで入った独自の名前)のメモを開いた時は、末尾に1つ足して
  // 選んだ状態で見せる。開いた時の値で決める — 今の値で決めると、ほかを押した途端に消えて戻せなくなる。
  const [legacyValue] = useState(() => (value && !NOTE_CATEGORIES.includes(value) ? value : undefined));
  const categories = legacyValue ? [...NOTE_CATEGORIES, legacyValue] : NOTE_CATEGORIES;

  return (
    <SegmentedField
      label="カテゴリ"
      value={value}
      options={categories.map((c) => ({ value: c, label: c }))}
      onChange={onChange}
      columns={2}
      separate
    />
  );
}
