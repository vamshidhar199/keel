import { SkeletonPageHeader, Skeleton, SkeletonCard } from "../../../components/skeleton";

export default function PageDetailLoading() {
  return (
    <div>
      <SkeletonPageHeader />
      <div className="max-w-3xl mx-auto px-8 py-8 space-y-4">
        <Skeleton className="h-3 w-40" />
        {/* Body */}
        <div className="bg-white border border-zinc-200 rounded-lg p-6 space-y-2">
          {[100, 90, 95, 70, 85, 60].map((w, i) => (
            <Skeleton key={i} className={`h-4 w-[${w}%]`} />
          ))}
        </div>
        <SkeletonCard rows={3} />
      </div>
    </div>
  );
}
