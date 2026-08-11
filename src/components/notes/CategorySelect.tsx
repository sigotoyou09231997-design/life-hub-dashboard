import { NOTE_CATEGORIES } from "../../lib/categories";
import { Select } from "../ui/Select";

interface Props {
  value: string;
  onChange: (value: string) => void;
}

export function CategorySelect({ value, onChange }: Props) {
  const isLegacyValue = value && !NOTE_CATEGORIES.includes(value);

  return (
    <Select label="カテゴリ" value={value} onChange={(e) => onChange(e.target.value)}>
      {isLegacyValue && <option value={value}>{value}</option>}
      {NOTE_CATEGORIES.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </Select>
  );
}
