import { describe, it, expect } from "vitest";
import { requestContext, getContext, getRequestId } from "../context.js";

describe("request context", () => {
  it("is undefined outside of a run scope", () => {
    expect(getContext()).toBeUndefined();
    expect(getRequestId()).toBe("-");
  });

  it("propagates requestId and userId through async call chains", async () => {
    const inner = () => {
      const ctx = getContext();
      return { ctx, id: getRequestId() };
    };

    const captured = await requestContext.run(
      { requestId: "req-123", userId: "user-1", ipAddress: "127.0.0.1" },
      async () => {
        await new Promise(r => setTimeout(r, 5));
        return inner();
      }
    );

    expect(captured?.ctx?.requestId).toBe("req-123");
    expect(captured?.ctx?.userId).toBe("user-1");
    expect(captured?.ctx?.ipAddress).toBe("127.0.0.1");
    expect(captured?.id).toBe("req-123");
  });

  it("returns default dash outside of scope", () => {
    const id = getRequestId();
    expect(id).toBe("-");
  });
});
