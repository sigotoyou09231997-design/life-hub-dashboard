import { useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import type { TripRoutePlace, TripScheduleItem } from "../../types";
import {
  buildRemapLines,
  collectPlaces,
  defaultChoices,
  describeCost,
  requestPlaceSuggestions,
  type PlaceSuggestResult,
} from "../../lib/placeSuggestions";
import { Button } from "../ui/Button";

interface Props {
  tripName: string;
  destination: string;
  schedule: TripScheduleItem[];
  routePlaces: TripRoutePlace[];
  /** 選んだ内容(「元 → 新」の行)を、下の対応表に入れる。書き換えはまだしない。 */
  onUse: (lines: string) => void;
}

/**
 * 「場所をまとめて直す」の上に置く、AI の提案(2026-10-14、要望「経路がおかしい」「複数候補があるなら選択できるように」)。
 * 名前だけの場所に都道府県・市区町村を補う候補を AI が出し、本人が選んだものだけを対応表に入れる。
 * 迷う場所は「要確認」と出し、本人が選ぶまで対応表に入れない。AI は間違うことがあるので、書き換える前にもう一度確かめられる
 * (対応表に入れたあと、下の「書き換える」で、何件に当たるかが出てから押す)。
 */
export function PlaceSuggestPanel({ tripName, destination, schedule, routePlaces, onUse }: Props) {
  const collected = useMemo(() => collectPlaces(schedule, routePlaces), [schedule, routePlaces]);
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [error, setError] = useState("");
  const [result, setResult] = useState<PlaceSuggestResult | null>(null);
  const [choices, setChoices] = useState<Record<string, number | null>>({});

  if (collected.places.length === 0) {
    return (
      <p className="rounded-xl bg-slate-50/80 p-3 text-sm text-slate-600">
        都道府県・市区町村が書かれていない場所は、ありません。
      </p>
    );
  }

  async function handleAsk() {
    setState("loading");
    setError("");
    try {
      const next = await requestPlaceSuggestions({ tripName, destination, places: collected.places, context: collected.context });
      setResult(next);
      setChoices(defaultChoices(next.suggestions));
      setState("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "提案を取得できませんでした");
      setState("error");
    }
  }

  const suggestions = result?.suggestions ?? [];
  const missing = collected.places.filter((place) => !suggestions.some((suggestion) => suggestion.from === place));
  const lines = buildRemapLines(suggestions, choices);
  const chosenCount = lines ? lines.split("\n").length : 0;
  const unsure = suggestions.filter((suggestion) => !suggestion.sure && choices[suggestion.from] == null).length;

  return (
    <section className="flex flex-col gap-3 rounded-xl bg-white/60 p-3" aria-label="AIで場所を補う">
      <div>
        <p className="text-sm font-semibold text-slate-800">AIで都道府県・市区町村を補う</p>
        <p className="mt-0.5 text-xs text-slate-500">
          名前だけの場所が{collected.places.length}件あります。旅行の名前・行き先と、場所の名前だけをAIに送って、同じ名前の別の場所に置かれないよう、候補を出してもらいます。1回あたり数円ほどかかります。
        </p>
      </div>

      <Button variant="secondary" disabled={state === "loading"} onClick={() => void handleAsk()}>
        <Sparkles size={16} aria-hidden="true" />
        {state === "loading" ? "考えています…" : state === "done" ? "もう一度聞く" : `AIに聞く（${collected.places.length}件）`}
      </Button>
      {collected.truncated && <p className="text-xs text-amber-800">場所が多いので、先頭の{collected.places.length}件だけ聞きます。残りは、書き換えたあとにもう一度聞いてください。</p>}

      {state === "error" && (
        <p role="alert" className="rounded-lg bg-red-50 p-2 text-sm text-red-800">
          {error}
        </p>
      )}

      {state === "done" && (
        <>
          <p className="text-xs text-slate-500">
            AIの提案です。間違っていることがあります。「要確認」の場所は、選ぶまで対応表に入りません。入れたあと、下の「書き換える」の前にもう一度確かめられます。
          </p>
          {suggestions.length === 0 ? (
            <p className="text-sm text-slate-700">提案できる場所がありませんでした。</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {suggestions.map((suggestion) => (
                <li key={suggestion.from}>
                  <fieldset className="flex flex-col gap-1">
                    <legend className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                      {suggestion.from}
                      {!suggestion.sure && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">要確認</span>}
                    </legend>
                    {suggestion.candidates.map((candidate, index) => (
                      <label key={candidate.to} className="flex items-start gap-2 text-sm text-slate-700">
                        <input
                          type="radio"
                          className="mt-1"
                          name={`place-${suggestion.from}`}
                          checked={choices[suggestion.from] === index}
                          onChange={() => setChoices((current) => ({ ...current, [suggestion.from]: index }))}
                        />
                        <span>{candidate.to}</span>
                      </label>
                    ))}
                    <label className="flex items-start gap-2 text-sm text-slate-500">
                      <input
                        type="radio"
                        className="mt-1"
                        name={`place-${suggestion.from}`}
                        checked={choices[suggestion.from] == null}
                        onChange={() => setChoices((current) => ({ ...current, [suggestion.from]: null }))}
                      />
                      <span>変えない</span>
                    </label>
                  </fieldset>
                </li>
              ))}
            </ul>
          )}
          {missing.length > 0 && (
            <p className="text-xs text-slate-500">
              提案できなかった場所（{missing.length}件）: {missing.join("、")}
            </p>
          )}
          {result?.usage && <p className="text-xs text-slate-400">{describeCost(result.usage)}</p>}
          {unsure > 0 && <p className="text-xs text-amber-800">「要確認」の場所が{unsure}件、まだ選ばれていません。</p>}
          <Button disabled={chosenCount === 0} onClick={() => onUse(lines)}>
            選んだ内容を対応表に入れる（{chosenCount}件）
          </Button>
        </>
      )}
    </section>
  );
}
