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

/**
 * 支出・収入1件に付ける案件タグ(src/lib/projectTags.ts)。
 *
 * 個人開発の案件ごとの収支を、確定申告のために年間でまとめるためのもの。
 * タグは自由入力の文字列で、決まった一覧は持たない(2026-09-04の回答)。
 *
 * **同期の対象にしていない**(src/lib/syncRuntime.ts)。Transaction 自体に列を足すと、
 * その列が無い Supabase 側で同期が失敗する(列の追加は人が本番で流すSQL)。
 * そのため**タグは付けた端末にしか無い** — 年間集計を出す端末は1つに決めておくこと。
 */
export interface TransactionProjectTag {
  id?: string;
  /** Transaction.id。 */
  transactionId: string;
  /** 案件の名前。1件の収支につき1つ。 */
  tag: string;
  createdAt: number;
  updatedAt?: number;
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

/**
 * クレジットカードの「使ったが、まだ引き落とされていない」利用1件。
 *
 * カードは使ってから引き落としまで日数が空くので、支出(Transaction)として記録する
 * 前の分が「現在使える残額」に入ってこない。その差を埋めるために、カード会社の
 * 明細CSVから未確定のぶんだけをここへ取り込み、残額の計算で先に引く
 * (src/lib/pendingCardCharges.ts)。
 *
 * **確定したかどうかはこの行に持たない。** 同じ買い物の Transaction があるかを
 * その都度見て決める — 印を持つと、支出の側を消したときにここだけ「確定済み」の
 * まま取り残されて、二度と残額に戻ってこなくなる。
 *
 * **同期の対象にしていない**(src/lib/syncRuntime.ts)。取り込みは明細CSVを持っている
 * 端末で行うもので、Supabase側に受け皿の表を作る(人が本番で流すSQL)必要も無い。
 */
export interface PendingCardCharge {
  id?: string;
  /** 取り込みの重複よけ。同じCSVを2回読んでも増えない(PayPay取込と同じ考え方)。 */
  externalId: string;
  /** 利用日(引き落とし日ではない)。YYYY-MM-DD。 */
  date: string;
  /** 利用金額(円)。 */
  amount: number;
  store?: string;
  memo?: string;
  importedAt: number;
  createdAt: number;
  updatedAt?: number;
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
  /** 支払日の何日前に通知するか(0=当日)。未設定なら通知しない。 */
  notifyDaysBefore?: number;
  /** 直近で通知を送った月(YYYY-MM)。毎月の支払日ごとに1回だけ通知するための印で、
   * netlify/functions/checkRemindersAndNotify.tsがSupabase側で更新する。 */
  lastNotifiedMonth?: string;
  updatedAt?: number;
  deviceId?: string;
  userId?: string;
}

/**
 * 固定費の金額を変えた記録1件(値上げに後から気づくためのもの)。
 *
 * 金額そのものは FixedCost.amount が持ち続ける。ここに残すのは「いつ、いくらから
 * いくらになったか」だけで、いま払っている額の出どころにはならない。
 *
 * **同期の対象にしていない**(src/lib/syncRuntime.ts)。fixed_costs 側に履歴の列を
 * 足すには Supabase の列追加(人が本番で流すSQL)が要るため、まずは端末の中だけで
 * 貯める形にしてある。別の端末で金額を変えたぶんは、その端末の履歴にしか残らない。
 */
export interface FixedCostAmountChange {
  id?: string;
  /** FixedCost.id。 */
  fixedCostId: string;
  /** 変更前の金額(円)。 */
  previousAmount: number;
  /** 変更後の金額(円)。 */
  amount: number;
  /** 変えた時刻(epoch ms)。 */
  changedAt: number;
  createdAt: number;
  updatedAt?: number;
}

export type ScheduleCategory = "work" | "private" | "important" | "other";

/**
 * カレンダーの「誰の予定か」の印。仕事/プライベート/重要 のカテゴリとは別の軸で、
 * こちらは本人が名前も色も自由に決められる(カテゴリは固定の4つ)。
 *
 * アカウント(src/lib/accounts.ts)とは別物。アカウントを切り替えると端末内のDBごと
 * 入れ替わるので、1つのカレンダーに家族の予定を並べて色分けする用途には使えない。
 * だから予定そのものに持たせる。
 */
export interface EventPerson {
  id?: string;
  name: string;
  /** パレットの色id(src/lib/eventPeople.ts の PERSON_COLORS)。知らない値は既定色で描く。 */
  color: string;
  /** 並び順。カレンダーの点も、この順で最大3つまで出す。 */
  sortOrder: number;
  createdAt: number;
  updatedAt?: number;
  deviceId?: string;
  userId?: string;
}

export interface CalendarEvent {
  id?: string;
  title: string;
  /** 開始日。1日で終わる予定はこれだけを持つ。 */
  date: string; // YYYY-MM-DD
  /** 終了日(その日を含む)。宿泊や出張のように何日かにまたがる予定にだけ付く。
   * 無い＝1日で終わる、という読み方(src/lib/eventSpan.ts)。 */
  endDate?: string; // YYYY-MM-DD
  startTime?: string; // HH:mm
  endTime?: string; // HH:mm
  allDay?: boolean;
  location?: string;
  memo?: string;
  category?: ScheduleCategory;
  notifyMinutesBefore?: number;
  notifiedAt?: number;
  /** 繰り返し(Taskのrepeatと同じ選択肢)。"none"・未設定は繰り返さない単発の予定。
   * 繰り返す予定は、この行を書き換えずに将来の回をその都度計算で出す
   * (src/lib/eventSpan.ts の occursOn/spanDayIndex)。 */
  repeat?: RepeatRule;
  /** 繰り返しの最終日(その日を含む、YYYY-MM-DD)。空なら約2年先までを上限として
   * 続ける(src/lib/eventSpan.ts)。 */
  repeatUntil?: string;
  createdAt: number;
  updatedAt?: number;
  deviceId?: string;
  userId?: string;
  /** 「誰の予定か」。EventPerson.id の配列で、1件に何人でも付けられる
   * (「家族旅行＝自分＋妻＋子供」のような予定を1件で表せるようにするため)。
   * 名前ではなくidを持つので、あとで名前を変えても付け直さなくていい。
   * 未設定・空は「誰のとも決めていない予定」で、今までどおりの見え方のまま
   * (src/lib/eventPeople.ts)。 */
  personIds?: string[];
  /** 同じ予定を複数のアカウントに入れた時、それらに共通で付ける印。これがあるから
   * 片方を直した時に、入れた先のアカウントの「同じ予定」を見つけて一緒に直せる
   * (src/lib/crossAccountEvents.ts)。1つのアカウントにしか無い予定には付かない。 */
  linkId?: string;
}

export type Priority = "low" | "medium" | "high";
/** 曜日を複数選ぶ繰り返し。"weekdays:1,3,5"(0=日〜6=土)の形で、決め打ちの選択肢と
 * 同じ1つの文字列の中に収める — 予定・タスクの repeat は Supabase 側も text 列
 * 1つなので、別項目に分けると列の追加(SQL)が要る(src/lib/repeatRule.ts)。 */
export type WeekdayRepeat = `weekdays:${string}`;
export type RepeatRule = "none" | "daily" | "weekly" | "monthly" | WeekdayRepeat;

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
  /** 開始日。1日で終わる日程はこれだけを持つ。 */
  date: string; // YYYY-MM-DD
  /** 終了日(その日を含む)。宿泊のように何日かにまたがる日程にだけ付く。
   * 予定(CalendarEvent)の endDate に揃えている(src/lib/eventSpan.ts)。 */
  endDate?: string; // YYYY-MM-DD
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

/**
 * 旅行の支出1件を、現地通貨でいくら払ったか(src/lib/currency.ts)。
 *
 * **円の金額は TripExpense.amount のまま。** ここは「€45 を 171.5円/€ で換算した」
 * という内訳だけを持つ。合計・予算・予算超過の通知はどれも amount(円)を見ており、
 * 通貨の行が無い支出は今までどおり円として扱われる。
 *
 * **同期の対象にしていない**(src/lib/syncRuntime.ts)。TripExpense 自体に通貨の列を
 * 足すと、その列が無い Supabase 側で同期が失敗する(列の追加は人が本番で流すSQL)。
 * 2026-09-04に本人の指示で、端末内の別テーブルに持つ形にした。
 */
export interface TripExpenseCurrency {
  id?: string;
  /** TripExpense.id。 */
  expenseId: string;
  /** ISOの通貨コード("EUR" など)。 */
  currency: string;
  /** 現地通貨で払った金額。 */
  originalAmount: number;
  /** 1通貨あたりの円。まだレートを取れていない行(rateSource が "pending")は 0。
   * 名前が `rate` ではなく `exchangeRate` なのは Supabase 側の列名に合わせるため —
   * sync.ts の camelToSnake は `rate` を `rate` にしかせず、021 が作った
   * trip_expense_currencies.exchange_rate に入らない(下の Dexie v26 で改名済み)。 */
  exchangeRate: number;
  /** レートの出どころ。手で入れ直したものは "manual"(カードの実際のレートは
   * 公表値と違うことが多いので、上書きできるようにしてある)。
   * "pending" は「自動取得に失敗して、円の金額だけ手で入れた」状態 —
   * 次にその費用の編集画面を開いた時に、もう一度取りに行く(2026-09-04の指示)。 */
  rateSource: "api" | "manual" | "pending";
  createdAt: number;
  updatedAt?: number;
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
  /** Googleの更新用トークンが失効している（invalid_grant / revoked）と分かった時刻。
   * 入っている間は画面を開いた時の自動同期を止め、代わりに「つなぎ直す」を出す。
   * つなぎ直しに成功した時と、同期が通った時に 0 へ戻す。
   * 失効はGoogle側の事情で起きる（アクセスの取り消しのほか、OAuth同意画面が
   * 「テスト中」のままだと更新用トークンは7日で切れる）。 */
  reauthRequiredAt?: number;
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
  /** 「予定を追加しますか?」の提案に対して「あとで」を押した時刻。以後そのメールは
   * 提案として出さない。この端末だけの覚え書きで、索引も要らないため
   * Dexieのバージョンは上げていない(importantAtと同じ扱い)。 */
  planSuggestionDismissedAt?: number;
  /** 予定候補の判定に使う本文の先頭(引用部分を除いたもの)。
   *
   * 抜粋(snippet)は先頭200文字ほどしかなく、「日時は下記のとおり」と書いて実際の日時が
   * その後ろに来るメール(人材紹介会社の面接案内など)を拾えなかったため、同期のときに
   * 案内らしいメールだけ本文の頭も取り込む(src/lib/gmailSync.ts)。取りに行った結果
   * 何も無かった場合は空文字が入る(何度も取りに行かないため)。索引は要らないので
   * Dexieのバージョンは上げていない。 */
  planText?: string;
  /** 「支出に追加しますか?」の提案に対して「あとで」を押した(または追加した)時刻。
   * 以後そのメールは支出の候補として出さない。planSuggestionDismissedAt と同じで、
   * この端末だけの覚え書き・索引は不要のためDexieのバージョンは上げていない。 */
  expenseSuggestionDismissedAt?: number;
  /** 「就活タブの進捗を進めますか?」の提案に対して「あとで」を押した(または
   * 反映した)時刻。以後そのメールは提案として出さない。planSuggestionDismissedAt
   * と同じで、この端末だけの覚え書き・索引は不要のためDexieのバージョンは上げていない。 */
  jobStageSuggestionDismissedAt?: number;
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

/** 就活の応募先が今どの段階にいるか。 */
export type JobApplicationStage =
  | "applied"
  | "document"
  | "interview1"
  | "interview2"
  | "final"
  | "offer"
  | "rejected"
  | "declined";

/** 就活の応募先1件。端末内のみ — 同期の対象にはしていない(src/lib/syncRuntime.ts)。 */
export interface JobApplication {
  id?: string;
  companyName: string;
  /** 職種・ポジション。書かなくてよい。 */
  role?: string;
  stage: JobApplicationStage;
  /** 次の面接などの日。YYYY-MM-DD。 */
  nextDate?: string;
  /** 次の予定の時刻。HH:mm。 */
  nextTime?: string;
  memo?: string;
  /** 「予定に入れる」で作ったカレンダー予定のid。予定の側を消しても
   * ここは残る(開くときに実物があるか確かめる)。 */
  linkedEventId?: string;
  createdAt: number;
  updatedAt?: number;
  deviceId?: string;
  userId?: string;
}

/** 名前を付けて複数持てる貯金目標(「旅行用」「生活防衛費用」など)。
 * 端末内のみ — 同期の対象にはしていない(src/lib/syncRuntime.ts)。 */
export interface SavingsGoal {
  id?: string;
  name: string;
  /** 毎月これだけ残したい金額(円)。 */
  monthlyAmount: number;
  createdAt: number;
  updatedAt?: number;
  deviceId?: string;
  userId?: string;
}

/**
 * 旅行の書類ポケット1件(パスポート番号・予約確認番号・宿の住所など)。
 *
 * 写真はメモ・日記と同じ attachments テーブルへ、ownerType "tripDocument" で貼る
 * (src/lib/attachments.ts)。
 *
 * **同期の対象にしていない**(src/lib/syncRuntime.ts)。旅行の他のデータと違って
 * ここに入るのは身分証の番号や予約の控えなので、端末の中だけに置く。
 * 同じ理由でバックアップ(src/lib/backup.ts)にも入れていない。
 */
export interface TripDocument {
  id?: string;
  tripId: string;
  /** 何の控えか(「パスポート」「宿の予約」)。 */
  title: string;
  /** 番号・住所などの本文。写真だけ貼って本文は空、でもよい。 */
  body?: string;
  /** 並び順。1始まりの連番で詰めて持ち、並べ替えのたびに振り直す
   * (tripRoutePlaces と同じ持ち方)。 */
  sortOrder: number;
  createdAt: number;
  updatedAt?: number;
}

/** 写真を貼れる相手。メモ・日記に加えて、旅行の書類ポケット。 */
export type AttachmentOwnerType = "note" | "diary" | "tripDocument";

/** メモ・日記に貼った写真1枚。
 *
 * 写真そのもの(Blob)をこのテーブルに置き、メモ・日記の行には何も足さない。
 * notes と diaryEntries はSupabaseへ同期しているので、行の中に写真を抱えると
 * 同期の1行が数MBになり、送る側でも受ける側でも詰まる。ここは同期の対象にせず
 * (src/lib/syncRuntime.ts)、端末の中だけに置く。
 *
 * 同じ理由でバックアップ(src/lib/backup.ts)にも含めていない — あれはJSONなので、
 * Blobを入れても空のオブジェクトになって復元できない。 */
export interface Attachment {
  id?: string;
  ownerType: AttachmentOwnerType;
  /** Note.id / DiaryEntry.id。 */
  ownerId: string;
  /** 選んだときのファイル名。一覧では出さないが、何の写真か分かる手がかりとして残す。 */
  name: string;
  mediaType: string;
  /** 画像そのもの。長辺1600pxのJPEGに縮めてから持つ(src/lib/attachments.ts)。 */
  blob: Blob;
  /** 縮めた後の大きさ(バイト)。 */
  size: number;
  createdAt: number;
  updatedAt?: number;
}

/** カテゴリごとの使いすぎの目安(「食費は月3万円まで」)。全体の予算(給与 - 固定費)は
 * 今までどおり給与から計算するもので、これはそれとは別に持つ追加の上限。
 * 2026-09-05 から**同期の対象**(supabase/sql/024_category_budgets.sql の
 * category_budgets / src/lib/syncRuntime.ts)。上限がサーバーから見えるので、
 * アプリを開いていない日でも使いすぎ予測を Web Push で送れる。 */
export interface CategoryBudget {
  id?: string;
  /** 支出のカテゴリ名(src/lib/categories.ts の EXPENSE_CATEGORIES と同じ文字列)。 */
  category: string;
  /** 1か月あたりの上限(円)。集計は給料日から次の給料日までの1期で見る
   * (src/lib/categoryBudget.ts)。 */
  monthlyAmount: number;
  createdAt: number;
  updatedAt?: number;
  deviceId?: string;
  userId?: string;
}

/** 場所リマインドを付けられる相手。タスクと、メモ・リスト(買い物リストを含む)。 */
export type PlaceReminderOwnerType = "task" | "note";

/** その場所に「入ったら」か「出たら」か。 */
export type PlaceReminderTrigger = "enter" | "leave";

/**
 * 「駅に着いたら買い物リストを見る」のような、場所をきっかけにしたリマインド1件。
 *
 * **アプリを開いている間しか判定できない。** ブラウザ・PWAには地点監視(Geofencing)の
 * 仕組みが無く(Androidは2018年に取り下げ、iOS Safariには元から無い)、Service Worker
 * からは位置情報が取れない。つまり「アプリを閉じている間に、駅に着いたら通知」は
 * どの端末でも作れない。ここが見るのは、アプリを開いた時と、開いている間の定期的な
 * 現在地だけ(src/lib/placeReminders.ts)。2026-09-04に本人がこの範囲で了解している。
 *
 * **同期の対象にしていない**(src/lib/syncRuntime.ts)。タスク・メモの側に緯度経度の列を
 * 足すには Supabase の列追加(人が本番で流すSQL)が要るので、別のテーブルに逃がして
 * 端末の中だけに置く。付けた端末でだけ鳴る。
 */
export interface PlaceReminder {
  id?: string;
  ownerType: PlaceReminderOwnerType;
  /** Task.id / Note.id。 */
  ownerId: string;
  /** 場所の名前(通知の本文に出す)。「東京駅」など。 */
  label: string;
  latitude: number;
  longitude: number;
  /** この距離まで近づいたら「入った」とみなす(m)。 */
  radiusMeters: number;
  trigger: PlaceReminderTrigger;
  /**
   * 直近に現在地を見たとき、範囲の中にいたか。入った/出たは、この前回の値と
   * 見比べて決める。undefined は「まだ一度も見ていない」。
   */
  inside?: boolean;
  /** 直近で知らせた時刻(epoch ms)。境目を行き来しても鳴り続けないための印。 */
  lastNotifiedAt?: number;
  createdAt: number;
  updatedAt?: number;
}

export interface Settings {
  id?: string;
  monthlyIncome: number;
  /** @deprecated 貯金目標は savingsGoals テーブルへ移した(schema.ts の v15)。
   * 移行元としてだけ残してある — 画面はもう読まない。 */
  savingsGoalMonthly: number;
  /** Manually-confirmed PayPay balance, anchored at paypayBalanceUpdatedAt. */
  paypayBalance: number;
  paypayBalanceUpdatedAt: number;
  /** 財布の中の現金。PayPay残高と同じで、手入力した額を起点(cashBalanceUpdatedAt)に、
   * それ以降に記録した「現金」の収支を足し引きして推定する。
   * 起点を入れる前から使っている端末では未設定(undefined)になり得る。 */
  cashBalance?: number;
  cashBalanceUpdatedAt?: number;
  /** Auto-generates an AI draft for each newly-synced email (GmailInbox's
   * handleSync). Deliberately separate from any push/notification setting —
   * this only controls draft generation, never sending; sending still always
   * requires the user to press 送信する in DraftReview. */
  autoDraftEnabled: boolean;
}
