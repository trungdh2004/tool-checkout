import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, parseMasterKey } from "./crypto.js";
import { shouldReplay } from "./runner.js";
import { cronExpression } from "./scheduler.js";

describe("scheduled replay rules", () => {
  it.each([0, 2, 3])("does not replay with %i checks", (count) => {
    expect(shouldReplay(count)).toBe(false);
  });

  it("replays only with exactly one check", () => {
    expect(shouldReplay(1)).toBe(true);
  });

  it("converts profile time into a daily cron without catch-up", () => {
    expect(cronExpression("17:40")).toBe("0 40 17 * * *");
  });
});

describe("credential encryption", () => {
  it("round trips with AES-GCM", () => {
    const key = parseMasterKey("11".repeat(32));
    const encrypted = encryptSecret("not-plaintext", key);
    expect(encrypted).not.toContain("not-plaintext");
    expect(decryptSecret(encrypted, key)).toBe("not-plaintext");
  });

  it("requires a 32-byte master key", () => {
    expect(() => parseMasterKey("short")).toThrow(/32 bytes/);
  });
});
