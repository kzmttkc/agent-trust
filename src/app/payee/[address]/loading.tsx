import { DocLoadingSkeleton } from "@/components/site/DocLoadingSkeleton";

export default function Loading() {
  return <DocLoadingSkeleton label="Loading this payee's profile" rows={5} />;
}
