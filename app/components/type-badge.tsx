const TYPE_STYLES: Record<string, string> = {
  person: "bg-blue-50 text-blue-700",
  company: "bg-emerald-50 text-emerald-700",
  project: "bg-violet-50 text-violet-700",
  topic: "bg-amber-50 text-amber-700",
};

export const TYPE_DOTS: Record<string, string> = {
  person: "#3b82f6",
  company: "#10b981",
  project: "#8b5cf6",
  topic: "#f59e0b",
};

export function TypeBadge({ type }: { type: string }) {
  return (
    <span
      className={`text-xs px-2 py-0.5 rounded-full ${
        TYPE_STYLES[type] ?? "bg-zinc-100 text-zinc-600"
      }`}
    >
      {type}
    </span>
  );
}
