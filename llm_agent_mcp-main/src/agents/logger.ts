/**
 * Lightweight structured JSON logger for agent subsystem.
 * Replaces ad-hoc console.log/warn/error with consistent JSON output.
 */

type Level = "info" | "warn" | "error";

function emit(level: Level, component: string, msg: string, meta?: Record<string, unknown>): void {
  const entry: Record<string, unknown> = {
    t: new Date().toISOString(),
    lvl: level,
    component,
    msg,
  };
  if (meta) {
    for (const [k, v] of Object.entries(meta)) {
      if (v !== undefined) entry[k] = v;
    }
  }
  const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  fn(JSON.stringify(entry));
}

export function createLogger(component: string) {
  return {
    info: (msg: string, meta?: Record<string, unknown>) => emit("info", component, msg, meta),
    warn: (msg: string, meta?: Record<string, unknown>) => emit("warn", component, msg, meta),
    error: (msg: string, meta?: Record<string, unknown>) => emit("error", component, msg, meta),
  };
}
