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
  PayPayLedgerEntry,
  SalaryEntry,
  Trip,
  TripScheduleItem,
  TripExpense,
  TripPackingItem,
  GmailAccount,
  SyncedEmail,
  DraftReply,
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
  paypayTransactions!: EntityTable<PayPayLedgerEntry, "id">;
  salaries!: EntityTable<SalaryEntry, "id">;
  trips!: EntityTable<Trip, "id">;
  tripSchedule!: EntityTable<TripScheduleItem, "id">;
  tripExpenses!: EntityTable<TripExpense, "id">;
  tripPackingItems!: EntityTable<TripPackingItem, "id">;
  gmailAccounts!: EntityTable<GmailAccount, "id">;
  syncedEmails!: EntityTable<SyncedEmail, "id">;
  draftReplies!: EntityTable<DraftReply, "id">;

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

    this.version(2).stores({
      transactions: "++id, type, date, category, externalId",
      paypayTransactions: "++id, externalId, importedAt",
    });

    this.version(3).stores({
      salaries: "++id, month",
    });

    this.version(4).stores({
      trips: "++id",
      tripSchedule: "++id, tripId",
      tripExpenses: "++id, tripId",
      tripPackingItems: "++id, tripId",
    });

    // Gmail連携用。refreshTokenとメール本文を含むため、バックアップ書き出し(backup.ts)の対象からは意図的に除外する。
    this.version(5).stores({
      gmailAccounts: "++id, email",
      syncedEmails: "++id, accountId, gmailMessageId, receivedAt, status, [accountId+gmailMessageId]",
      draftReplies: "++id, emailId, accountId, status",
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
    accentColor: "#2563eb",
    paypayBalance: 0,
    paypayBalanceUpdatedAt: 0,
  };
  const id = await db.settings.add(defaults);
  return { ...defaults, id };
}
