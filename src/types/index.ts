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
  updatedAt?: number;
  deviceId?: string;
  userId?: string;
}

/** One itemized deduction line from a payslip, e.g. { label: "厚生年金保険料", amount: 25000 }. */
export interface SalaryDeductionItem {
  label: string;
  amount: number;
}

export interface SalaryEntry {
  id?: string;
  /** Month this salary applies to, e.g. "2026-08". */
  month: string;
  payday: number; // 1-31, clamped to the last day of short months
  /** Take-home pay (差引支給額) — the figure the budget calculation uses as income. */
  amount: number;
  /** Gross pay before deductions (総支給額), when known from an imported payslip. */
  grossAmount?: number;
  /** Itemized deductions parsed from an imported payslip CSV; absent for manually-entered salaries. */
  deductions?: SalaryDeductionItem[];
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
  /** 同じ予定を複数のアカウントに入れた時、それらに共通で付ける印。これがあるから
   * 片方を直した時に、入れた先のアカウントの「同じ予定」を見つけて一緒に直せる
   * (src/lib/crossAccountEvents.ts)。1つのアカウントにしか無い予定には付かない。 */
  linkId?: string;
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
  /** 終了時刻(移動なら到着時刻)。分かる時だけ。予定(CalendarEvent)のendTimeに揃えている。 */
  endTime?: string; // HH:mm
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

export interface TripRoutePlace {
  id?: string;
  tripId: string;
  name: string;
  /** 地図にそのまま渡す文字列。住所でも施設名でもよい(キー無しの埋め込みURLは
   * どちらも解決できる)。空にはしない — 空だと地図が行き先ごと迷子になる。 */
  address: string;
  /** 回る順。1始まりの連番で詰めて持ち、並べ替えのたびに振り直す。 */
  sortOrder: number;
  /** 何日目に回るか(YYYY-MM-DD)。決めていない場所もあるので任意。ルート画面の
   * 日にち切り替えはこれで絞る。 */
  date?: string;
  memo?: string;
  visited: boolean;
  createdAt: number;
  updatedAt?: number;
  deviceId?: string;
  userId?: string;
}

export type DiaryMood = "good" | "normal" | "bad";

export interface DiaryEntry {
  id?: string;
  date: string; // YYYY-MM-DD
  body: string;
  /** どの旅行の日か。旅行の外で書いた日は付かない。索引は張らない —
   * 日記は件数が少なく、旅行1件ぶんの絞り込みはJS側で足りる。 */
  tripId?: string;
  mood?: DiaryMood;
  /** 書いた場所。端末の位置情報から取る。地名の文字は自分で付ける(placeLabel)。 */
  latitude?: number;
  longitude?: number;
  placeLabel?: string;
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
  /** When this app's own mail-detail page (GmailMailPage) was first opened for this email —
   * independent of `status`, which tracks AI-draft/send workflow progress rather than
   * whether a human has actually looked at it. Undefined until read. */
  readAt?: number;
  /** 「重要」を付けた時刻。外すと undefined に戻る。タブの絞り込みはJS側で行うので
   * 索引は要らず、Dexieのバージョンも上げていない。 */
  importantAt?: number;
  /** readAt/importantAt/status を最後に人が変えた時刻。端末間で状態を揃える時の
   * last-write-wins の基準(src/lib/gmailMessageState.ts)。索引は不要なので
   * Dexieのバージョンは上げていない。 */
  stateUpdatedAt?: number;
}

export interface DraftReply {
  id?: string;
  emailId: string; // -> SyncedEmail.id
  accountId: string;
  to?: string; // user-editable reply recipient; defaults to the original sender's address
  subject?: string; // user-editable, AI-suggested reply subject (already includes "Re: ")
  userNotes?: string; // free-text instructions the user wants the AI draft to incorporate
  body: string;
  createdAt: number;
  updatedAt?: number;
  sentAt?: number;
}

/** A sender address hidden from this app's inbox view. Gmail itself is never
 * touched — matching SyncedEmail rows are only filtered out of the UI. */
export interface BlockedSender {
  id?: string;
  accountId: string;
  email: string; // lowercased address, e.g. "spam@example.com"
  createdAt: number;
  /** Set once this block is confirmed present in Supabase's blocked_senders table.
   * Un-indexed (no Dexie version bump needed) and read only by src/lib/blockedSenders.ts,
   * where it separates "never pushed" from "unblocked on another device". */
  pushedAt?: number;
}

export interface Settings {
  id?: string;
  monthlyIncome: number;
  savingsGoalMonthly: number;
  /** Manually-confirmed PayPay balance, anchored at paypayBalanceUpdatedAt. */
  paypayBalance: number;
  paypayBalanceUpdatedAt: number;
  /** Auto-generates an AI draft for each newly-synced email (GmailInbox's
   * handleSync). Deliberately separate from any push/notification setting —
   * this only controls draft generation, never sending; sending still always
   * requires the user to press 送信する in DraftReview. */
  autoDraftEnabled: boolean;
}
