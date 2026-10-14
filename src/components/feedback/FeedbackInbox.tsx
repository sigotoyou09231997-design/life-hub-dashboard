import { useEffect, useState } from "react";
import { Inbox } from "lucide-react";
import {
  loadFeedback,
  loadFeedbackImages,
  loadIsFeedbackOwner,
  setFeedbackStatus,
  type FeedbackItem,
  type FeedbackStatus,
} from "../../lib/appFeedback";
import { formatDisplayDate } from "../../lib/date";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { FeedbackGauge } from "./FeedbackGauge";
import { agoLabel } from "../../lib/feedbackTime";
import { isActiveFeedback } from "../../lib/feedbackProgress";
import { useNow } from "../../hooks/useNow";
import { useToast } from "../ui/ToastProvider";

function fromLabel(item: FeedbackItem): string {
  const who = item.senderName ?? (item.via === "share" ? "しおりを見た人" : "名前なし");
  return item.tripName ? `${who}(「${item.tripName}」のしおりから)` : who;
}

function whenLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString();
  return `${formatDisplayDate(local.slice(0, 10))} ${local.slice(11, 16)}`;
}

/**
 * 設定の「届いた要望」。アプリの持ち主だけに出る(それ以外の人には何も出さない)。
 * 持ち主の Mac からは scripts/feedback-inbox.mjs でも読める(Claude Code がその場で直すため)。
 */
export function FeedbackInbox() {
  const showToast = useToast();
  const [owner, setOwner] = useState(false);
  const [items, setItems] = useState<FeedbackItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [showResolved, setShowResolved] = useState(false);
  const [busyId, setBusyId] = useState<string>();
  /** 「○分前」を、開いたまま進める。 */
  const now = useNow(30_000);
  /** 開いて読み込んだ画像(依頼のid → データ URL)。重いので、押した時だけ読む。 */
  const [images, setImages] = useState<Record<string, string[]>>({});
  /** 大きく出している画像(「依頼のid:番号」)。 */
  const [zoomed, setZoomed] = useState<string>();

  useEffect(() => {
    let active = true;
    void (async () => {
      const isOwner = await loadIsFeedbackOwner().catch(() => false);
      if (!active) return;
      setOwner(isOwner);
      if (!isOwner) return;
      try {
        const loaded = await loadFeedback();
        if (active) setItems(loaded);
      } catch (error) {
        console.error("[feedback] failed to load:", error);
        if (active) setFailed(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  if (!owner) return null;

  async function change(item: FeedbackItem, status: FeedbackStatus) {
    setBusyId(item.id);
    try {
      await setFeedbackStatus(item.id, status);
      setItems((current) => current?.map((other) => (other.id === item.id ? { ...other, status } : other)) ?? null);
    } catch (error) {
      console.error("[feedback] failed to change the status:", error);
      showToast("変えられませんでした");
    } finally {
      setBusyId(undefined);
    }
  }

  async function showImages(item: FeedbackItem) {
    if (images[item.id]) {
      setImages((current) => {
        const { [item.id]: _closed, ...rest } = current;
        return rest;
      });
      return;
    }
    setBusyId(item.id);
    try {
      const loaded = await loadFeedbackImages(item.id);
      setImages((current) => ({ ...current, [item.id]: loaded }));
    } catch (error) {
      console.error("[feedback] failed to load the images:", error);
      showToast("画像を読み込めませんでした");
    } finally {
      setBusyId(undefined);
    }
  }

  const newCount = items?.filter((item) => item.status === "new").length ?? 0;
  const workingCount = items?.filter((item) => item.status === "working").length ?? 0;
  const holdCount = items?.filter((item) => item.status === "hold").length ?? 0;
  // 対応中・保留中も、対応待ちと同じく「まだ終わっていない」ものとして、既定の一覧に出す。
  const visible = items?.filter((item) => showResolved || item.status === "new" || item.status === "working" || item.status === "hold") ?? [];

  return (
    <Card className="system-section system-section--feedback lg:col-span-2">
      <div className="system-section__header">
        <div className="system-section__identity">
          <span>
            <Inbox size={17} />
          </span>
          <div>
            <h2>届いた要望</h2>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {workingCount > 0 && <Badge tone="accent">対応中 {workingCount}件</Badge>}
          {holdCount > 0 && <Badge tone="warning">保留中 {holdCount}件</Badge>}
          {newCount > 0 && <Badge tone="accent">対応待ち {newCount}件</Badge>}
        </div>
      </div>
      <p className="system-section__description text-xs text-slate-500">
        ほかの人が右下の「修正」から送った「ここ直した方がいい」です。あなたにだけ見えます。
      </p>
      {failed ? (
        <p className="text-sm text-slate-500">読み込めませんでした。通信できる場所で開き直してください。</p>
      ) : items === null ? (
        <p className="text-sm text-slate-400">読み込み中…</p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-slate-500">{showResolved ? "まだ届いていません。" : "対応待ち・対応中・保留中の要望はありません。"}</p>
      ) : (
        <ul className="flex flex-col gap-3" aria-label="届いた要望の一覧">
          {visible.map((item) => (
            <li key={item.id} className="glass-row rounded-xl p-3 text-sm text-slate-700">
              <p className="text-xs text-slate-500">
                {whenLabel(item.createdAt)} に届きました{isActiveFeedback(item) ? `（${agoLabel(item.createdAt, now)}）` : ""} ・ {fromLabel(item)}
                {item.page ? ` ・ ${item.page}` : ""}
              </p>
              <p className="mt-1 whitespace-pre-wrap">{item.message}</p>
              {item.status === "hold" && item.statusNote && (
                <p className="mt-1 rounded-lg bg-amber-50 px-2 py-1 text-xs text-amber-900">保留の理由: {item.statusNote}</p>
              )}
              {/* 質問(選ぶボタン)を送って返事を待っている間は、選択肢を見せる。答えが届いたら、答えを見せる。 */}
              {item.status === "hold" && item.questionOptions && (
                <p className="mt-1 text-xs text-slate-600">選択肢(返事待ち): {item.questionOptions.join(" / ")}</p>
              )}
              {item.answer && <p className="mt-1 rounded-lg bg-accent/10 px-2 py-1 text-xs text-slate-800">答え: {item.answer}</p>}
              <FeedbackGauge item={item} />
              {(item.imageCount ?? 0) > 0 && (
                <div className="mt-2">
                  <Button variant="ghost" disabled={busyId === item.id} onClick={() => void showImages(item)}>
                    {images[item.id] ? "画像を閉じる" : `画像を見る(${item.imageCount}枚)`}
                  </Button>
                  {images[item.id] && (
                    <ul className="mt-2 flex flex-wrap gap-2" aria-label="付いている画像">
                      {images[item.id].map((image, index) => {
                        const key = `${item.id}:${index}`;
                        return (
                          <li key={key} className={zoomed === key ? "w-full" : ""}>
                            <button type="button" aria-label={`画像${index + 1}を${zoomed === key ? "小さく" : "大きく"}する`} onClick={() => setZoomed(zoomed === key ? undefined : key)}>
                              <img
                                src={image}
                                alt={`付いている画像${index + 1}`}
                                className={`rounded-lg border border-slate-200 object-contain ${zoomed === key ? "w-full" : "h-28 w-auto"}`}
                              />
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                {item.status === "new" ? (
                  <>
                    <Button variant="secondary" disabled={busyId === item.id} onClick={() => void change(item, "done")}>
                      対応済みにする
                    </Button>
                    <Button variant="ghost" disabled={busyId === item.id} onClick={() => void change(item, "dismissed")}>
                      見送る
                    </Button>
                  </>
                ) : item.status === "hold" ? (
                  <>
                    <Badge tone="warning">保留中</Badge>
                    <Button variant="secondary" disabled={busyId === item.id} onClick={() => void change(item, "done")}>
                      対応済みにする
                    </Button>
                    <Button variant="ghost" disabled={busyId === item.id} onClick={() => void change(item, "new")}>
                      対応待ちに戻す
                    </Button>
                    <Button variant="ghost" disabled={busyId === item.id} onClick={() => void change(item, "dismissed")}>
                      見送る
                    </Button>
                  </>
                ) : item.status === "working" ? (
                  <>
                    <Badge tone="accent">{item.workingAt ? `対応中（${whenLabel(item.workingAt).split(" ")[1]}から）` : "対応中"}</Badge>
                    <Button variant="secondary" disabled={busyId === item.id} onClick={() => void change(item, "done")}>
                      対応済みにする
                    </Button>
                    <Button variant="ghost" disabled={busyId === item.id} onClick={() => void change(item, "new")}>
                      対応待ちに戻す
                    </Button>
                  </>
                ) : (
                  <>
                    <Badge tone="neutral">{item.status === "done" ? "対応済み" : "見送り"}</Badge>
                    <Button variant="ghost" disabled={busyId === item.id} onClick={() => void change(item, "new")}>
                      対応待ちに戻す
                    </Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="mt-2 text-xs font-medium text-accent" onClick={() => setShowResolved((value) => !value)}>
        {showResolved ? "終わっていないものだけを見る" : "対応済み・見送りも見る"}
      </button>
    </Card>
  );
}
