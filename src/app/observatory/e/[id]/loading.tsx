import { DocLoadingSkeleton } from "@/components/site/DocLoadingSkeleton";

export default function Loading() {
  return <DocLoadingSkeleton label="Loading this endpoint's record" rows={5} />;
}
