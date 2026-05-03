import Link from "next/link";
import { auth } from "@/auth";
import { getGraph } from "@/lib/gbrain";
import { PageHeader } from "../../components/page-header";
import { GraphCanvas } from "./graph-canvas";

export default async function GraphPage() {
  const session = await auth();
  const userId = session!.user!.id;

  const { nodes, edges } = await getGraph(userId);

  const counts = nodes.reduce<Record<string, number>>((acc, n) => {
    acc[n.type] = (acc[n.type] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <div className="shrink-0">
        <PageHeader
          title="Graph"
          subtitle={`${nodes.length} pages · ${edges.length} links`}
          actions={
            <Link
              href="/pages"
              className="text-xs px-3 py-1.5 bg-white border border-zinc-200 rounded-lg hover:bg-zinc-100 transition-colors text-zinc-700"
            >
              List view
            </Link>
          }
        />
      </div>

      <div className="flex-1 min-h-0">
        {nodes.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-zinc-500">
              No pages yet.{" "}
              <Link href="/sources" className="text-violet-600 hover:underline">
                Go to Sources
              </Link>{" "}
              to sync and extract.
            </p>
          </div>
        ) : (
          <GraphCanvas
            nodes={nodes.map((n) => ({ id: n.slug, ...n }))}
            edges={edges}
            counts={counts}
          />
        )}
      </div>
    </div>
  );
}
