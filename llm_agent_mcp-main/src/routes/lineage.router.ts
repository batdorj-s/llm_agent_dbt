/**
 * lineage.router.ts — Data Lineage / DAG API
 *
 * Reads dbt graph_summary.json and manifest.json to serve
 * a clean data lineage graph for frontend visualization.
 *
 * GET /api/lineage             → Full DAG (nodes + edges)
 * GET /api/lineage?model=name  → Subgraph for a specific model
 * GET /api/lineage?type=source → Filter by node type
 */

import { Router } from "express";
import fs from "fs";
import path from "path";
import { requirePermission } from "../middleware/rbac.js";
import { log } from "./shared.js";

const router = Router();

const DBT_TARGET_DIR = path.join(process.cwd(), "dbt", "target");

interface LinkedNode {
  name: string;
  type: string;
  succ?: number[];
}

interface GraphSummary {
  linked: Record<string, LinkedNode>;
}

interface LineageNode {
  id: number;
  name: string;
  shortName: string;
  type: string;
}

interface LineageEdge {
  source: number;
  target: number;
}

function loadLineage(): { nodes: LineageNode[]; edges: LineageEdge[] } | null {
  const graphPath = path.join(DBT_TARGET_DIR, "graph_summary.json");
  if (!fs.existsSync(graphPath)) return null;

  try {
    const raw = fs.readFileSync(graphPath, "utf-8");
    const parsed: GraphSummary = JSON.parse(raw);
    const linked = parsed.linked;
    if (!linked) return null;

    const nodes: LineageNode[] = [];
    const edgeSet = new Set<string>();

    for (const [idStr, node] of Object.entries(linked)) {
      const id = Number(idStr);
      const parts = node.name.split(".");
      const shortName = parts[parts.length - 1] || node.name;

      nodes.push({ id, name: node.name, shortName, type: node.type });

      if (node.succ) {
        for (const targetId of node.succ) {
          const key = `${id}->${targetId}`;
          if (!edgeSet.has(key)) {
            edgeSet.add(key);
          }
        }
      }
    }

    // Build edges from succ relationships — an edge from n.id → target means n has a succ of target
    const edges: LineageEdge[] = [];
    for (const node of nodes) {
      const linkedNode = linked[String(node.id)];
      if (linkedNode?.succ) {
        for (const targetId of linkedNode.succ) {
          edges.push({ source: node.id, target: targetId });
        }
      }
    }

    return { nodes, edges };
  } catch (err) {
    log("error", "Failed to load graph_summary.json", {} as any, { error: (err as Error).message });
    return null;
  }
}

function extractManifestMetadata(): Record<string, { description?: string; materialized?: string }> {
  const manifestPath = path.join(DBT_TARGET_DIR, "manifest.json");
  if (!fs.existsSync(manifestPath)) return {};

  try {
    const raw = fs.readFileSync(manifestPath, "utf-8");
    const manifest = JSON.parse(raw);
    const meta: Record<string, { description?: string; materialized?: string }> = {};

    if (manifest.nodes) {
      for (const [uid, node] of Object.entries(manifest.nodes) as [string, any][]) {
        if (node.resource_type === "model") {
          const name = uid.split(".").pop() || "";
          meta[name] = {
            description: node.description?.slice(0, 200),
            materialized: node.config?.materialized,
          };
        }
      }
    }
    return meta;
  } catch {
    return {};
  }
}

router.get("/lineage", requirePermission("glossary:read"), (req, res) => {
  try {
    const graph = loadLineage();
    if (!graph) {
      res.json({ success: true, data: { available: false, message: "No lineage data found. Run 'dbt docs generate' first." } });
      return;
    }

    const manifestMeta = extractManifestMetadata();
    const { model, type } = req.query;

    let { nodes, edges } = graph;

    // Filter by type (source / model / test)
    if (type && typeof type === "string") {
      nodes = nodes.filter((n) => n.type === type);
      const validIds = new Set(nodes.map((n) => n.id));
      edges = edges.filter((e) => validIds.has(e.source) && validIds.has(e.target));
    }

    // Filter subgraph for a specific model (includes upstream + downstream)
    if (model && typeof model === "string") {
      const modelNode = nodes.find((n) => n.shortName === model || n.name === model);
      if (modelNode) {
        const visited = new Set<number>();
        const queue = [modelNode.id];

        // Traverse upstream (reverse edges) and downstream (succ edges)
        const adjUp = new Map<number, number[]>();
        const adjDown = new Map<number, number[]>();
        for (const e of edges) {
          if (!adjDown.has(e.source)) adjDown.set(e.source, []);
          adjDown.get(e.source)!.push(e.target);
          if (!adjUp.has(e.target)) adjUp.set(e.target, []);
          adjUp.get(e.target)!.push(e.source);
        }

        while (queue.length > 0) {
          const current = queue.pop()!;
          if (visited.has(current)) continue;
          visited.add(current);

          for (const neighbor of [...(adjDown.get(current) || []), ...(adjUp.get(current) || [])]) {
            if (!visited.has(neighbor)) queue.push(neighbor);
          }
        }

        nodes = nodes.filter((n) => visited.has(n.id));
        edges = edges.filter((e) => visited.has(e.source) && visited.has(e.target));
      }
    }

    // Attach manifest metadata to model nodes
    const enrichedNodes = nodes.map((n) => ({
      ...n,
      meta: manifestMeta[n.shortName] || null,
    }));

    res.json({ success: true, data: { nodes: enrichedNodes, edges } });
  } catch (err) {
    log("error", "Lineage route failed", {} as any, { error: (err as Error).message });
    res.status(500).json({ success: false, error: "Failed to load lineage data" });
  }
});

export default router;
