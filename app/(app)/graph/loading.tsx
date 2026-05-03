import { SkeletonPageHeader } from "../../components/skeleton";

export default function GraphLoading() {
  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <div className="shrink-0">
        <SkeletonPageHeader />
      </div>
      <div className="flex-1 bg-[#0c0c0e] flex items-center justify-center">
        <p className="text-sm text-zinc-600">Loading graph…</p>
      </div>
    </div>
  );
}
