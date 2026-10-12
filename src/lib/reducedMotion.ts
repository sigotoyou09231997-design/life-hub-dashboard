/**
 * 端末の「視差効果を減らす」(prefers-reduced-motion)がオンか。
 * CSS だけでは止めきれない、JS で時間を待ってから進める動き(スワイプの行が抜ける・完了の行がたたまれる)で、
 * 待たずにすぐ結果へ進むために使う。matchMedia が無い環境(テストの jsdom など)では「オフ」とみなす。
 */
export function prefersReducedMotion(): boolean {
  try {
    return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  } catch {
    return false;
  }
}
