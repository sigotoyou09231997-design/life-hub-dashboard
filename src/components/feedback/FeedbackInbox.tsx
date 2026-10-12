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
  const visible = items?.filter((item) => showResolved || item.status === "new") ?? [];

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
        {newCount > 0 && <Badge tone="accent">未対応 {newCount}件</Badge>}
      </div>
      <p className="system-section__description text-xs text-slate-500">
        ほかの人が右下の「修正」から送った「ここ直した方がいい」です。あなたにだけ見えます。
      </p>
      {failed ? (
        <p className="text-sm text-slate-500">読み込めませんでした。通信できる場所で開き直してください。</p>
      ) : items === null ? (
        <p className="text-sm text-slate-400">読み込み中…</p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-slate-500">{showResolved ? "まだ届いていません。" : "未対応の要望はありません。"}</p>
      ) : (
        <ul className="flex flex-col gap-3" aria-label="届いた要望の一覧">
          {visible.map((item) => (
            <li key={item.id} className="glass-row rounded-xl p-3 text-sm text-slate-700">
              <p className="text-xs text-slate-500">
                {whenLabel(item.createdAt)} ・ {fromLabel(item)}
                {item.page ? ` ・ ${item.page}` : ""}
              </p>
              <p className="mt-1 whitespace-pre-wrap">{item.message}</p>
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
                ) : (
                  <>
                    <Badge tone="neutral">{item.status === "done" ? "対応済み" : "見送り"}</Badge>
                    <Button variant="ghost" disabled={busyId === item.id} onClick={() => void change(item, "new")}>
                      未対応に戻す
                    </Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="mt-2 text-xs font-medium text-accent" onClick={() => setShowResolved((value) => !value)}>
        {showResolved ? "未対応だけを見る" : "対応済み・見送りも見る"}
      </button>
    </Card>
  );
}
