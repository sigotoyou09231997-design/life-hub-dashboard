import Dexie, { type EntityTable } from "dexie";
import type {
  Transaction,
  FixedCost,
  CalendarEvent,
  Task,
  Note,
  DiaryEntry,
  Goal,
  Habit,
  HabitLog,
  Settings,
} from "../types";

export class LifeHubDB extends Dexie {
  transactions!: EntityTable<Transaction, "id">;
  fixedCosts!: EntityTable<FixedCost, "id">;
  calendarEvents!: EntityTable<CalendarEvent, "id">;
  tasks!: EntityTable<Task, "id">;
  notes!: EntityTable<Note, "id">;
  diaryEntries!: EntityTable<DiaryEntry, "id">;
  goals!: EntityTable<Goal, "id">;
  habits!: EntityTable<Habit, "id">;
  habitLogs!: EntityTable<HabitLog, "id">;
  settings!: EntityTable<Settings, "id">;

  constructor() {
    super("life-hub");

    // Note: IndexedDB key paths cannot be boolean, so flags like isFixed/active/
    // completed/pinned are intentionally left un-indexed and filtered in JS.
    this.version(1).stores({
      transactions: "++id, type, date, category",
      fixedCosts: "++id",
      calendarEvents: "++id, date",
      tasks: "++id, dueDate, parentTaskId",
      notes: "++id, *tags",
      diaryEntries: "++id, date",
      goals: "++id, deadline",
      habits: "++id",
      habitLogs: "++id, habitId, date, [habitId+date]",
      settings: "++id",
    });
  }
}

export const db = new LifeHubDB();

export async function ensureDefaultSettings(): Promise<Settings> {
  const existing = await db.settings.toCollection().first();
  if (existing) return existing;

  const defaults: Settings = {
    monthlyIncome: 0,
    savingsGoalMonthly: 0,
    notificationsEnabled: false,
    accentColor: "#4f46e5",
  };
  const id = await db.settings.add(defaults);
  return { ...defaults, id };
}
