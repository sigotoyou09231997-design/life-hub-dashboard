import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ElementType,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { CalendarDays, CornerDownLeft, ListTodo, Mail, MapPin, Plane, Search, StickyNote } from "lucide-react";
import { db } from "../../db/schema";
import { countHits, searchEverything, type SearchGroup, type SearchHit, type SearchKind } from "../../lib/globalSearch";
import {
  isPaletteShortcut,
  isTypingTarget,
  matchActions,
  paletteShortcutLabel,
  pinnedActions,
  type PaletteAction,
} from "../../lib/commandPalette";
import {
  buildRecentList,
  emptyRecentRows,
  loadRecent,
  recentEntryForPath,
  recordRecent,
  type RecentEntry,
  type RecentItem,
  type RecentKind,
  type RecentRows,
} from "../../lib/recentItems";
import { Sheet } from "../ui/Sheet";
import { Input } from "../ui/Input";
import { EmptyState } from "../ui/EmptyState";
import { PersonTags } from "../calendar/PersonTags";

interface Props {
  open: boolean;
  onClose: () => void;
}

const EMPTY_GROUPS: SearchGroup[] = [];

/** データの行のアイコン。画面の行は APP_PAGES のアイコンを使う。 */
const KIND_ICON: Record<SearchKind, ElementType> = {
  event: CalendarDays,
  task: ListTodo,
  note: StickyNote,
  trip: Plane,
  tripSchedule: MapPin,
  email: Mail,
};

/** 候補の1行。操作・最近見たもの・検索の当たりを同じ形にして、↑↓で通しで選べるようにする。 */
interface PaletteOption {
  key: string;
  title: string;
  subtitle: string;
  to: string;
  icon: ElementType;
  personIds?: string[];
  /** 開いた時に「最近見たもの」へ残すもの。操作は残さない — 行き先の画面はURLの変化の
   * 方で残るうえ、操作そのものは「よく使う操作」にいつも出ているため。 */
  record?: { kind: RecentKind; id: string };
}

interface PaletteSection {
  id: string;
  label: string;
  /** 見出しの右に出す件数。検索の当たりだけ。 */
  count?: number;
  /** スマホでは2列のタイルにする(よく使う操作)。 */
  grid?: boolean;
  options: PaletteOption[];
}

function actionOption(action: PaletteAction): PaletteOption {
  return { key: `action:${action.id}`, title: action.label, subtitle: action.hint, to: action.to, icon: action.icon };
}

function hitOption(hit: SearchHit): PaletteOption {
  return {
    key: `hit:${hit.kind}:${hit.id}`,
    title: hit.title,
    subtitle: hit.subtitle,
    to: hit.to,
    icon: KIND_ICON[hit.kind],
    personIds: hit.personIds,
    record: { kind: hit.kind, id: hit.id },
  };
}

function recentOption(item: RecentItem): PaletteOption {
  return {
    key: `recent:${item.key}`,
    title: item.title,
    subtitle: item.subtitle,
    to: item.to,
    icon: item.icon ?? (item.entry.kind === "page" ? Search : KIND_ICON[item.entry.kind]),
    personIds: item.personIds,
    record: { kind: item.entry.kind, id: item.entry.id },
  };
}

function toMap<T extends { id?: string }>(rows: (T | undefined)[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const row of rows) if (row?.id) map.set(row.id, row);
  return map;
}

/** 「最近見たもの」の名前を引く。開いた時に、残っているidの分だけ読む(全件は読まない)。 */
async function loadRecentRows(entries: RecentEntry[]): Promise<RecentRows> {
  const idsOf = (kind: RecentKind) => entries.filter((entry) => entry.kind === kind).map((entry) => entry.id);
  const [events, tasks, notes, trips, tripSchedule, emails] = await Promise.all([
    db.calendarEvents.bulkGet(idsOf("event")),
    db.tasks.bulkGet(idsOf("task")),
    db.notes.bulkGet(idsOf("note")),
    db.trips.bulkGet(idsOf("trip")),
    db.tripSchedule.bulkGet(idsOf("tripSchedule")),
    db.syncedEmails.bulkGet(idsOf("email")),
  ]);
  const tripMap = toMap(trips);
  // 旅行の日程の行には「どの旅行か」も出すので、その旅行の名前も引いておく。
  const missingTripIds = [
    ...new Set(tripSchedule.flatMap((item) => (item && !tripMap.has(item.tripId) ? [item.tripId] : []))),
  ];
  if (missingTripIds.length > 0) {
    for (const [id, trip] of toMap(await db.trips.bulkGet(missingTripIds))) tripMap.set(id, trip);
  }
  return {
    events: toMap(events),
    tasks: toMap(tasks),
    notes: toMap(notes),
    trips: tripMap,
    tripSchedule: toMap(tripSchedule),
    emails: toMap(emails),
  };
}

/**
 * ⌘K / Ctrl+K で、まとめて検索を開く(開いている時は閉じる)。AppHeader から使うので、
 * ログイン後の画面ならどこでも効く。
 * - 文字を打っている欄の中では横取りしない(Mac の入力欄では Ctrl+K が「行末まで消す」)。
 *   ただし、まとめて検索の欄の中だけは別 — そこで押したら閉じる。
 * - 入力フォームなど別のシートが開いている間は出さない。シートが重なると、後ろの
 *   フォームの上に検索が出たり、検索の上にフォームが残ったりして、どちらを
 *   操作しているのか分からなくなるため。
 */
export function usePaletteShortcut(open: boolean, setOpen: (open: boolean) => void) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      // 押しっぱなしの繰り返しは無視する(開く・閉じるが細かく入れ替わらないように)。
      if (event.defaultPrevented || event.repeat || !isPaletteShortcut(event)) return;
      const inPaletteField = event.target instanceof Element && event.target.closest("[data-palette-input]") !== null;
      if (!inPaletteField && isTypingTarget(event.target)) return;
      if (!open && document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      event.preventDefault();
      setOpen(!open);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, setOpen]);
}

/** 予定・タスク・メモ・旅行・Gmailを1か所からまとめて探す。各画面の個別検索は
 * そのまま残してあり、これは「どこに書いたか忘れた」ときのための追加の入口。
 * 2026-10-12 から、何も打っていない時は「よく使う操作」と「最近見たもの」を出し、
 * 打った語で操作(支出を追加など)も探す — 探すだけでなく、やりたいことへ1回で飛べるように。 */
export function GlobalSearch({ open, onClose }: Props) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [recentEntries, setRecentEntries] = useState<RecentEntry[]>([]);
  const baseId = useId();
  /** ↑↓で動かした時だけ、選んだ行が見える所までスクロールする(指やマウスで選んだ時は動かさない)。 */
  const movedByKeyRef = useRef(false);
  /** 候補を開いた直後の画面の移り変わりを、1回だけ残さずに通すためのパス(下の remember)。 */
  const skipRecordPathRef = useRef<string | null>(null);

  // 開いたもの(旅行・メールの詳細、各画面)を「最近見たもの」に残す。この部品は
  // ヘッダーと一緒にいつも置かれていて、シートを閉じている間も画面の移り変わりを見ていられる。
  // 一覧・通知・ホームのカードなど、検索以外から開いたものも並べたいので、ここで拾う。
  useEffect(() => {
    if (skipRecordPathRef.current === pathname) {
      skipRecordPathRef.current = null;
      return;
    }
    const entry = recentEntryForPath(pathname);
    if (entry) recordRecent(entry);
  }, [pathname]);

  // 開き直すたびに前回の語が残っていると、まず消す操作から始まってしまう。
  // 「最近見たもの」は開いた時に読み直す(閉じている間に増えた分を出すため)。
  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    setActive(0);
    setRecentEntries(loadRecent());
  }, [open]);

  // 「誰の予定か」の名前と色。予定の行に印を出すのに使う。件数が少ない表なので、
  // 探す語が入る前から読んでおいてよい。
  const eventPeople = useLiveQuery(() => db.eventPeople.toArray(), []) ?? [];

  const searching = query.trim().length > 0;

  // 探す語が入って初めて読む — 開いただけで全テーブルを読みにいかない。
  const source = useLiveQuery(async () => {
    if (!searching) return null;
    const [events, tasks, notes, trips, tripSchedule, emails] = await Promise.all([
      db.calendarEvents.toArray(),
      db.tasks.toArray(),
      db.notes.toArray(),
      db.trips.toArray(),
      db.tripSchedule.toArray(),
      db.syncedEmails.toArray(),
    ]);
    return { events, tasks, notes, trips, tripSchedule, emails };
  }, [searching]);

  const recentKey = recentEntries.map((entry) => `${entry.kind}:${entry.id}`).join("|");
  const recentRows = useLiveQuery(
    () => (open && !searching && recentEntries.length > 0 ? loadRecentRows(recentEntries) : emptyRecentRows()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open, searching, recentKey],
  );

  const groups = source ? searchEverything(query, source) : EMPTY_GROUPS;
  const total = countHits(groups);

  const recentItems = useMemo(
    () => (recentRows ? buildRecentList(recentEntries, recentRows, { currentPath: pathname }) : []),
    [recentEntries, recentRows, pathname],
  );

  const matchedActions = useMemo(() => (searching ? matchActions(query) : []), [searching, query]);

  const sections: PaletteSection[] = searching
    ? [
        ...(matchedActions.length > 0 ? [{ id: "actions", label: "操作", options: matchedActions.map(actionOption) }] : []),
        ...groups.map((group) => ({
          id: group.kind,
          label: group.label,
          count: group.hits.length,
          options: group.hits.map(hitOption),
        })),
      ]
    : [
        { id: "pinned", label: "よく使う操作", grid: true, options: pinnedActions().map(actionOption) },
        ...(recentItems.length > 0 ? [{ id: "recent", label: "最近見たもの", options: recentItems.map(recentOption) }] : []),
      ];
  const flat = sections.flatMap((section) => section.options);
  const activeIndex = flat.length === 0 ? -1 : Math.min(active, flat.length - 1);
  const optionId = (index: number) => `${baseId}-option-${index}`;

  useEffect(() => {
    if (!movedByKeyRef.current || activeIndex < 0) return;
    movedByKeyRef.current = false;
    document.getElementById(optionId(activeIndex))?.scrollIntoView?.({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex]);

  /**
   * 開いた候補を「最近見たもの」に残す。予定・メモなど自分の画面を持たないものは、行き先の
   * 画面(予定・タスクなど)へ移った時に上の画面の記録が後から先頭に入り、開いたもの自体が
   * 2番目に下がってしまう。行き先の画面を先に残し、開いたものをその上に置いて、
   * 直後の画面の移り変わりでは残し直さない。
   */
  function remember(option: PaletteOption) {
    if (!option.record) return;
    const targetPath = option.to.split(/[?#]/)[0];
    const host = recentEntryForPath(targetPath);
    if (host && !(host.kind === option.record.kind && host.id === option.record.id)) {
      recordRecent(host);
      // いまの画面と同じ所へ飛ぶ時はURLのパスが変わらず、上の記録が動かないので印も付けない
      // (付けると、あとで本当にその画面へ来た時の1回を取りこぼす)。
      if (targetPath !== pathname) skipRecordPathRef.current = targetPath;
    }
    recordRecent(option.record);
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    // 日本語の変換中の Enter・↑↓ は変換のためのもの。ここで受けると、変換を確定しただけで
    // 候補が開いてしまう。Safari は確定の Enter で isComposing が false になることがあるので
    // keyCode 229 も見る。
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (flat.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      movedByKeyRef.current = true;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((activeIndex + step + flat.length) % flat.length);
      return;
    }
    if (event.key === "Enter") {
      const option = flat[activeIndex];
      if (!option) return;
      event.preventDefault();
      remember(option);
      onClose();
      navigate(option.to);
    }
  }

  // 何番目の行かを、区切り(見出し)をまたいで通しで数える。
  let runningIndex = 0;

  return (
    <Sheet open={open} onClose={onClose} title="検索・操作">
      <div className="cmd-palette">
        <Input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={handleKeyDown}
          placeholder="探したい言葉や、やりたいこと"
          aria-label="まとめて検索"
          role="combobox"
          aria-expanded="true"
          aria-controls={`${baseId}-list`}
          aria-autocomplete="list"
          aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
          data-palette-input=""
          autoComplete="off"
          enterKeyHint="go"
          autoFocus
        />

        {!searching && (
          <p className="cmd-palette__intro">予定・メモ・旅行・Gmailを探したり、「支出」と打って追加したりできます。</p>
        )}

        <div id={`${baseId}-list`} role="listbox" aria-label="候補" className="cmd-palette__list">
          {sections.map((section) => {
            const headId = `${baseId}-head-${section.id}`;
            return (
              <section key={section.id} role="group" aria-labelledby={headId} className="cmd-section">
                <div className="cmd-section__head">
                  <p id={headId}>{section.label}</p>
                  {section.count !== undefined && <span>{section.count}件</span>}
                </div>
                <div className={`cmd-list ${section.grid ? "cmd-list--grid" : ""}`}>
                  {section.options.map((option) => {
                    const index = runningIndex++;
                    const Icon = option.icon;
                    const selected = index === activeIndex;
                    return (
                      <Link
                        key={option.key}
                        id={optionId(index)}
                        role="option"
                        aria-selected={selected}
                        to={option.to}
                        onClick={() => {
                          remember(option);
                          onClose();
                        }}
                        // mousemove にするのは、↑↓でスクロールした時に止まっているマウスの
                        // 下へ行が来ただけで選択が奪われないようにするため(mouseenter だと奪われる)。
                        onMouseMove={() => {
                          if (!selected) setActive(index);
                        }}
                        className={`cmd-row ${selected ? "is-active" : ""}`}
                      >
                        <span className="cmd-row__icon" aria-hidden="true">
                          <Icon size={17} />
                        </span>
                        <span className="cmd-row__text">
                          <span className="cmd-row__title">{option.title}</span>
                          {option.subtitle && <span className="cmd-row__sub">{option.subtitle}</span>}
                          {/* 予定の行だけ「誰の予定か」を出す。探した結果の中でも、どれが誰の
                              予定なのかが分かるように。 */}
                          {option.personIds && option.personIds.length > 0 && (
                            <span className="mt-1 block">
                              <PersonTags event={{ personIds: option.personIds }} people={eventPeople} compact />
                            </span>
                          )}
                        </span>
                        <CornerDownLeft size={14} className="cmd-row__enter" aria-hidden="true" />
                      </Link>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>

        {!searching && recentItems.length === 0 && recentRows !== undefined && (
          <section className="cmd-section">
            <div className="cmd-section__head">
              <p>最近見たもの</p>
            </div>
            <p className="cmd-palette__note">まだありません。開いた旅行・メール・画面が、ここに並びます。</p>
          </section>
        )}

        {searching && source === undefined && <p className="cmd-palette__note">探しています…</p>}

        {searching && source !== undefined && total === 0 && matchedActions.length === 0 && (
          <EmptyState icon={Search} title="見つかりませんでした" description="別の言葉でも試してみてください。" />
        )}

        {searching && source !== undefined && total === 0 && matchedActions.length > 0 && (
          <p className="cmd-palette__note">予定・メモ・旅行・Gmailには見つかりませんでした。</p>
        )}

        {/* キーで動かす人向けの案内。指で使う端末では出さない(CSS、theme-teal.css)。 */}
        <p className="cmd-palette__keys" aria-hidden="true">
          <span><kbd>↑</kbd><kbd>↓</kbd> 選ぶ</span>
          <span><kbd>Enter</kbd> 開く</span>
          <span><kbd>Esc</kbd> 閉じる</span>
          <span><kbd>{paletteShortcutLabel()}</kbd> どこからでも開く</span>
        </p>
      </div>
    </Sheet>
  );
}
