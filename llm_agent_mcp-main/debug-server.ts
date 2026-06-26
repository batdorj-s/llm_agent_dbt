/**
 * Minimal server that exactly mimics api-server.ts structure
 * to isolate the route registration bug.
 */

import express from "express";

const app = express();
app.use(express.json());

// Route 1 — at top of module, like /api/status in original
app.get("/api/route-one", (req, res) => {
  res.json({ route: "one" });
});

// Route 2 — in the middle, like /api/report/export-pdf in original
console.log("[DEBUG] Registering /api/route-two...");
app.post("/api/route-two", (req, res) => {
  console.log("[DEBUG] /api/route-two handler called!");
  res.json({ route: "two" });
});

// Register all the same routes as api-server.ts (simplified stubs)
app.get("/api/status", (req, res) => res.json({ status: "ok" }));
app.get("/api/kpi/:metric", (req, res) => res.json({ metric: req.params.metric }));
app.get("/api/kpi-history", (req, res) => res.json([]));
app.get("/api/dashboard/computed-metrics", (req, res) => res.json({}));
app.post("/api/auth/login", async (req, res) => res.json({ token: "test" }));
app.post("/api/chat", async (req, res) => res.json({ response: "test" }));
app.post("/api/admin/upload-csv", async (req, res) => res.json({ success: true }));
app.post("/api/kpi/:metric/target", async (req, res) => res.json({ success: true }));
app.post("/api/feedback", async (req, res) => res.json({ success: true }));

// Export routes
console.log("[DEBUG] Registering /api/report/export-pdf...");
app.post("/api/report/export-pdf", async (req, res) => {
  console.log("[DEBUG] PDF handler called!");
  res.json({ ok: true });
});

console.log("[DEBUG] Registering /api/report/export-xlsx...");
app.post("/api/report/export-xlsx", async (req, res) => {
  console.log("[DEBUG] XLSX handler called!");
  res.json({ ok: true });
});

console.log("[DEBUG] All routes registered. Starting server...");

// Now start via async function (like api-server.ts)
async function start() {
  await new Promise(r => setTimeout(r, 100));
  app.listen(3089, () => {
    console.log("[DEBUG] Server on 3089");
    // Print registered routes
    try {
      const printRoutes = (stack: any[], prefix = "") => {
        for (const layer of stack || []) {
          if (layer.route) {
            const methods = Object.keys(layer.route.methods).join(",").toUpperCase();
            console.log(`  ${methods} ${prefix}${layer.route.path}`);
          } else if (layer.handle?.stack) {
            printRoutes(layer.handle.stack, prefix);
          }
        }
      };
      // Force _router init by making a dummy internal request
      const req = { url: "/", method: "GET" } as any;
      const res = { end: () => {} } as any;
      app(req, res, () => {});
      // Now _router should be initialized
      if ((app as any)._router?.stack) {
        console.log("[DEBUG] Route stack:");
        printRoutes((app as any)._router.stack);
      } else {
        console.log("[DEBUG] _router still undefined after forced init");
      }
    } catch (e) {
      console.log("[DEBUG] Error printing routes:", e);
    }
  });
}

if (process.env.NODE_ENV !== "test") {
  start().catch(console.error);
}
