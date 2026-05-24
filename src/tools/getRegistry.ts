import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { fetchRegistry, errorResponse } from "../utils/github.js";

const STATUSES = [
  "experimental",
  "beta",
  "active",
  "maintenance",
  "deprecated",
  "archived",
] as const;

const inputSchema = {
  type: z
    .enum(["cursor-plugin", "mcp-server"])
    .optional()
    .describe("Filter by tool type"),
  status: z
    .enum(STATUSES)
    .optional()
    .describe("Filter by lifecycle status"),
  slug: z
    .string()
    .optional()
    .describe("Return only the entry with this exact slug"),
};

export function register(server: McpServer): void {
  server.tool(
    "devtools_getRegistry",
    "Return entries from the TMHSDigital developer-tools ecosystem registry. Optionally filter by type, status, or slug. Returns all entries when no filter is given.",
    inputSchema,
    async ({ type, status, slug }) => {
      try {
        let entries = await fetchRegistry();
        if (type) entries = entries.filter((e) => e.type === type);
        if (status) entries = entries.filter((e) => e.status === status);
        if (slug) entries = entries.filter((e) => e.slug === slug);
        return {
          content: [{ type: "text", text: JSON.stringify(entries, null, 2) }],
        };
      } catch (error) {
        return errorResponse(error);
      }
    },
  );
}
