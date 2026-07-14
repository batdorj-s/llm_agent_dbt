import { Router } from "express";
import { requireAuth, createToken, verifyToken } from "../auth.js";
import { authenticateUser, createUser } from "../db/data-lake.js";
import { authLimiter, registerLimiter } from "../rate-limiter.js";
import { getPermissions } from "../middleware/rbac.js";

const router = Router();

router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }
  const limiterKey = `login:${email || req.ip}`;
  const limit = await authLimiter.check(limiterKey);
  if (!limit.allowed) {
    return res.status(429).json({ error: limit.message, resetInMs: limit.resetInMs });
  }
  try {
    const user = await authenticateUser(email, password);
    if (!user) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    const token = createToken(user.id, user.role as any);
    res.json({ success: true, token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Login failed" });
  }
});

router.post("/register", async (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password || !name) {
    return res.status(400).json({ error: "Email, password, and name are required" });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters" });
  }
  const limit = await registerLimiter.check(`register:${req.ip}`);
  if (!limit.allowed) {
    return res.status(429).json({ error: "Too many registration attempts. Try again later.", resetInMs: limit.resetInMs });
  }
  try {
    const userId = await createUser(email, password, name);
    if (!userId) {
      return res.status(409).json({ error: "Email already registered" });
    }
    const token = createToken(userId, "viewer");
    res.status(201).json({ success: true, token, user: { id: userId, name, email, role: "viewer" } });
  } catch (err: unknown) {
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
