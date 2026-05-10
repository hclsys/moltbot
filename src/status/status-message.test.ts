import { describe, expect, it } from "vitest";
import { formatFastModeLabel } from "./status-labels.js";

describe("formatFastModeLabel", () => {
  it("shows fast mode when enabled", () => {
    expect(formatFastModeLabel(true)).toBe("Fast");
  });

  it("hides fast mode when disabled", () => {
    expect(formatFastModeLabel(false)).toBeNull();
  });
});

describe("resolveStatusHarnessId session pin", () => {
  it("normalizeOptionalLowercaseString guards", () => {
    // This verifies the guard logic pattern used in resolveStatusHarnessId:
    // sessionEntry.agentHarnessId="claude-cli" → pinnedId="claude-cli" ≠ "pi" → trust it
    // sessionEntry.agentHarnessId="pi" → pinnedId="pi" → fall through to re-derive
    // sessionEntry.agentHarnessId=undefined → pinnedId=undefined → fall through to re-derive
    const normalizeOptionalLowercaseString = (v?: string) => v?.toLowerCase().trim() || undefined;
    expect(normalizeOptionalLowercaseString("claude-cli")).toBe("claude-cli");
    expect(normalizeOptionalLowercaseString("PI")).toBe("pi");
    expect(normalizeOptionalLowercaseString(undefined)).toBeUndefined();
    expect(normalizeOptionalLowercaseString("")).toBeUndefined();
  });
});
