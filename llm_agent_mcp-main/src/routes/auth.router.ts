import { Router, type Request } from "express";
import { requireAuth, createToken, verifyToken } from "../auth.js";
import { authenticateUser, createUser } from "../db/data-lake.js";
import { authLimiter, registerLimiter } from "../rate-limiter.js";
import { getPermissions } from "../middleware/rbac.js";
import { validatePassword } from "../utils/password-policy.js";
import { writeAuditLog, deriveAction } from "../middleware/audit.js";

const router = Router();

function auditLogin(req: Request, status: number, userId?: string, details?: Record<string, unknown>): void {
  void writeAuditLog({
    action: deriveAction(req.method, req.originalUrl),
    method: req.method,
    path: req.originalUrl,
    status,
    userId,
    ip: req.ip,
    requestId: req.reqId,
    details,
  });
}

router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    auditLogin(req, 400);
    return res.status(400).json({ error: "Email and password are required" });
  }
  const limiterKey = `login:${email || req.ip}`;
  const limit = await authLimiter.check(limiterKey);
  if (!limit.allowed) {
    auditLogin(req, 429);
    return res.status(429).json({ error: limit.message, resetInMs: limit.resetInMs });
  }
  try {
    const user = await authenticateUser(email, password);
    if (!user) {
      auditLogin(req, 401, undefined, { email });
      return res.status(401).json({ error: "Invalid email or password" });
    }
    const token = createToken(user.id, user.role as any);
    auditLogin(req, 200, user.id);
    res.json({ success: true, token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (err: unknown) {
    auditLogin(req, 500, undefined, { email });
    res.status(500).json({ error: err instanceof Error ? err.message : "Login failed" });
  }
});

router.post("/register", async (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password || !name) {
    return res.status(400).json({ error: "Email, password, and name are required" });
  }
  const passwordError = validatePassword(password);
  if (passwordError) {
    return res.status(400).json({ error: passwordError });
  }
  const limit = await registerLimiter.check(`register:${req.ip}`);
  if (!limit.allowed) {
    auditLogin(req, 429, undefined, { email });
    return res.status(429).json({ error: "Too many registration attempts. Try again later.", resetInMs: limit.resetInMs });
  }
  try {
    const userId = await createUser(email, password, name);
    if (!userId) {
      auditLogin(req, 409, undefined, { email });
      return res.status(409).json({ error: "Email already registered" });
    }
    const token = createToken(userId, "viewer");
    auditLogin(req, 201, userId);
    res.status(201).json({ success: true, token, user: { id: userId, name, email, role: "viewer" } });
  } catch (err: unknown) {
    auditLogin(req, 500, undefined, { email });
    res.status(500).json({ error: err instanceof Error ? err.message : "Registration failed" });
  }
});

router.get("/me", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  const token = authHeader.slice(7);
  const result = verifyToken(token);
  if (!result.success || !result.payload) {
    return res.status(401).json({ error: result.error || "Invalid token" });
  }
  res.json({ success: true, user: { id: result.payload.userId, role: result.payload.role } });
});

router.get("/permissions", requireAuth, async (req, res) => {
  const user = (req as any).user;
  if (!user) return res.status(401).json({ error: "Not authenticated" });
  res.json({
    success: true,
    role: user.role,
    permissions: getPermissions(user.role),
  });
});

export default router;
