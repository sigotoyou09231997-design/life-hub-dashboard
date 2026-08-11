export type TransactionType = "income" | "expense";

export interface Transaction {
  id?: number;
  type: TransactionType;
  amount: number;
  category: string;
  method?: string;
  store?: string;
  memo?: string;
  date: string; // YYYY-MM-DD
  isFixed: boolean;
  /** Dedup key for rows imported from an external source (e.g. PayPay CSV). */
  externalId?: string;
  createdAt: number;
}

/** One row from an imported PayPay transaction history CSV, kept for
 * balance tracking even when it doesn't become a household Transaction
 * (e.g. wallet charges, bank withdrawals, point-to-balance conversions). */
export interface PayPayLedgerEntry {
  id?: number;
  externalId: string;
  date: string; // YYYY-MM-DD
  amount: number; // signed: deposit - withdrawal
  content: string;
  counterparty: string;
  importedAt: number;
}

export interface SalaryEntry {
  id?: number;
  /** Month this salary applies to, e.g. "2026-08". */
  month: string;
  payday: number; // 1-31, clamped to the last day of short months
  amount: number;
  createdAt: number;
}

export interface FixedCost {
  id?: number;
  title: string;
  category: string;
  amount: number;
  dueDay: number; // 1-31
  active: boolean;
}

export type ScheduleCategory = "work" | "private" | "important" | "other";

export interface CalendarEvent {
  id?: number;
  title: string;
  date: string; // YYYY-MM-DD
  startTime?: string; // HH:mm
  endTime?: string; // HH:mm
  allDay?: boolean;
  location?: string;
  memo?: string;
  category?: ScheduleCategory;
  notifyMinutesBefore?: number;
  notifiedAt?: number;
  createdAt: number;
}

export type Priority = "low" | "medium" | "high";
export type RepeatRule = "none" | "daily" | "weekly" | "monthly";

export interface Task {
  id?: number;
  title: string;
  priority: Priority;
  dueDate?: string; // YYYY-MM-DD
  dueTime?: string; // HH:mm
  category?: ScheduleCategory;
  notifyMinutesBefore?: number;
  notifiedAt?: number;
  completed: boolean;
  completedAt?: number;
  parentTaskId?: number;
  repeat: RepeatRule;
  createdAt: number;
}

export type NoteType = "memo" | "checklist" | "shopping";

export interface ChecklistItem {
  id: string;
  title: string;
  checked: boolean;
}

export interface ShoppingItem {
  id: string;
  name: string;
  quantity?: number;
  price?: number;
  purchased: boolean;
}

export interface Note {
  id?: number;
  // Absent on records created before the memo/checklist/shopping split;
  // resolve with getNoteType() rather than reading this directly.
  type?: NoteType;
  title: string;
  body: string;
  tags: string[];
  category?: string;
  pinned: boolean;
  checklistItems?: ChecklistItem[];
  shoppingItems?: ShoppingItem[];
  createdAt: number;
  updatedAt: number;
}

export type Mood = "great" | "good" | "okay" | "bad" | "terrible";

export interface DiaryEntry {
  id?: number;
  date: string; // YYYY-MM-DD
  content: string;
  photos: Blob[];
  mood: Mood;
  satisfaction: number; // 1-5
  createdAt: number;
}

export interface Goal {
  id?: number;
  title: string;
  deadline?: string; // YYYY-MM-DD
  progress: number; // 0-100
  category?: string;
  targetAmount?: number;
  currentAmount?: number;
  createdAt: number;
}

export interface Habit {
  id?: number;
  title: string;
  active: boolean;
  createdAt: number;
}

export interface HabitLog {
  id?: number;
  habitId: number;
  date: string; // YYYY-MM-DD
  done: boolean;
}

export type TripStatus = "planning" | "ongoing" | "completed";

export interface Trip {
  id?: number;
  name: string;
  destination: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  memo?: string;
  status: TripStatus;
  budget?: number;
  createdAt: number;
}

export type TripScheduleType = "sightseeing" | "meal" | "transport" | "lodging" | "other";

export interface TripScheduleItem {
  id?: number;
  tripId: number;
  date: string; // YYYY-MM-DD
  startTime?: string; // HH:mm
  title: string;
  location?: string;
  memo?: string;
  type: TripScheduleType;
  createdAt: number;
}

export type TripExpenseCategory = "transport" | "lodging" | "meal" | "sightseeing" | "shopping" | "other";

export interface TripExpense {
  id?: number;
  tripId: number;
  title: string;
  amount: number;
  category: TripExpenseCategory;
  paidDate?: string; // YYYY-MM-DD
  paid: boolean;
  memo?: string;
  createdAt: number;
}

export type TripPackingCategory = "essentials" | "clothing" | "electronics" | "documents" | "other";

export interface TripPackingItem {
  id?: number;
  tripId: number;
  title: string;
  category: TripPackingCategory;
  checked: boolean;
  createdAt: number;
}

export interface Settings {
  id?: number;
  monthlyIncome: number;
  savingsGoalMonthly: number;
  notificationsEnabled: boolean;
  accentColor: string;
  /** Manually-confirmed PayPay balance, anchored at paypayBalanceUpdatedAt. */
  paypayBalance: number;
  paypayBalanceUpdatedAt: number;
}
