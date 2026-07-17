import { describe, expect, it } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { z } from "zod";
import { registerVerifyReport } from "@/lib/tools/verify-report";

// Build a checksum-valid Korean RRN so the PHI check-digit guard accepts it.
function validRrn(first12: string): string {
  const w = [2, 3, 4, 5, 6, 7, 8, 9, 2, 3, 4, 5];
  let s = 0;
  for (let i = 0; i < 12; i++) s += Number(first12[i]) * w[i];
  return first12 + String((11 - (s % 11)) % 10);
}

type ToolConfig = {
  title?: string;
  description?: string;
  inputSchema: { report: z.ZodTypeAny };
};
type ToolHandler = (args: { report: unknown }) => Promise<{
  content: Array<{ type: string; text: string }>;
}>;

function captureTool(): { name: string; config: ToolConfig; handler: ToolHandler } {
  const box: { name?: string; config?: ToolConfig; handler?: ToolHandler } = {};
  const server = {
    registerTool: (n: string, c: ToolConfig, h: ToolHandler) => {
      box.name = n;
      box.config = c;
      box.handler = h;
    },
  } as unknown as McpServer;
  registerVerifyReport(server);
  if (!box.name || !box.config || !box.handler) {
    throw new Error("registerVerifyReport did not register");
  }
  return { name: box.name, config: box.config, handler: box.handler };
}

function baseReport(overrides: Record<string, unknown> = {}) {
  return {
    manifest: {
      project_fingerprint: "rf-proj-test",
      ...(overrides.manifest as object | undefined),
    },
    issued_at: "2026-07-09T00:00:00Z",
    key_id: "rf-ed25519-1",
    alg: "ed25519",
    digest: "a".repeat(64),
    signature: "b".repeat(88),
    ...Object.fromEntries(Object.entries(overrides).filter(([k]) => k !== "manifest")),
  };
}

describe("verify_report tool defences", () => {
  it("registers as verify_report", () => {
    const { name } = captureTool();
    expect(name).toBe("verify_report");
  });

  it("rejects PHI in manifest.generated_by via the tool handler", async () => {
    const { handler } = captureTool();
    const rrn = validRrn("900101123456");
    // Schema-valid shape; PHI lives in a free-text field.
    const args = {
      report: baseReport({
        manifest: {
          project_fingerprint: "rf-proj-test",
          generated_by: `author ${rrn.slice(0, 6)}-${rrn.slice(6)}`,
        },
      }),
    };
    const result = await handler(args);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.error).toBe("phi_detected");
    expect(payload.rule).toBe("krn_rrn");
    expect(JSON.stringify(payload)).not.toContain(rrn);
  });

  it("rejects an oversized manifest at the schema layer", () => {
    const { config } = captureTool();
    // 100 keys × ~200-char values exceeds MANIFEST_MAX_JSON (8192).
    const artifact_hashes: Record<string, string> = {};
    for (let i = 0; i < 100; i++) {
      artifact_hashes[`artifact_${i}`] = "x".repeat(200);
    }
    const report = baseReport({
      manifest: { project_fingerprint: "rf-proj-test", artifact_hashes },
    });
    const parsed = config.inputSchema.report.safeParse(report);
    expect(parsed.success).toBe(false);
  });

  it("rejects unknown keys under .strict()", () => {
    const { config } = captureTool();
    const report = baseReport({
      manifest: {
        project_fingerprint: "rf-proj-test",
        sneaky_extra: "should-not-pass",
      },
    });
    const parsed = config.inputSchema.report.safeParse(report);
    expect(parsed.success).toBe(false);

    const reportExtra = baseReport({ unknown_top: true });
    expect(config.inputSchema.report.safeParse(reportExtra).success).toBe(false);
  });

  it("rejects artifact_hashes with more than 100 keys", () => {
    const { config } = captureTool();
    const artifact_hashes: Record<string, string> = {};
    for (let i = 0; i < 101; i++) artifact_hashes[`k${i}`] = "h";
    const report = baseReport({
      manifest: { project_fingerprint: "rf-proj-test", artifact_hashes },
    });
    expect(config.inputSchema.report.safeParse(report).success).toBe(false);
  });

  it("accepts a minimal valid report shape", () => {
    const { config } = captureTool();
    const report = baseReport();
    expect(config.inputSchema.report.safeParse(report).success).toBe(true);
  });
});
