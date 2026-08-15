"use client";

import { DocErrorPanel } from "@/components/site/DocRouteFallback";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <DocErrorPanel error={error} reset={reset} title="this payee's profile" />;
}
