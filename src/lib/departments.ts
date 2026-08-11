export type Department = "money" | "schedule" | "notes" | "trips" | "gmail";

export interface DepartmentDef {
  value: Department;
  label: string;
}

export const DEPARTMENTS: DepartmentDef[] = [
  { value: "money", label: "お金管理担当" },
  { value: "schedule", label: "予定・タスク管理担当" },
  { value: "notes", label: "メモ・リスト担当" },
  { value: "trips", label: "旅行計画担当" },
  { value: "gmail", label: "Gmail AI自動返信担当" },
];

export function getDepartment(value: Department): DepartmentDef {
  return DEPARTMENTS.find((d) => d.value === value) ?? DEPARTMENTS[0];
}
