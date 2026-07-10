import { describe, it, expect } from "vitest";

describe("smoke", () => {
  it("vitest harness runs", () => {
    expect(1 + 1).toBe(2);
  });
});
