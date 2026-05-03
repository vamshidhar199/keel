import { SkeletonPageHeader, Skeleton, SkeletonListItem } from "../../components/skeleton";

export default function PagesLoading() {
  return (
    <div>
      <SkeletonPageHeader />
      <div className="max-w-5xl mx-auto px-8 py-8 space-y-4">
        {/* Type filter pills */}
        <div className="flex gap-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-7 w-16 rounded-full" />
          ))}
        </div>
        {/* List */}
        <div className="bg-white border border-zinc-200 rounded-lg divide-y divide-zinc-100">
          {Array.from({ length: 8 }).map((_, i) => (
            <SkeletonListItem key={i} />
          ))}
        </div>
      </div>
    </div>
  );
}
