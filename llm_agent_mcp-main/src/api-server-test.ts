import express from "express";

const app = express();
app.use(express.json());

app.get("/api/status", (_req, res) => {
  res.json({ status: "ok" });
});

app.post("/api/auth/login", async (_req, res) => {
  res.json({ token: "test" });
});

console.log("[API] Registering export routes...");
app.post("/api/report/export-pdf", async (_req, res) => {
  console.log("[API] PDF handler called!");
  res.json({ ok: true });
});

console.log("[API] Registering XLSX export route...");
app.post("/api/report/export-xlsx", async (_req, res) => {
  console.log("[API] XLSX handler called!");
  res.json({ ok: true });
});

const PORT = 3091;
app.listen(PORT, () => {
  console.log(`API Server running at http://localhost:${PORT}`);
});
