import { FileText, ListChecks, ShoppingCart } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Note, NoteType } from "../types";

type BadgeTone = "accent" | "success" | "danger" | "neutral" | "warning";

export interface NoteTypeDef {
  value: NoteType;
  label: string;
  tone: BadgeTone;
  icon: LucideIcon;
}

export const NOTE_TYPE_DEFS: NoteTypeDef[] = [
  { value: "memo", label: "メモ", tone: "accent", icon: FileText },
  { value: "checklist", label: "チェックリスト", tone: "success", icon: ListChecks },
  { value: "shopping", label: "買い物リスト", tone: "warning", icon: ShoppingCart },
];

export function getNoteType(note: Note): NoteType {
  return note.type ?? "memo";
}

export function getNoteTypeDef(type: NoteType): NoteTypeDef {
  return NOTE_TYPE_DEFS.find((d) => d.value === type) ?? NOTE_TYPE_DEFS[0];
}

export function moveItem<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;
  if (target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
