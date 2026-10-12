import { useEffect, useState } from "react";
import { loadIsFeedbackOwner } from "../lib/appFeedback";

/** 前回確かめた結果。アプリを開くたびに問い合わせが返るまでボタンが出たり消えたり
 * しないように、この端末で覚えておく(本当の答えは毎回問い合わせて上書きする)。 */
const OWNER_CACHE_KEY = "lifehub.isFeedbackOwner";

function readCache(): boolean | undefined {
  try {
    const value = window.localStorage.getItem(OWNER_CACHE_KEY);
    return value === "1" ? true : value === "0" ? false : undefined;
  } catch {
    return undefined;
  }
}

function writeCache(isOwner: boolean) {
  try {
    window.localStorage.setItem(OWNER_CACHE_KEY, isOwner ? "1" : "0");
  } catch {
    // 覚えられなくても、毎回問い合わせれば答えは出る
  }
}

/**
 * ログインしているのがアプリの持ち主か(supabase/sql/029 の app_feedback_owner)。
 * まだ分からない間は undefined。持ち主の表が無い・確かめられない時は false。
 */
export function useIsFeedbackOwner(): boolean | undefined {
  const [isOwner, setIsOwner] = useState<boolean | undefined>(readCache);
  useEffect(() => {
    let active = true;
    void loadIsFeedbackOwner()
      .catch(() => false)
      .then((result) => {
        if (!active) return;
        writeCache(result);
        setIsOwner(result);
      });
    return () => {
      active = false;
    };
  }, []);
  return isOwner;
}
