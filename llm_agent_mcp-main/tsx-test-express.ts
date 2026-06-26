import express from "express";

const app = express();
app.use(express.json());

console.log("[API] Registering export routes...");
app.post("/api/report/export-pdf", async (_req: any, res: any) => {
  res.json({ ok: true });
});
console.log("[API] Registering XLSX export route...");
app.post("/api/report/export-xlsx", async (_req: any, res: any) => {
  res.json({ ok: true });
});

// Also add a test GET route at module level
app.get("/api/test", (_req: any, res: any) => {
  res.json({ moduleLevel: true });
});

// Add another GET route
app.get("/api/report/test", (_req: any, res: any) => {
  res.json({ reportTest: true });
});

async function start() {
  // Simulate some async work
  await new Promise(r => setTimeout(r, 100));
  app.listen(3095, () => {
    console.log("tsx test on 3095");
  });
}

start().catch(console.error);
