export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse bg-zinc-200 rounded-md ${className}`} />;
}

export function SkeletonPageHeader() {
  return (
    <div className="border-b border-zinc-200 bg-white">
      <div className="max-w-5xl mx-auto px-8 py-5">
        <Skeleton className="h-6 w-48 mb-1.5" />
        <Skeleton className="h-4 w-64" />
      </div>
    </div>
  );
}

export function SkeletonCard({ rows = 3 }: { rows?: number }) {
  return (
    <div className="bg-white border border-zinc-200 rounded-lg p-5 space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className={`h-4 ${i === 0 ? "w-1/3" : i === rows - 1 ? "w-2/3" : "w-full"}`} />
      ))}
    </div>
  );
}

export function SkeletonListItem() {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <div className="space-y-1.5 flex-1">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-3 w-32" />
      </div>
      <Skeleton className="h-5 w-16 rounded-full" />
    </div>
  );
}
