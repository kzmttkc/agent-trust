"use client";

/**
 * Dashboard-wide error boundary（B1・2026-08-15）。ダッシュボード配下は
 * ほぼ全てクライアントコンポーネント（"use client" + useEffect fetch）で、
 * 各ページが自前のtry/catchでdashboardErrorMessage()を出しているが、
 * それ自体が投げる（unhandled render error）経路は白画面に落ちていた。
 * zinc世界のトークン（dash-*）で意匠を揃える。
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-md space-y-4 py-16 text-center">
      <p className="dash-title">Something went wrong</p>
      <p className="dash-lede">
        This is a fault on our side. Your account and data are unaffected.
      </p>
      {error.digest ? <p className="font-mono text-xs text-zinc-500">Ref: {error.digest}</p> : null}
      <button type="button" onClick={reset} className="dash-alert dash-alert-muted px-4 py-2 font-medium">
        Try again
      </button>
    </div>
  );
}
