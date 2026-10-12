import { useState } from "react";
import { Copy, ExternalLink, RotateCcw, Trash2, XCircle } from "lucide-react";
import { formatDisplayDate } from "../../lib/date";
import { statusOf, type SubscriptionItem } from "../../lib/subscriptions";
import { templateFor } from "../../lib/subscriptionTemplates";
import {
  cancelSubscription,
  deleteSubscription,
  duplicateSubscription,
  resumeSubscription,
} from "../../lib/subscriptionStore";
import { DateField } from "../ui/DateField";
import { FormPanel } from "../ui/FormPanel";
import { Button } from "../ui/Button";
import { useConfirm } from "../ui/ConfirmProvider";

interface Props {
  item: SubscriptionItem;
  today: string;
  /** close=true ならシートを閉じる。 */
  onDone: (message: string, close: boolean) => void;
}

/**
 * 編集シートの下に出す操作(参考: サブスクBOX)。
 * - 解約する: 解約日を選んで記録する(過去の日付も可)。記録は残り、解約済みの一覧から再契約できる。
 * - 再契約する / 複製する / 完全に削除(誤って登録したもの用)
 */
export function SubscriptionActions({ item, today, onDone }: Props) {
  const confirm = useConfirm();
  const [cancelling, setCancelling] = useState(false);
  const [cancelDate, setCancelDate] = useState(today);
  const cancelled = statusOf(item, today) === "cancelled";
  const manageUrl = templateFor(item.cost.title, item.detail?.serviceKey)?.manageUrl;

  return (
    <div className="subs-actions">
      {manageUrl && (
        <a className="subs-actions__link" href={manageUrl} target="_blank" rel="noreferrer">
          <ExternalLink size={15} aria-hidden="true" />
          公式の管理・解約ページを開く
        </a>
      )}

      {cancelled ? (
        <FormPanel caption="解約済み">
          <p className="subs-actions__note">
            {item.detail?.cancelledAt
              ? `${formatDisplayDate(item.detail.cancelledAt)}に解約しました。`
              : "いまは止めています。"}
            再契約すると、また合計と請求日に入ります。
          </p>
          <Button
            type="button"
            variant="secondary"
            onClick={async () => {
              await resumeSubscription(item);
              onDone("再契約しました", false);
            }}
          >
            <RotateCcw size={15} aria-hidden="true" /> 再契約する
          </Button>
        </FormPanel>
      ) : cancelling ? (
        <FormPanel caption="解約する">
          <DateField
            label="解約した日"
            hint="過去の日付も選べます。この日のあとの請求は数えなくなり、浮いたお金に入ります。"
            value={cancelDate}
            onChange={setCancelDate}
          />
          <div className="subs-actions__row">
            <Button type="button" variant="secondary" onClick={() => setCancelling(false)}>
              やめる
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={!cancelDate || cancelDate > today}
              onClick={async () => {
                await cancelSubscription(item, cancelDate);
                setCancelling(false);
                onDone("解約を記録しました", true);
              }}
            >
              この日で解約する
            </Button>
          </div>
          {cancelDate > today && <p className="subs-actions__note">解約日は今日までの日付にしてください。</p>}
        </FormPanel>
      ) : null}

      <div className="subs-actions__row">
        {!cancelled && !cancelling && (
          <Button type="button" variant="secondary" onClick={() => setCancelling(true)}>
            <XCircle size={15} aria-hidden="true" /> 解約する
          </Button>
        )}
        <Button
          type="button"
          variant="secondary"
          onClick={async () => {
            await duplicateSubscription(item);
            onDone("複製しました", true);
          }}
        >
          <Copy size={15} aria-hidden="true" /> 複製する
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={async () => {
            const ok = await confirm({
              title: `「${item.cost.title}」を完全に削除しますか?`,
              message: "誤って登録したもの向けです。解約した記録を残したいときは「解約する」を使ってください。",
              confirmLabel: "削除する",
              tone: "danger",
            });
            if (!ok) return;
            await deleteSubscription(item);
            onDone("削除しました", true);
          }}
        >
          <Trash2 size={15} aria-hidden="true" /> 完全に削除
        </Button>
      </div>
    </div>
  );
}
