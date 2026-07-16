import { Skeleton } from "@gateflow/ui";

export default function GuardLoading() {
  return (
    <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-28 w-full rounded-2xl" />
      ))}
    </div>
  );
}
