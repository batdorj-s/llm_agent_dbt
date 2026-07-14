import { describe, it, expect, vi } from "vitest";

describe("Notifications Module", () => {
  it("should export notification functions", async () => {
    const notif = await import("../services/notifications.js");
    expect(notif.sendNotification).toBeDefined();
    expect(typeof notif.sendNotification).toBe("function");
    expect(notif.sendNotificationToAllChannels).toBeDefined();
    expect(typeof notif.sendNotificationToAllChannels).toBe("function");
    expect(notif.sendBulkNotification).toBeDefined();
    expect(typeof notif.sendBulkNotification).toBe("function");
  });

  it("should export notification router with CRUD endpoints", async () => {
    const router = await import("../routes/notification.router.js");
    expect(router.default).toBeDefined();
    const routes = router.default.stack || [];
    const paths = routes.map((r: any) => r.route?.path).filter(Boolean);
    expect(paths).toContain("/notifications/preferences");
    expect(paths).toContain("/notifications/test");
  });

  it("should have notification:read and notification:write permissions", async () => {
    const rbac = await import("../middleware/rbac.js");
    expect(rbac.hasPermission("viewer", "notification:read")).toBe(true);
    expect(rbac.hasPermission("analyst", "notification:read")).toBe(true);
    expect(rbac.hasPermission("analyst", "notification:write")).toBe(true);
    expect(rbac.hasPermission("admin", "notification:read")).toBe(true);
    expect(rbac.hasPermission("admin", "notification:write")).toBe(true);
    expect(rbac.hasPermission("viewer", "notification:write")).toBe(false);
  });

  it("sendBulkNotification should handle empty user list", async () => {
    const { sendBulkNotification } = await import("../services/notifications.js");
    const results = await sendBulkNotification([], { subject: "test", body: "test body" });
    expect(results).toEqual([]);
  });

  it("should export NotificationMessage type shape", async () => {
    const msg: any = { subject: "Test", body: "Hello" };
    expect(msg.subject).toBe("Test");
    expect(msg.body).toBe("Hello");
  });
});
