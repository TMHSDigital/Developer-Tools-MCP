#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { register as registerGetRegistry } from "./tools/getRegistry.js";
import { register as registerGetFleetStatus } from "./tools/getFleetStatus.js";
import { register as registerCheckDrift } from "./tools/checkDrift.js";
import { register as registerInspectRepo } from "./tools/inspectRepo.js";

const server = new McpServer({
  name: "devtools-mcp",
  version: "0.1.0",
});

registerGetRegistry(server);
registerGetFleetStatus(server);
registerCheckDrift(server);
registerInspectRepo(server);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
