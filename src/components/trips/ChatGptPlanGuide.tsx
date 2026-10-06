import { useMemo, useState } from "react";
import { ChevronDown, ClipboardPaste, Copy, ExternalLink, MessageSquareText } from "lucide-react";
import type { Trip } from "../../types";
import {
  EMPTY_PROMPT_PREFS,
  PACE_OPTIONS,
  buildTripPrompt,
  type TripPace,
  type TripPromptPrefs,
} from "../../lib/tripChatGptPrompt";
import { Button } from "../ui/Button";
import { Input, Textarea } from "../ui/Input";
import { SegmentedField } from "../ui/SegmentedField";
import { ChatGptSendCodePanel } from "./ChatGptSendCodePanel";

const CHATGPT_URL = "https://chatgpt.com/";

interface Props {
  trip: Trip;
  /** ChatGPT の返事をクリップボードから貼る。文章の欄へ入れるのは呼び出し側。 */
  onPasteReply: (reply: string) => void;
}

/**
 * ChatGPT に旅程を作ってもらい、その返事を日程に起こすための手引き。
 *
 * アプリから ChatGPT を呼ぶのではなく(OpenAI のAPIキーは使わない)、本人の ChatGPT へ渡す依頼文を
 * 作り、返ってきた文章を「写真・文章から読み取る」に貼る、という3手順にしている。
 * 依頼文は返事が読み取りやすい書き方を指定する(src/lib/tripChatGptPrompt.ts)。
 *
 * コピーと「ChatGPTを開く」を1つのボタンにしないのは、コピーを待ってから別の画面を開くと、
 * スマホのブラウザが「ボタンを押した操作ではない」と見なして開かせないことがあるため。
 */
export function ChatGptPlanGuide({ trip, onPasteReply }: Props) {
  const [open, setOpen] = useState(false);
  const [prefs, setPrefs] = useState<TripPromptPrefs>(EMPTY_PROMPT_PREFS);
  const [message, setMessage] = useState("");
  const prompt = useMemo(() => buildTripPrompt(trip, prefs), [trip, prefs]);

  function update(changes: Partial<TripPromptPrefs>) {
    setPrefs((current) => ({ ...current, ...changes }));
    setMessage("");
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(prompt);
      setMessage("コピーしました。ChatGPTを開いて、貼り付けて送ってください");
    } catch {
      // クリップボードを許していない端末では、下の依頼文から手で選んでもらう。
      setMessage("コピーできませんでした。下の「依頼文を確かめる」を開いて、文章を長押しして選んでください");
    }
  }

  async function handlePaste() {
    try {
      const reply = (await navigator.clipboard.readText()).trim();
      if (!reply) {
        setMessage("コピーされた文章がありません。ChatGPTの返事をコピーしてからお試しください");
      } else if (reply === prompt.trim()) {
        // 返事をコピーし忘れて、依頼文のまま貼ると、依頼文を日程として読み取らせてしまう。
        setMessage("いまコピーされているのは依頼文です。ChatGPTの返事をコピーしてからお試しください");
      } else {
        onPasteReply(reply);
        setMessage("貼り付けました。下の「読み取る」を押してください");
      }
    } catch {
      setMessage("貼り付けられませんでした。下の「文章」の欄に、返事を直接貼り付けてください");
    }
  }

  return (
    <div className="space-y-3">
      <Button
        type="button"
        variant="secondary"
        className="w-full justify-between"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="inline-flex items-center gap-2">
          <MessageSquareText size={17} />
          ChatGPTで旅程を作ってもらう
        </span>
        <ChevronDown size={17} className={open ? "rotate-180" : ""} aria-hidden="true" />
      </Button>

      {open && (
        <div className="space-y-4 border-l-2 border-accent/30 pl-3">
          <p className="text-xs leading-relaxed text-slate-500">
            条件を入れると、ChatGPTに渡す依頼文ができます。ChatGPTの返事を貼れば、日程に入れられます。
            旅行名・行き先・期間・予算・メモは、依頼文に入ります。
          </p>

          <Input
            label="出発地"
            optional
            value={prefs.origin}
            onChange={(e) => update({ origin: e.target.value })}
            placeholder="例: 小金井"
            hint="空なら、現地に着いたところから作ります"
          />
          <Input
            label="同行者"
            optional
            value={prefs.party}
            onChange={(e) => update({ party: e.target.value })}
            placeholder="例: 大人2人"
          />
          <Input
            label="移動手段"
            optional
            value={prefs.transport}
            onChange={(e) => update({ transport: e.target.value })}
            placeholder="例: 電車、レンタカー"
          />
          <SegmentedField
            label="ペース"
            value={prefs.pace}
            options={PACE_OPTIONS.map(({ value, label }) => ({ value, label }))}
            onChange={(pace: TripPace) => update({ pace })}
          />
          <Textarea
            label="行きたい所・やりたいこと"
            optional
            rows={3}
            value={prefs.wishes}
            onChange={(e) => update({ wishes: e.target.value })}
            placeholder={"例:\n金刀比羅宮に行きたい\n讃岐うどんを食べたい"}
          />

          <ol className="space-y-2">
            <li className="flex items-center gap-2">
              <span className="w-4 shrink-0 text-center text-xs tabular-nums text-slate-500" aria-hidden="true">1</span>
              <Button type="button" className="flex-1" onClick={handleCopy}>
                <Copy size={17} />
                依頼文をコピー
              </Button>
            </li>
            <li className="flex items-center gap-2">
              <span className="w-4 shrink-0 text-center text-xs tabular-nums text-slate-500" aria-hidden="true">2</span>
              <Button
                type="button"
                variant="secondary"
                className="flex-1"
                onClick={() => window.open(CHATGPT_URL, "_blank", "noopener,noreferrer")}
              >
                <ExternalLink size={17} />
                ChatGPTを開く
              </Button>
            </li>
            <li className="flex items-center gap-2">
              <span className="w-4 shrink-0 text-center text-xs tabular-nums text-slate-500" aria-hidden="true">3</span>
              <Button type="button" variant="secondary" className="flex-1" onClick={handlePaste}>
                <ClipboardPaste size={17} />
                返事を貼る
              </Button>
            </li>
          </ol>
          <p className="px-1 text-xs leading-relaxed text-slate-500">
            1で依頼文をコピー → 2でChatGPTに貼り付けて送る → 返事が来たら、その文章をコピーして3を押します。
          </p>

          {message && (
            <p className="px-1 text-xs leading-relaxed text-slate-700" role="status" aria-live="polite">
              {message}
            </p>
          )}

          <details className="text-xs text-slate-500">
            <summary className="cursor-pointer py-1">依頼文を確かめる</summary>
            <Textarea rows={10} readOnly value={prompt} aria-label="ChatGPTに渡す依頼文" />
          </details>

          {/* 専用GPTから直接送る形(ログインしていない・SQL未実行の時は何も出ない)。 */}
          <ChatGptSendCodePanel />
        </div>
      )}
    </div>
  );
}
