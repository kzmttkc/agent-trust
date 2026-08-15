import { DocLoadingSkeleton } from "@/components/site/DocLoadingSkeleton";

export default function Loading() {
  return <DocLoadingSkeleton label="Loading this agent's passport" rows={5} />;
}
