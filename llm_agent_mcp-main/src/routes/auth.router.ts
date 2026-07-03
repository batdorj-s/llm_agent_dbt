import { Router } from "express";
import type { UserRole } from "../multi-agent.js";
import { createToken, verifyBearerHeader } from "../auth.js";
import { authLimiter } from "../rate-limiter.js";
import { authenticateUser, createUser } from "../db/data-lake.js";

export const authRouter = Router();

authRouter.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Email and password required" });
  if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Invalid email format" });

  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const rl = await authLimiter.check(ip);
  if (!rl.allowed) return res.status(429).json({ error: rl.message });

  try {
    const user = await authenticateUser(email, password);
    if (!user) return res.status(401).json({ error: "Invalid email or password" });
    const token = createToken(user.id, user.role);
    res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role }, message: `Logged in as ${user.name}` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

authRouter.post("/register", async (req, res) => {
  const auth = verifyBearerHeader(req.headers.authorization);
  if (!auth.success || !auth.payload) return res.status(401).json({ error: auth.error });
  if (auth.payload.role !== "admin") return res.status(403).json({ error: "Only admins can create new users" });

  const { email, password, name, role } = req.body;
  if (!email || !password || !name) return res.status(400).json({ error: "email, password, and name are required" });
  if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Invalid email format" });

  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const rl = await authLimiter.check(ip);
  if (!rl.allowed) return res.status(429).json({ error: rl.message });

  const userRole: UserRole = role === "analyst" ? "analyst" : role === "admin" ? "admin" : "viewer";

  try {
    const userId = await createUser(email, password, name, userRole);
    if (!userId) return res.status(409).json({ error: "Email already registered" });
    res.status(201).json({ success: true, userId, role: userRole });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
