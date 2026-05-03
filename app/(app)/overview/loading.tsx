import { SkeletonPageHeader, Skeleton, SkeletonCard } from "../../components/skeleton";

export default function OverviewLoading() {
  return (
    <div>
      <SkeletonPageHeader />
      <div className="max-w-5xl mx-auto px-8 py-8 space-y-8">
        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white border border-zinc-200 rounded-lg p-5 space-y-2">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-8 w-12" />
            </div>
          ))}
        </div>
        {/* Ask shortcut */}
        <SkeletonCard rows={1} />
        {/* Recent pages */}
        <div>
          <Skeleton className="h-3 w-24 mb-3" />
          <div className="bg-white border border-zinc-200 rounded-lg divide-y divide-zinc-100">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center justify-between px-4 py-3">
                <div className="space-y-1.5">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-28" />
                </div>
                <Skeleton className="h-5 w-14 rounded-full" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
