import type { Metadata } from "next";

/**
 * /signup の metadata の置き場所（2026-08-13 UX監査2巡目 [m2]）。
 *
 * page.tsx は "use client" なので metadata を export できない（Next.js は
 * クライアントコンポーネントの metadata を無視する）。このルート専用の
 * layout を1枚挟むのが公式の逃げ道。挟んでいなかったので、このページは
 * layout の default —— LP と同じ長い表題 —— をそのまま名乗っていた。
 *
 * 接尾辞は書かない。ルート layout の template "%s | vet402" が付ける。
 */
export const metadata: Metadata = {
  title: "Get an API key",
  description:
    "Create a vet402 API key. The free tier is 1,000 lookups a month — score a payee before your agent pays it.",
};

export default function SignupLayout({ children }: { children: React.ReactNode }) {
  return children;
}
