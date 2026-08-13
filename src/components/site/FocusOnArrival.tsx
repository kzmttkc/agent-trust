"use client";

import { useEffect } from "react";

/**
 * FocusOnArrival — 検索フォームから届いた読者のフォーカスを、結果の見出しへ
 * 移す。
 *
 * 2026-08-13 アクセシビリティ監査 [E3]。/payee の送信は素の GET フォームで、
 * サーバ側の redirect で /payee/<address> へ着地する。つまり完全な再読込に
 * なるので、フォーカスは document の先頭（BODY）に戻る。検索して結果を得た
 * 読者は、その結果を読むためにヘッダのリンク9本を Tab で通り直すことになる。
 * これはページ内の SPA 遷移ではないので SiteChrome の遷移フックでは拾えない。
 *
 * 発火条件を「同一オリジンの /payee から来た時」だけに絞っているのが肝心な
 * ところ。ブックマークや外部リンクで直接この URL を開いた読者にはフォーカスを
 * 動かさない — 頼んでいない読者のフォーカスを奪うのは、それ自体が別の
 * アクセシビリティ欠陥になる。
 */
export function FocusOnArrival({
  targetId,
  /** この接頭辞の同一オリジン referrer から来た時だけフォーカスを移す。 */
  fromPathPrefix,
}: {
  targetId: string;
  fromPathPrefix: string;
}) {
  useEffect(() => {
    const ref = document.referrer;
    if (!ref) return;
    let from: URL;
    try {
      from = new URL(ref);
    } catch {
      return;
    }
    if (from.origin !== window.location.origin) return;
    if (!from.pathname.startsWith(fromPathPrefix)) return;
    // 自分自身から来た場合（結果ページ内のリンク）は動かさない。
    if (from.pathname === window.location.pathname) return;

    const el = document.getElementById(targetId);
    if (!el) return;
    // preventScroll: フォーカスは移すが、紙面の先頭にいる読者を勝手に
    // スクロールさせない。見出しは元から画面内にある。
    el.focus({ preventScroll: true });
  }, [targetId, fromPathPrefix]);

  return null;
}

export default FocusOnArrival;
