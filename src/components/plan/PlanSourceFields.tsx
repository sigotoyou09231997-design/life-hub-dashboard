import { useEffect, useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import { MAX_SCAN_IMAGES, SUPPORTED_SCAN_MEDIA_TYPES } from "../../lib/tripPlanScan";
import { Textarea } from "../ui/Input";
import { Button } from "../ui/Button";

/** 縮める前に弾く大きさ。ここを超える写真は、縮める処理そのものが重くて端末が固まる。 */
const MAX_FILE_BYTES = 20 * 1024 * 1024;

export interface PickedPhoto {
  file: File;
  /** 画面に出すためのURL。閉じる時・外す時に revoke する。 */
  url: string;
}

/**
 * 読み取りに渡す写真の出し入れ。旅行の日程(TripPlanScanForm)と予定(EventScanForm)の
 * 両方の「写真・文章から読み取る」で使う — 枚数・形式・大きさの決まりはサーバー側
 * (extractTripPlan の MAX_IMAGES / ALLOWED_MEDIA_TYPES)に合わせたもので、画面ごとに
 * 違ってはいけないため。
 */
export function usePickedPhotos(onError: (message: string) => void) {
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  // シートを背景のタップで閉じた時など、キャンセルを通らずに画面が消えても写真のURLを返す。
  const photosRef = useRef(photos);
  photosRef.current = photos;
  useEffect(() => () => {
    for (const photo of photosRef.current) URL.revokeObjectURL(photo.url);
  }, []);

  function addPhotos(files: FileList | null) {
    if (!files || files.length === 0) return;
    const picked: PickedPhoto[] = [];
    for (const file of Array.from(files)) {
      if (photos.length + picked.length >= MAX_SCAN_IMAGES) {
        onError(`写真は一度に${MAX_SCAN_IMAGES}枚までです`);
        break;
      }
      if (!SUPPORTED_SCAN_MEDIA_TYPES.includes(file.type)) {
        onError("対応していない画像形式です。写真(JPEG・PNG・WebP)を選んでください");
        continue;
      }
      if (file.size > MAX_FILE_BYTES) {
        onError("写真が大きすぎます。もう少し小さい写真でお試しください");
        continue;
      }
      picked.push({ file, url: URL.createObjectURL(file) });
    }
    if (picked.length > 0) setPhotos((current) => [...current, ...picked]);
  }

  function removePhoto(index: number) {
    setPhotos((current) => {
      const target = current[index];
      if (target) URL.revokeObjectURL(target.url);
      return current.filter((_, i) => i !== index);
    });
  }

  function releasePhotos() {
    for (const photo of photos) URL.revokeObjectURL(photo.url);
  }

  return { photos, addPhotos, removePhoto, releasePhotos };
}

interface Props {
  photos: PickedPhoto[];
  onAddPhotos: (files: FileList | null) => void;
  onRemovePhoto: (index: number) => void;
  text: string;
  onTextChange: (text: string) => void;
  textPlaceholder: string;
  textHint: string;
}

/** 写真を選ぶボタン・選んだ写真の一覧・文章の欄。 */
export function PlanSourceFields({ photos, onAddPhotos, onRemovePhoto, text, onTextChange, textPlaceholder, textHint }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={SUPPORTED_SCAN_MEDIA_TYPES.join(",")}
        multiple
        hidden
        onChange={(e) => {
          onAddPhotos(e.target.files);
          e.target.value = ""; // 同じ写真を選び直せるようにリセット
        }}
      />

      {photos.length > 0 && (
        <ul className="grid grid-cols-3 gap-2">
          {photos.map((photo, index) => (
            <li key={photo.url} className="relative overflow-hidden rounded-xl border border-white/50">
              <img src={photo.url} alt={`選んだ写真 ${index + 1}枚目`} className="h-24 w-full object-cover" />
              <button
                type="button"
                onClick={() => onRemovePhoto(index)}
                aria-label={`${index + 1}枚目の写真を外す`}
                className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-slate-900/60 text-white"
              >
                <X size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <Button
        type="button"
        variant="secondary"
        className="w-full"
        disabled={photos.length >= MAX_SCAN_IMAGES}
        onClick={() => inputRef.current?.click()}
      >
        <ImagePlus size={17} />
        {photos.length === 0 ? "写真を選ぶ" : `写真を足す（${photos.length}/${MAX_SCAN_IMAGES}）`}
      </Button>

      <Textarea
        label="文章"
        optional
        rows={6}
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        placeholder={textPlaceholder}
        hint={textHint}
      />
    </>
  );
}
