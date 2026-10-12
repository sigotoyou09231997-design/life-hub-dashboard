import type { ElementType } from "react";
import {
  CalendarDays,
  CalendarPlus,
  History,
  Landmark,
  LineChart,
  ListTodo,
  Mail,
  NotebookPen,
  Plane,
  Repeat,
  Settings,
  StickyNote,
  UserRound,
  Wallet,
} from "lucide-react";

/*
 * まとめて検索(src/components/layout/GlobalSearch.tsx)を「探す」だけでなく
 * 「やりたいことへ飛ぶ」入口にもするための、操作の一覧と照らし合わせ。
 *
 * 操作の行き先は、どれも各画面がすでに受けている印(?new= / ?view= / ?tab=)を使う。
 * 新しい開き方を作らないのは、アプリアイコン長押しの近道(vite.config.ts)と
 * 同じ道を通すことで、片方だけ壊れることがないようにするため。
 */

/** 画面そのもの。「〇〇を開く」の操作と、「最近見たもの」の画面の行に使う。
 * 名前はサイドバー(DesktopSidebar.tsx)・各画面の見出しと同じにしてある。
 * ホームは入れない — ロゴ・ホームのボタンでいつでも1回で戻れるため。 */
export interface AppPage {
  path: string;
  label: string;
  icon: ElementType;
  keywords: string[];
}

export const APP_PAGES: AppPage[] = [
  { path: "/schedule", label: "予定・タスク", icon: CalendarDays, keywords: ["予定", "タスク", "カレンダー", "スケジュール", "やること", "就活"] },
  { path: "/records/expense", label: "お金管理", icon: Landmark, keywords: ["お金", "家計", "支出", "収入", "給与", "カード", "PayPay"] },
  { path: "/records/notes", label: "メモ・リスト", icon: NotebookPen, keywords: ["メモ", "リスト", "買い物", "チェックリスト", "日記"] },
  { path: "/gmail", label: "Gmail", icon: Mail, keywords: ["メール", "受信"] },
  { path: "/trips", label: "旅行計画", icon: Plane, keywords: ["旅行", "旅", "しおり"] },
  { path: "/review", label: "ふりかえり", icon: LineChart, keywords: ["振り返り", "レビュー", "使い方"] },
  { path: "/settings", label: "設定", icon: Settings, keywords: ["せってい", "通知", "背景"] },
  { path: "/account", label: "アカウント", icon: UserRound, keywords: ["ログイン", "同期", "プロフィール"] },
  { path: "/changelog", label: "更新履歴", icon: History, keywords: ["アップデート", "お知らせ", "変更"] },
];

export function findAppPage(path: string): AppPage | undefined {
  return APP_PAGES.find((page) => page.path === path);
}

export interface PaletteAction {
  id: string;
  label: string;
  /** 行の2行目。どの画面で開くかを一言で。 */
  hint: string;
  to: string;
  icon: ElementType;
  /** 名前に入っていないが、そう打つ人がいそうな言い方。 */
  keywords: string[];
  /** 何も打っていない時の「よく使う操作」に出すか。 */
  pinned?: boolean;
}

/** 書き足す・よく見るもの。何も打っていない時に出るのは pinned の付いたものだけで、
 * 打った時は画面へ飛ぶ操作(下の APP_PAGES から作る)も合わせて探す。 */
const ADD_AND_VIEW_ACTIONS: PaletteAction[] = [
  {
    id: "add-expense",
    label: "支出を追加",
    hint: "お金管理",
    to: "/records/expense?new=expense",
    icon: Wallet,
    keywords: ["出費", "お金", "家計", "収入", "レシート", "払った", "買った"],
    pinned: true,
  },
  {
    id: "add-event",
    label: "予定を追加",
    hint: "予定・タスク",
    to: "/schedule?new=event",
    icon: CalendarPlus,
    keywords: ["カレンダー", "約束", "スケジュール", "イベント"],
    pinned: true,
  },
  {
    id: "add-task",
    label: "タスクを追加",
    hint: "予定・タスク",
    to: "/schedule?new=task",
    icon: ListTodo,
    keywords: ["やること", "todo", "用事"],
    pinned: true,
  },
  {
    // ?new=note はメモ・リストの「＋」と同じ「何を追加しますか?」(メモ/チェックリスト/
    // 買い物リスト)を開く。ホームの「＋」からも同じ印で来る(NotePage.tsx)。
    id: "add-note",
    label: "メモを書く",
    hint: "メモ・リスト",
    to: "/records/notes?new=note",
    icon: StickyNote,
    keywords: ["ノート", "リスト", "買い物", "チェックリスト"],
    pinned: true,
  },
  {
    // お金管理は開くとサブスクのタブから始まるが、すでに別のタブを見ている時は
    // 同じ画面のままなので、?tab=subs で明示的に移す(ExpensePage.tsx)。
    id: "view-subs",
    label: "サブスクを見る",
    hint: "お金管理",
    to: "/records/expense?tab=subs",
    icon: Repeat,
    keywords: ["定期", "固定費", "月額", "解約", "引き落とし"],
    pinned: true,
  },
  {
    id: "view-calendar",
    label: "カレンダーを見る",
    hint: "予定・タスク",
    to: "/schedule?view=calendar",
    icon: CalendarDays,
    keywords: ["予定", "月", "日付"],
    pinned: true,
  },
];

const PAGE_ACTIONS: PaletteAction[] = APP_PAGES.map((page) => ({
  id: `page:${page.path}`,
  label: `${page.label}を開く`,
  hint: "画面",
  to: page.path,
  icon: page.icon,
  keywords: page.keywords,
}));

export const PALETTE_ACTIONS: PaletteAction[] = [...ADD_AND_VIEW_ACTIONS, ...PAGE_ACTIONS];

/** 打った語で操作を絞った時に出す最大の数。データの当たりを画面の下へ押し出さないように。 */
export const MATCHED_ACTION_LIMIT = 5;

export function pinnedActions(actions: PaletteAction[] = PALETTE_ACTIONS): PaletteAction[] {
  return actions.filter((action) => action.pinned);
}

/**
 * 照らし合わせ用にそろえる。全角英数→半角(NFKC)、英字は小文字、カタカナはひらがな。
 * 「めも」でも「メモ」でも、「ＧＭＡＩＬ」でも「gmail」でも同じ操作に当たるように。
 */
export function normalizeForMatch(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

/**
 * 打った語に合う操作を、合い方の強い順に返す。空白で区切った語はすべて含む必要がある。
 * 名前の頭から合う > 名前のどこかに合う > 言い換えに合う、の順。同じ強さなら一覧の順。
 */
export function matchActions(
  query: string,
  actions: PaletteAction[] = PALETTE_ACTIONS,
  limit = MATCHED_ACTION_LIMIT,
): PaletteAction[] {
  const terms = normalizeForMatch(query).split(/\s+/).filter((term) => term.length > 0);
  if (terms.length === 0) return [];

  const scored: { action: PaletteAction; score: number; order: number }[] = [];
  actions.forEach((action, order) => {
    const label = normalizeForMatch(action.label);
    // 2行目(hint)は照らし合わせに使わない。「予定・タスク」で開く操作が「予定」で
    // 全部当たってしまい、打った語と関係の薄いものまで並ぶため。
    const words = action.keywords.map(normalizeForMatch);
    let score = 0;
    for (const term of terms) {
      if (label.startsWith(term)) score += 3;
      else if (label.includes(term)) score += 2;
      else if (words.some((word) => word.includes(term))) score += 1;
      else return; // 1語でも合わなければ候補にしない
    }
    scored.push({ action, score, order });
  });

  return scored
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, limit)
    .map(({ action }) => action);
}

/* ---------------------------------------------------------------------------
   ⌘K / Ctrl+K
   ------------------------------------------------------------------------ */

type ShortcutKeyEvent = Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "isComposing">;

/**
 * まとめて検索を開くキーか。⌘K と Ctrl+K の両方を受ける — この Mac は Karabiner で
 * Command と Control を入れ替えていて、どちらの印のキーを押しても開くようにしたいため。
 * 日本語入力で変換中のキー入力は数えない。
 */
export function isPaletteShortcut(event: ShortcutKeyEvent): boolean {
  if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.isComposing) return false;
  return event.code === "KeyK" || event.key?.toLowerCase() === "k";
}

const NON_TEXT_INPUT_TYPES = new Set(["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"]);

/**
 * 文字を打っている最中の場所か。そこでの Ctrl+K は「行末まで消す」などの文字の操作に
 * 使われる(Mac の入力欄)ので、横取りしない。
 * タグ名で見るのは、テストの環境(jsdom)でも本物のブラウザでも同じに判定するため。
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).tagName !== "string") return false;
  const el = target as HTMLElement;
  const tag = el.tagName.toUpperCase();
  if (tag === "TEXTAREA") return true;
  if (tag === "INPUT") return !NON_TEXT_INPUT_TYPES.has(((el as HTMLInputElement).type || "text").toLowerCase());
  if (el.isContentEditable) return true;
  return typeof el.closest === "function" && el.closest('[contenteditable]:not([contenteditable="false"])') !== null;
}

interface PlatformHints {
  platform?: string;
  userAgent?: string;
  userAgentData?: { platform?: string };
}

/** Mac・iPhone・iPad か。キーの書き方(⌘ か Ctrl か)を合わせるためだけに使う。 */
export function isApplePlatform(nav: PlatformHints | undefined = typeof navigator === "undefined" ? undefined : navigator): boolean {
  if (!nav) return false;
  const hint = nav.userAgentData?.platform || nav.platform || nav.userAgent || "";
  return /mac|iphone|ipad|ipod/i.test(hint);
}

/** 画面に出すキーの書き方。Mac は「⌘K」、それ以外は「Ctrl+K」。 */
export function paletteShortcutLabel(nav?: PlatformHints): string {
  return isApplePlatform(nav) ? "⌘K" : "Ctrl+K";
}
