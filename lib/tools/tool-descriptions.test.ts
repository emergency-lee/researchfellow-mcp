import { describe, expect, it } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerNoveltyCheck } from "@/lib/tools/novelty-check";
import { registerJournalFit } from "@/lib/tools/journal-fit";
import { registerMethodologyAdvisor } from "@/lib/tools/methodology-advisor";

type ToolConfig = { description?: string };

function captureDescription(
  register: (server: McpServer) => void,
): string {
  const box: { description?: string } = {};
  const server = {
    registerTool: (_n: string, c: ToolConfig) => {
      box.description = c.description;
    },
  } as unknown as McpServer;
  register(server);
  if (typeof box.description !== "string") {
    throw new Error("registerTool did not capture a description");
  }
  return box.description;
}

describe("MCP tool descriptions stay within actual scope", () => {
  it("novelty_check states PubMed-only max-40 scan and is not a systematic review", () => {
    const description = captureDescription(registerNoveltyCheck);
    expect(description).toContain("max 40");
    expect(description).toContain("Not a systematic review");
  });

  it("journal_fit states the static list of 10 journals", () => {
    const description = captureDescription(registerJournalFit);
    expect(description).toContain("static list of 10");
  });

  it("methodology_advisor states rule-based recommendations", () => {
    const description = captureDescription(registerMethodologyAdvisor);
    expect(description).toContain("Rule-based");
  });
});
