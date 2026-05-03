import { SkeletonPageHeader, Skeleton } from "../../components/skeleton";

export default function SettingsLoading() {
  return (
    <div>
      <SkeletonPageHeader />
      <div className="max-w-3xl mx-auto px-8 py-8 space-y-6">
        {[1, 2].map((i) => (
          <div key={i}>
            <Skeleton className="h-3 w-20 mb-3" />
            <div className="bg-white border border-zinc-200 rounded-lg divide-y divide-zinc-100">
              {[1, 2, 3].map((j) => (
                <div key={j} className="px-5 py-4 space-y-1.5">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-4 w-48" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
