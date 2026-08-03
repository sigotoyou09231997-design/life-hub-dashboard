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

export interface CalendarEvent {
  id?: number;
  title: string;
  date: string; // YYYY-MM-DD
  startTime?: string; // HH:mm
  endTime?: string; // HH:mm
  location?: string;
  memo?: string;
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
  notifyMinutesBefore?: number;
  notifiedAt?: number;
  completed: boolean;
  completedAt?: number;
  parentTaskId?: number;
  repeat: RepeatRule;
  createdAt: number;
}

export interface Note {
  id?: number;
  title: string;
  body: string;
  tags: string[];
  category?: string;
  pinned: boolean;
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

export interface Settings {
  id?: number;
  monthlyIncome: number;
  savingsGoalMonthly: number;
  notificationsEnabled: boolean;
  accentColor: string;
}
