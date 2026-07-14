"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { Database, GitBranch, Search, X, Move, ZoomIn, ZoomOut } from "lucide-react";

interface LineageNode {
  id: number;
  name: string;
  shortName: string;
  type: string;
  meta: { description?: string; materialized?: string } | null;
}

interface LineageEdge {
  source: number;
  target: number;
}

interface LineageData {
  available?: boolean;
  message?: string;
  nodes?: LineageNode[];
  edges?: LineageEdge[];
}

const NODE_COLORS: Record<string, string> = {
  source: "#3b82f6",
  model: "#10b981",
  test: "#f59e0b",
};

const NODE_BG: Record<string, string> = {
  source: "rgba(59, 130, 246, 0.1)",
  model: "rgba(16, 185, 129, 0.1)",
  test: "rgba(245, 158, 11, 0.1)",
};

const NODE_WIDTH = 120;
const NODE_HEIGHT = 36;
const LEVEL_GAP = 250;
const NODE_GAP = 16;

function layoutDag(nodes: LineageNode[], edges: LineageEdge[]): Map<number, { x: number; y: number }> {
  if (nodes.length === 0) return new Map();

  // Build adjacency and compute in-degree for topological sort (left to right = source to model)
  const inDeg = new Map<number, number>();
  const adj = new Map<number, number[]>();
  const revAdj = new Map<number, number[]>();

  for (const n of nodes) {
    inDeg.set(n.id, 0);
    adj.set(n.id, []);
    revAdj.set(n.id, []);
  }

  for (const e of edges) {
    if (adj.has(e.source) && adj.has(e.target)) {
      adj.get(e.source)!.push(e.target);
      revAdj.get(e.target)!.push(e.source);
      inDeg.set(e.target, (inDeg.get(e.target) || 0) + 1);
    }
  }

  // Topological sort
  const levels = new Map<number, number>(); // node id -> level
  const queue: number[] = [];

  for (const [id, deg] of inDeg) {
    if (deg === 0) {
      queue.push(id);
      levels.set(id, 0);
    }
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentLevel = levels.get(current) || 0;

    for (const next of adj.get(current) || []) {
      const nextLevel = levels.get(next) || 0;
      if (currentLevel + 1 > nextLevel) {
        levels.set(next, currentLevel + 1);
      }
      const deg = (inDeg.get(next) || 1) - 1;
      inDeg.set(next, deg);
      if (deg <= 0 && !queue.includes(next)) {
        queue.push(next);
      }
    }
  }

  // Group nodes by level
  const levelGroups = new Map<number, number[]>();
  for (const [id, level] of levels) {
    if (!levelGroups.has(level)) levelGroups.set(level, []);
    levelGroups.get(level)!.push(id);
  }

  // Position nodes
  const positions = new Map<number, { x: number; y: number }>();
  for (const [level, ids] of levelGroups) {
    const totalHeight = ids.length * NODE_HEIGHT + (ids.length - 1) * NODE_GAP;
    const startY = -totalHeight / 2;
    ids.forEach((id, i) => {
      positions.set(id, {
        x: level * LEVEL_GAP + 60,
        y: startY + i * (NODE_HEIGHT + NODE_GAP),
      });
    });
  }

  return positions;
}

export function DataLineageView({ token }: { token: string | null }) {
  const [data, setData] = useState<LineageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchModel, setSearchModel] = useState("");
  const [selectedNode, setSelectedNode] = useState<LineageNode | null>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const svgRef = useRef<SVGSVGElement>(null);

  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const fetchLineage = useCallback(async (model?: string) => {
    setLoading(true);
    try {
      const params = model ? `?model=${encodeURIComponent(model)}` : "";
      const res = await fetch(`/api/lineage${params}`, { headers });
      if (!res.ok) {
        setData({ available: false, message: `Алдаа: ${res.status}` });
        setLoading(false);
        return;
      }
      const d = await res.json();
      if (d.success) setData(d.data);
      else setData({ available: false, message: d.error || "Алдаа гарлаа" });
    } catch {
      setData({ available: false, message: "Серверт холбогдох боломжгүй" });
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchLineage();
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchLineage(searchModel || undefined);
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-foreground/30 text-xs animate-pulse">Ачаалж байна...</div>
      </div>
    );
  }

  if (data && !data.available) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-foreground/40 gap-3">
        <GitBranch className="w-10 h-10 opacity-30" />
        <div className="text-xs">Lineage өгөгдөл олдсонгүй</div>
        <div className="text-[10px] text-foreground/30">dbt docs generate ажиллуулаад дахин оролдоно уу</div>
      </div>
    );
  }

  if (!data || (!data.available && data.available !== undefined)) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-foreground/40 gap-3">
        <GitBranch className="w-10 h-10 opacity-30" />
        <div className="text-xs">{data?.message || "Lineage өгөгдөл ачаалахад алдаа гарлаа"}</div>
      </div>
    );
  }

  const nodes = data.nodes ?? [];
  const edges = data.edges ?? [];
  const positions = layoutDag(nodes, edges);
  const minX = Math.min(...Array.from(positions.values()).map((p) => p.x), 0);
  const maxX = Math.max(...Array.from(positions.values()).map((p) => p.x + NODE_WIDTH), 600);
  const minY = Math.min(...Array.from(positions.values()).map((p) => p.y), -200);
  const maxY = Math.max(...Array.from(positions.values()).map((p) => p.y + NODE_HEIGHT), 200);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Toolbar */}
      <div className="px-4 py-2 border-b border-border flex items-center gap-2">
        <div className="flex items-center gap-1.5 text-foreground/70">
          <GitBranch className="w-4 h-4" />
          <span className="text-xs font-semibold">Өгөгдлийн гарал үүсэл (Lineage)</span>
           <span className="text-[10px] text-foreground/40">{nodes.length} зангилаа</span>
        </div>

        <form onSubmit={handleSearch} className="flex items-center gap-1 ml-auto">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-foreground/40" />
            <input
              type="text"
              value={searchModel}
              onChange={(e) => setSearchModel(e.target.value)}
              placeholder="Модел хайх..."
              className="w-40 pl-7 pr-2 py-1 text-xs rounded-md border border-border bg-background text-foreground placeholder:text-foreground/30 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <button type="button" onClick={() => { setSearchModel(""); fetchLineage(); }} className="text-[10px] text-foreground/40 hover:text-foreground/70 px-1.5 cursor-pointer">
            <X className="w-3 h-3" />
          </button>
        </form>

        <div className="flex items-center gap-1 ml-2">
          <button onClick={() => setScale((s) => Math.min(s + 0.2, 3))} className="p-1 text-foreground/40 hover:text-foreground/70 cursor-pointer">
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => setScale((s) => Math.max(s - 0.2, 0.3))} className="p-1 text-foreground/40 hover:text-foreground/70 cursor-pointer">
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => { setScale(1); setOffset({ x: 0, y: 0 }); }} className="text-[10px] text-foreground/40 hover:text-foreground/70 px-1 cursor-pointer">
            Reset
          </button>
        </div>
      </div>

      {/* SVG Canvas */}
      <div className="flex-1 overflow-hidden bg-background relative">
        <svg
          ref={svgRef}
          className="w-full h-full cursor-grab active:cursor-grabbing"
          onMouseDown={(e) => {
            setDragging(true);
            setDragStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
          }}
          onMouseMove={(e) => {
            if (dragging) {
              setOffset({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
            }
          }}
          onMouseUp={() => setDragging(false)}
          onMouseLeave={() => setDragging(false)}
        >
          <g transform={`translate(${offset.x + 100}, ${offset.y + 200}) scale(${scale})`}>
            {/* Edges */}
            {edges.map((e, i) => {
              const src = positions.get(e.source);
              const tgt = positions.get(e.target);
              if (!src || !tgt) return null;
              const sx = src.x + NODE_WIDTH;
              const sy = src.y + NODE_HEIGHT / 2;
              const tx = tgt.x;
              const ty = tgt.y + NODE_HEIGHT / 2;
              const cx = (sx + tx) / 2;
              return (
                <path
                  key={i}
                  d={`M ${sx} ${sy} C ${cx} ${sy}, ${cx} ${ty}, ${tx} ${ty}`}
                  fill="none"
                  stroke="rgba(255,255,255,0.08)"
                  strokeWidth={1.5}
                  markerEnd="url(#arrowhead)"
                />
              );
            })}

            {/* Arrow marker */}
            <defs>
              <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                <polygon points="0 0, 8 3, 0 6" fill="rgba(255,255,255,0.15)" />
              </marker>
            </defs>

            {/* Nodes */}
            {nodes.map((node) => {
              const pos = positions.get(node.id);
              if (!pos) return null;
              const color = NODE_COLORS[node.type] || "#6b7280";
              const bg = NODE_BG[node.type] || "rgba(107,114,128,0.1)";
              const isSelected = selectedNode?.id === node.id;

              return (
                <g
                  key={node.id}
                  onClick={() => setSelectedNode(node)}
                  className="cursor-pointer"
                >
                  <rect
                    x={pos.x}
                    y={pos.y}
                    width={NODE_WIDTH}
                    height={NODE_HEIGHT}
                    rx={6}
                    ry={6}
                    fill={isSelected ? color : bg}
                    stroke={isSelected ? color : "transparent"}
                    strokeWidth={1.5}
                  />
                  <text
                    x={pos.x + NODE_WIDTH / 2}
                    y={pos.y + NODE_HEIGHT / 2}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill={isSelected ? "#fff" : "rgba(255,255,255,0.8)"}
                    fontSize={10}
                    fontFamily="monospace"
                  >
                    {node.shortName}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>

        {/* Legend */}
        <div className="absolute bottom-3 left-3 flex items-center gap-3 bg-card/80 backdrop-blur-sm rounded-md border border-border px-3 py-1.5">
          {Object.entries(NODE_COLORS).map(([type, color]) => (
            <div key={type} className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: color }} />
              <span className="text-[9px] text-foreground/50">{type}</span>
            </div>
          ))}
        </div>

        {/* Detail panel */}
        {selectedNode && (
          <div className="absolute top-3 right-3 w-64 bg-card border border-border rounded-lg shadow-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <Database className="w-3.5 h-3.5" style={{ color: NODE_COLORS[selectedNode.type] }} />
                <span className="text-xs font-semibold text-foreground">{selectedNode.shortName}</span>
              </div>
              <button onClick={() => setSelectedNode(null)} className="text-foreground/30 hover:text-foreground/60 cursor-pointer">
                <X className="w-3 h-3" />
              </button>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] text-foreground/40">Type:</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: NODE_BG[selectedNode.type], color: NODE_COLORS[selectedNode.type] }}>
                  {selectedNode.type}
                </span>
              </div>
              {selectedNode.meta?.materialized && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] text-foreground/40">Materialization:</span>
                  <span className="text-[10px] text-foreground/70">{selectedNode.meta.materialized}</span>
                </div>
              )}
              {selectedNode.meta?.description && (
                <div>
                  <span className="text-[9px] text-foreground/40">Description:</span>
                  <p className="text-[10px] text-foreground/70 mt-0.5 leading-relaxed">{selectedNode.meta.description}</p>
                </div>
              )}
              <div className="text-[9px] text-foreground/30 pt-1 border-t border-border/60">
                {selectedNode.name}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
