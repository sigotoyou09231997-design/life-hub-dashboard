import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { ImagePlus, X } from "lucide-react";
import {
  canAttachImages,
  FEEDBACK_FAILURE_MESSAGE,
  FEEDBACK_MAX_LENGTH,
  FeedbackError,
  readFeedbackName,
  sendFeedback,
  storeFeedbackName,
} from "../../lib/appFeedback";
import {
  checkFeedbackImagesFit,
  FEEDBACK_IMAGE_FAILURE_MESSAGE,
  FEEDBACK_MAX_IMAGES,
  FeedbackImageError,
  prepareFeedbackImage,
} from "../../lib/feedbackImages";
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

/** 「ここ直した方がいい」を書いて送る(src/lib/appFeedback.ts)。画像(スクリーンショットなど)も付けられる(033 を流した後だけ)。 */
export function FeedbackForm({ page, shareToken, onSent, onCancel }: Props) {
  const [message, setMessage] = useState("");
  const [name, setName] = useState(readFeedbackName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /** 付ける画像(縮めた JPEG のデータ URL)。 */
  const [images, setImages] = useState<string[]>([]);
  const [preparing, setPreparing] = useState(false);
  /** 画像を付けられるか(033 を流してあるか)。確かめるまでは出さない。 */
  const [imagesAllowed, setImagesAllowed] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    void canAttachImages().then((allowed) => {
      if (active) setImagesAllowed(allowed);
    });
    return () => {
      active = false;
    };
  }, []);

  async function handlePick(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = ""; // 同じ画像をもう一度選べるように
    if (files.length === 0) return;
    setError("");
    setPreparing(true);
    try {
      let current = images;
      for (const file of files) {
        const prepared = await prepareFeedbackImage(file);
        const misfit = checkFeedbackImagesFit(current, prepared);
        if (misfit) throw new FeedbackImageError(misfit);
        current = [...current, prepared];
      }
      setImages(current);
    } catch (err) {
      setError(err instanceof FeedbackImageError ? err.message : FEEDBACK_IMAGE_FAILURE_MESSAGE.unsupported);
    } finally {
      setPreparing(false);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await sendFeedback({ message, page, senderName: name, shareToken, images: images.length ? images : undefined });
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
      {imagesAllowed && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold text-slate-700">
            画像<span className="ml-2 text-xs font-normal text-slate-400">任意・{FEEDBACK_MAX_IMAGES}枚まで</span>
          </p>
          {images.length > 0 && (
            <ul className="flex flex-wrap gap-2" aria-label="付ける画像">
              {images.map((image, index) => (
                <li key={image.slice(-40) + index} className="relative">
                  <img src={image} alt={`付ける画像${index + 1}`} className="h-20 w-20 rounded-lg border border-slate-200 object-cover" />
                  <button
                    type="button"
                    aria-label={`画像${index + 1}を外す`}
                    className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 text-white shadow"
                    onClick={() => setImages((current) => current.filter((_, i) => i !== index))}
                  >
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {images.length < FEEDBACK_MAX_IMAGES && (
            <>
              <input ref={fileInput} type="file" accept="image/*" multiple className="hidden" onChange={(event) => void handlePick(event)} />
              <Button type="button" variant="secondary" className="self-start" disabled={preparing} onClick={() => fileInput.current?.click()}>
                <ImagePlus size={16} />
                {preparing ? "画像を縮めています…" : "画像を付ける"}
              </Button>
            </>
          )}
          <p className="text-xs text-slate-400">スクリーンショットなど。画像は、直したあと(対応済み・見送り)に消えます。</p>
        </div>
      )}
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
        <Button type="submit" disabled={busy || preparing || !message.trim()}>
          {busy ? "送っています…" : "送る"}
        </Button>
      </FormActions>
    </form>
  );
}
