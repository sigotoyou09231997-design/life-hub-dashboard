export type TransactionType = "income" | "expense";

export interface Transaction {
  id?: string;
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
  updatedAt?: number;
  /** Present once a row has been touched by the sync engine; absent for purely local, never-synced data. */
  deviceId?: string;
  userId?: string;
}

/** One row from an imported PayPay transaction history CSV, kept for
 * balance tracking even when it doesn't become a household Transaction
 * (e.g. wallet charges, bank withdrawals, point-to-balance conversions). */
export interface PayPayLedgerEntry {
  id?: string;
  externalId: string;
  date: string; // YYYY-MM-DD
  amount: number; // signed: deposit - withdrawal
  content: string;
  counterparty: string;
  importedAt: number;
}

export interface SalaryEntry {
  id?: string;
  /** Month this salary applies to, e.g. "2026-08". */
  month: string;
  payday: number; // 1-31, clamped to the last day of short months
  amount: number;
  createdAt: number;
  updatedAt?: number;
  deviceId?: string;
  userId?: string;
}

export interface FixedCost {
  id?: string;
  title: string;
  category: string;
  amount: number;
  dueDay: number; // 1-31
  active: boolean;
  updatedAt?: number;
  deviceId?: string;
  userId?: string;
}

export type ScheduleCategory = "work" | "private" | "important" | "other";

export interface CalendarEvent {
  id?: string;
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
  updatedAt?: number;
  deviceId?: string;
  userId?: string;
}

export type Priority = "low" | "medium" | "high";
export type RepeatRule = "none" | "daily" | "weekly" | "monthly";

export interface Task {
  id?: string;
  title: string;
  priority: Priority;
  dueDate?: string; // YYYY-MM-DD
  dueTime?: string; // HH:mm
  category?: ScheduleCategory;
  notifyMinutesBefore?: number;
  notifiedAt?: number;
  completed: boolean;
  completedAt?: number;
  parentTaskId?: string;
  repeat: RepeatRule;
  createdAt: number;
  updatedAt?: number;
  deviceId?: string;
  userId?: string;
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
  id?: string;
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
  updatedAt?: number;
  deviceId?: string;
  userId?: string;
}

export type Mood = "great" | "good" | "okay" | "bad" | "terrible";

export interface DiaryEntry {
  id?: string;
  date: string; // YYYY-MM-DD
  content: string;
  photos: Blob[];
  mood: Mood;
  satisfaction: number; // 1-5
  createdAt: number;
  updatedAt?: number;
  deviceId?: string;
  userId?: string;
}

export interface Goal {
  id?: string;
  title: string;
  deadline?: string; // YYYY-MM-DD
  progress: number; // 0-100
  category?: string;
  targetAmount?: number;
  currentAmount?: number;
  createdAt: number;
  updatedAt?: number;
  deviceId?: string;
  userId?: string;
}

export interface Habit {
  id?: string;
  title: string;
  active: boolean;
  createdAt: number;
  updatedAt?: number;
  deviceId?: string;
  userId?: string;
}

export interface HabitLog {
  id?: string;
  habitId: string;
  date: string; // YYYY-MM-DD
  done: boolean;
  updatedAt?: number;
  deviceId?: string;
  userId?: string;
}

export type TripStatus = "planning" | "ongoing" | "completed";

export interface Trip {
  id?: string;
  name: string;
  destination: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  memo?: string;
  status: TripStatus;
  budget?: number;
  createdAt: number;
  updatedAt?: number;
  deviceId?: string;
  userId?: string;
}

export type TripScheduleType = "sightseeing" | "meal" | "transport" | "lodging" | "other";

export interface TripScheduleItem {
  id?: string;
  tripId: string;
  date: string; // YYYY-MM-DD
  startTime?: string; // HH:mm
  title: string;
  location?: string;
  memo?: string;
  type: TripScheduleType;
  createdAt: number;
  updatedAt?: number;
  deviceId?: string;
  userId?: string;
}

export type TripExpenseCategory = "transport" | "lodging" | "meal" | "sightseeing" | "shopping" | "other";

export interface TripExpense {
  id?: string;
  tripId: string;
  title: string;
  amount: number;
  category: TripExpenseCategory;
  paidDate?: string; // YYYY-MM-DD
  paid: boolean;
  memo?: string;
  createdAt: number;
  updatedAt?: number;
  deviceId?: string;
  userId?: string;
}

export type TripPackingCategory = "essentials" | "clothing" | "electronics" | "documents" | "other";

export interface TripPackingItem {
  id?: string;
  tripId: string;
  title: string;
  category: TripPackingCategory;
  checked: boolean;
  createdAt: number;
  updatedAt?: number;
  deviceId?: string;
  userId?: string;
}

export interface GmailAccount {
  id?: string;
  email: string;
  accessToken: string;
  accessTokenExpiresAt: number; // epoch ms
  refreshToken: string;
  connectedAt: number;
  lastSyncedAt?: number;
}

export type EmailStatus = "unprocessed" | "generating" | "drafted" | "edited" | "sent" | "skipped";

export interface SyncedEmail {
  id?: string;
  accountId: string;
  gmailMessageId: string;
  threadId: string;
  from: string;
  subject: string;
  snippet: string;
  receivedAt: number; // epoch ms
  status: EmailStatus;
  createdAt: number;
}

export interface DraftReply {
  id?: string;
  emailId: string; // -> SyncedEmail.id
  accountId: string;
  body: string;
  createdAt: number;
  updatedAt?: number;
  sentAt?: number;
}

export interface Settings {
  id?: string;
  monthlyIncome: number;
  savingsGoalMonthly: number;
  notificationsEnabled: boolean;
  accentColor: string;
  /** Manually-confirmed PayPay balance, anchored at paypayBalanceUpdatedAt. */
  paypayBalance: number;
  paypayBalanceUpdatedAt: number;
}
