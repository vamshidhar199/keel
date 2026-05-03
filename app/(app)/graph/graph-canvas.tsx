"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-[#0c0c0e]">
      <p className="text-sm text-zinc-600">Loading graph…</p>
    </div>
  ),
});

interface Node {
  id: string;
  title: string;
  type: string;
  link_count: number;
}
interface Edge {
  source: string;
  target: string;
}
interface Props {
  nodes: Node[];
  edges: Edge[];
  counts: Record<string, number>;
}

const TYPE_COLORS: Record<string, string> = {
  person: "#60a5fa",
  company: "#34d399",
  project: "#a78bfa",
  topic: "#fbbf24",
};

export function GraphCanvas({ nodes, edges, counts }: Props) {
  const router = useRouter();
  const graphRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [hoveredNode, setHoveredNode] = useState<any>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const data = useMemo(
    () => ({
      nodes: nodes.map((n) => ({ ...n })),
      links: edges.map((e) => ({ source: e.source, target: e.target })),
    }),
    [nodes, edges]
  );

  // Stronger repulsion so nodes spread out and labels don't overlap
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!graphRef.current) return;
      graphRef.current.d3Force("charge")?.strength(-280);
      graphRef.current.d3Force("link")?.distance(80);
    }, 100);
    return () => clearTimeout(timer);
  }, [data]);

  const highlightNodes = useMemo(() => {
    if (!hoveredNode) return new Set<string>();
    const connected = new Set<string>([hoveredNode.id]);
    data.links.forEach((link: any) => {
      const src = typeof link.source === "object" ? link.source.id : link.source;
      const tgt = typeof link.target === "object" ? link.target.id : link.target;
      if (src === hoveredNode.id) connected.add(tgt);
      if (tgt === hoveredNode.id) connected.add(src);
    });
    return connected;
  }, [hoveredNode, data.links]);

  const handleNodeHover = useCallback((node: any) => {
    setHoveredNode(node ?? null);
    if (containerRef.current) {
      containerRef.current.style.cursor = node ? "pointer" : "default";
    }
  }, []);

  const paintNode = useCallback(
    (node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const isHovered = node.id === hoveredNode?.id;
      const isHighlighted = highlightNodes.has(node.id);
      const isDimmed = !!hoveredNode && !isHighlighted;

      const baseR = 4 + Math.sqrt(Math.max(0, node.link_count ?? 0)) * 1.8;
      const r = isHovered ? baseR * 1.4 : baseR;
      const color = TYPE_COLORS[node.type] ?? "#a1a1aa";

      // Outer glow ring for hovered node
      if (isHovered) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, r + 6, 0, 2 * Math.PI);
        ctx.fillStyle = `${color}20`;
        ctx.fill();
        ctx.shadowBlur = 28;
        ctx.shadowColor = color;
      } else if (isHighlighted) {
        ctx.shadowBlur = 14;
        ctx.shadowColor = color;
      } else {
        ctx.shadowBlur = 0;
      }

      // Node circle
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
      ctx.fillStyle = isDimmed ? `${color}28` : color;
      ctx.fill();
      ctx.shadowBlur = 0;

      // Labels only visible from a reasonable zoom level
      if (globalScale >= 0.55) {
        const label =
          node.title.length > 20 ? node.title.slice(0, 18) + "…" : node.title;
        const fontSize = Math.max(9, 11 / globalScale);
        ctx.font = `500 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
        ctx.shadowBlur = 5;
        ctx.shadowColor = "rgba(0,0,0,1)";
        ctx.fillStyle = isDimmed
          ? "rgba(255,255,255,0.12)"
          : isHovered
          ? "#ffffff"
          : "rgba(255,255,255,0.72)";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(label, node.x, node.y + r + 4);
        ctx.shadowBlur = 0;
      }
    },
    [hoveredNode, highlightNodes]
  );

  const paintNodeArea = useCallback(
    (node: any, color: string, ctx: CanvasRenderingContext2D) => {
      const r = 4 + Math.sqrt(Math.max(0, node.link_count ?? 0)) * 1.8 + 6;
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();
    },
    []
  );

  const getLinkColor = useCallback(
    (link: any) => {
      if (!hoveredNode) return "rgba(255,255,255,0.22)";
      const src = typeof link.source === "object" ? link.source.id : link.source;
      const tgt = typeof link.target === "object" ? link.target.id : link.target;
      return src === hoveredNode.id || tgt === hoveredNode.id
        ? "rgba(255,255,255,0.65)"
        : "rgba(255,255,255,0.05)";
    },
    [hoveredNode]
  );

  const getLinkWidth = useCallback(
    (link: any) => {
      if (!hoveredNode) return 1;
      const src = typeof link.source === "object" ? link.source.id : link.source;
      const tgt = typeof link.target === "object" ? link.target.id : link.target;
      return src === hoveredNode.id || tgt === hoveredNode.id ? 2.5 : 0.5;
    },
    [hoveredNode]
  );

  return (
    <div ref={containerRef} className="relative w-full h-full bg-[#0c0c0e]">
      <ForceGraph2D
        ref={graphRef}
        graphData={data}
        width={size.w}
        height={size.h}
        backgroundColor="#0c0c0e"
        nodeCanvasObject={paintNode}
        nodeCanvasObjectMode={() => "replace"}
        nodePointerAreaPaint={paintNodeArea}
        nodeLabel={() => ""}
        linkColor={getLinkColor}
        linkWidth={getLinkWidth}
        linkDirectionalArrowLength={5}
        linkDirectionalArrowRelPos={1}
        linkDirectionalArrowColor={() => "rgba(255,255,255,0.25)"}
        linkDirectionalParticles={2}
        linkDirectionalParticleWidth={1.5}
        linkDirectionalParticleColor={() => "rgba(255,255,255,0.35)"}
        cooldownTicks={160}
        onNodeClick={(n: any) => router.push(`/pages/${n.id}`)}
        onNodeHover={handleNodeHover}
        onEngineStop={() => graphRef.current?.zoomToFit(500, 80)}
      />

      {/* Legend overlay */}
      <div className="absolute top-4 left-4 bg-black/50 backdrop-blur-md rounded-xl px-4 py-3 border border-white/10 space-y-2">
        {Object.entries(counts).map(([type, count]) => (
          <div key={type} className="flex items-center gap-2.5">
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{
                background: TYPE_COLORS[type] ?? "#a1a1aa",
                boxShadow: `0 0 8px ${TYPE_COLORS[type] ?? "#a1a1aa"}`,
              }}
            />
            <span className="text-xs font-medium text-white/70 capitalize">{type}</span>
            <span className="text-xs text-white/30 ml-auto pl-4">{count}</span>
          </div>
        ))}
      </div>

      {/* Hovered node info */}
      {hoveredNode && (
        <div className="absolute bottom-4 left-4 bg-black/60 backdrop-blur-md border border-white/10 rounded-xl px-4 py-2.5 pointer-events-none">
          <p className="text-sm font-semibold text-white">{hoveredNode.title}</p>
          <p className="text-xs text-white/40 mt-0.5 capitalize">
            {hoveredNode.type} · {hoveredNode.link_count} link{hoveredNode.link_count === 1 ? "" : "s"}
          </p>
        </div>
      )}

      {/* Fit view button */}
      <button
        onClick={() => graphRef.current?.zoomToFit(400, 80)}
        className="absolute bottom-4 right-4 text-xs font-medium text-white/50 hover:text-white/90 bg-black/50 backdrop-blur-md border border-white/10 rounded-lg px-3 py-1.5 transition-colors"
      >
        Fit view
      </button>
    </div>
  );
}
