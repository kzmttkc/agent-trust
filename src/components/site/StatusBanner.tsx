import { connection } from "next/server";
import { runScoringProbe } from "@/lib/health/scoring-probe";

/**
 * StatusBanner — 上流が落ちている時に、それをサイトの上に掲示する。
 *
 * 2026-08-13 UX監査R1 [D2]。degraded の間、/payee 経路は全滅していても
 * サイト上には一切の案内が無かった。読者から見えるのは「Not verifiable
 * right now」という個別ページの1行だけで、それが自分の入れたアドレスの
 * 性質なのかサービス側の事情なのかは区別できない。docs は「hosted status
 * page はまだ無い」と書いてあり、それは事実だが、状態を掲示しない理由には
 * ならない — 判定に使っている probe はすでに走っている。
 *
 * 測っているのは /api/health と同じ runScoringProbe()、つまり実際に
 * スコアを1件計算してみる本物の経路（隣にあるものを測らない）。結果は
 * probe 側で 60 秒メモ化されているので、頁ごとに上流を叩き直しはしない。
 *
 * 文言は事実語だけ。評価語（"we apologise" / "minor" / "some users"）は
 * 置かない — 何が読めていないかと、その結果どうなるかだけを書く。
 * ok の時は何も描かない（常設の緑バッジは、異常時の赤を見慣れさせるだけ）。
 */
export async function StatusBanner() {
  // 2026-08-13 UX監査L3 [P1・離脱級]。この掲示はライブ健全性プローブ駆動だが、
  // layout に置かれ、ホームだけが静的プリレンダされるため「ビルド時にプローブが
  // 返した error/degraded」が静的HTMLへ焼き込まれ、上流回復後も古い赤が
  // 配信され続けた（実測: /api/health=ok・全採点稼働なのにホームだけ
  // "Scoring is failing upstream"）。「Nothing is an estimate」を掲げる製品が
  // 自分の状態表示で嘘をつく＝信頼の自傷。connection() でこの掲示を必ず
  // リクエスト時レンダにし、焼き込みを構造的に禁じる（プローブは60秒メモ化
  // 済みなので毎リクエストで上流は叩かない）。ホーム以外は元から動的で無影響。
  await connection();

  let status: "ok" | "degraded" | "error";
  try {
    status = (await runScoringProbe()).status;
  } catch {
    // 掲示のための計測がページを落とすのは本末転倒。黙って何も出さない。
    return null;
  }

  if (status === "ok") return null;

  const message =
    status === "error"
      ? "Scoring is failing upstream — payee and agent lookups return no score right now."
      : "Upstream indexer degraded — payee lookups may return “not verifiable”.";

  return (
    <div
      role="status"
      className="border-b border-amber-700 bg-amber-50 px-4 py-2 text-center text-[0.8125rem] text-amber-900 sm:px-6 md:px-8"
    >
      {message}
    </div>
  );
}

export default StatusBanner;
