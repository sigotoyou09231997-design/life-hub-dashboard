import { useState, type FormEvent } from "react";
import {
  FEEDBACK_FAILURE_MESSAGE,
  FEEDBACK_MAX_LENGTH,
  FeedbackError,
  readFeedbackName,
  sendFeedback,
  storeFeedbackName,
} from "../../lib/appFeedback";
import { Button } from "../ui/Button";
import { FormActions } from "../ui/FormActions";
import { Input, Textarea } from "../ui/Input";

interface Props {
  /** いま開いている画面(アプリの道筋)。一緒に送る。 */
  page: string;
  /** 共有した「しおり」のページから送る時の合鍵。 */
  shareToken?: string;
  onSent: () => void;
  onCancel: () => void;
}

/** 「ここ直した方がいい」を書いて送る(src/lib/appFeedback.ts)。 */
export function FeedbackForm({ page, shareToken, onSent, onCancel }: Props) {
  const [message, setMessage] = useState("");
  const [name, setName] = useState(readFeedbackName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await sendFeedback({ message, page, senderName: name, shareToken });
      storeFeedbackName(name);
      onSent();
    } catch (err) {
      setError(err instanceof FeedbackError ? err.message : FEEDBACK_FAILURE_MESSAGE.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={(event) => void handleSubmit(event)}>
      <p className="text-sm text-slate-600">
        使っていて「ここ直した方がいい」「こうだったら使いやすい」と思ったことを書いてください。LIFE HUB を作っている人だけが読みます。
      </p>
      <Textarea
        label="直してほしいこと"
        rows={5}
        maxLength={FEEDBACK_MAX_LENGTH}
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        placeholder="例: 旅行の日程で、時刻を変えても並び順が変わらない"
      />
      <Input label="お名前" optional value={name} onChange={(event) => setName(event.target.value)} placeholder="例: えっくん" />
      <p className="text-xs text-slate-400">いま開いている画面({page})も一緒に送ります。</p>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <FormActions>
        <Button type="button" variant="secondary" onClick={onCancel}>
          やめる
        </Button>
        <Button type="submit" disabled={busy || !message.trim()}>
          {busy ? "送っています…" : "送る"}
        </Button>
      </FormActions>
    </form>
  );
}
