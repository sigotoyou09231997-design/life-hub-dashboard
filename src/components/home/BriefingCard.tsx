import { Link } from "react-router-dom";
import { CalendarCheck, CalendarDays, ChevronRight, Hourglass, Mail } from "lucide-react";
import { REPLY_WAIT_DAYS, type ReplyWaitingItem } from "../../lib/replyWaiting";

export interface BriefingGmail {
  connected: boolean;
  /** 「重要」を付けたまま、まだ読んでいない・返信していないメールの数。 */
  importantUnread: number;
  /** 受信トレイの「すべて」タブに出る、まだ手を付けていないメールの数。 */
  total: number;
}

interface Props {
  /** 今日かかっている予定の数。読み込み中は undefined。 */
  eventCount: number | undefined;
  /** これから来る今日の予定(時刻の無い終日の予定を含む)。今日の分が終わっていれば無い。 */
  nextEvent?: { title: string; time?: string };
  gmail: BriefingGmail | undefined;
  /** 返信待ち(src/lib/replyWaiting.ts)。待っている日数の長い順。 */
  waiting: ReplyWaitingItem[] | undefined;
  /** 設定の「使う機能」で予定・タスクを隠している時。「今日の予定」の箱を出さない(メールだけのまとめになる)。 */
  hideEvents?: boolean;
}

/**
 * ホームのいちばん上に出す「今日のまとめ」(依頼「朝の一括ブリーフィングが欲しい」)。
 * 今日の予定・重要な未読メール・返信待ちを、それぞれの画面を開かずに1枚で見られるようにする。
 * 同じ内容は毎朝7時にプッシュ通知でも届く(netlify/functions/sendMorningBriefing.ts)。
 *
 * 3つは1つずつ別の箱にして、押せばその画面へ行く(ボタンを1つの溝に詰めない、本人の好み)。
 * Gmailを連携していない時は、メールの2つは出さない。
 */
export function BriefingCard({ eventCount, nextEvent, gmail, waiting, hideEvents = false }: Props) {
  const longestWait = waiting?.[0]?.waitingDays ?? 0;
  const eventNote = nextEvent
    ? `次は ${nextEvent.time ? `${nextEvent.time} ` : ""}${nextEvent.title}`
    : eventCount
      ? "今日の分は終わりました"
      : "予定はありません";

  // 全部0件の日は、大きな「0件」を3つ並べずに1行にまとめて場所を譲る(UI/UX 調査メモ C-6)。
  // 読み込み中(undefined)はまとめない — 0件と決まる前に1行へ縮むと、あとで3枚に戻って跳ねる。
  const gmailClear = !gmail?.connected || (gmail.importantUnread === 0 && waiting !== undefined && waiting.length === 0);
  if (!hideEvents && eventCount === 0 && gmail !== undefined && gmailClear) {
    return (
      <section className="warm-card warm-brief is-clear" data-reveal="1" aria-label="今日のまとめ">
        <Link to="/schedule?view=today" className="warm-brief__clear">
          <CalendarCheck size={17} aria-hidden="true" />
          <span>{gmail.connected ? "今日は予定・重要な未読・返信待ちはありません" : "今日の予定はありません"}</span>
          <ChevronRight size={15} aria-hidden="true" />
        </Link>
      </section>
    );
  }

  return (
    <section className="warm-card warm-brief" data-reveal="1" aria-label="今日のまとめ">
      <div className="warm-card__head">
        <h2 className="warm-card__title">今日のまとめ</h2>
      </div>
      <div className="warm-brief__grid">
        {!hideEvents && (
          <Link to="/schedule?view=today" className="warm-brief__item">
            <span className="warm-brief__label">
              <CalendarDays size={13} />
              今日の予定
            </span>
            <strong className="warm-brief__count">
              {eventCount ?? "—"}
              <small>件</small>
            </strong>
            <span className="warm-brief__note">{eventNote}</span>
          </Link>
        )}

        {gmail?.connected && (
          <Link to="/gmail" className={`warm-brief__item ${gmail.importantUnread > 0 ? "is-alert" : ""}`}>
            <span className="warm-brief__label">
              <Mail size={13} />
              重要な未読
            </span>
            <strong className="warm-brief__count">
              {gmail.importantUnread}
              <small>件</small>
            </strong>
            <span className="warm-brief__note">未処理 {gmail.total}件</span>
          </Link>
        )}

        {gmail?.connected && (
          <Link to="/gmail" className={`warm-brief__item ${longestWait > 0 ? "is-alert" : ""}`}>
            <span className="warm-brief__label">
              <Hourglass size={13} />
              返信待ち
            </span>
            <strong className="warm-brief__count">
              {waiting ? waiting.length : "—"}
              <small>件</small>
            </strong>
            <span className="warm-brief__note">
              {longestWait > 0 ? `いちばん長くて${longestWait}日` : `${REPLY_WAIT_DAYS}日以上返事が無いもの`}
            </span>
          </Link>
        )}
      </div>
    </section>
  );
}
