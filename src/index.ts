#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { AtlassianClient } from "./http.js";
import { JiraAttachments } from "./jira.js";
import { ConfluenceAttachments } from "./confluence.js";
import { resolveSandboxRoot, Sandbox } from "./sandbox.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const sandbox = new Sandbox(resolveSandboxRoot());
  await sandbox.init();

  const client = new AtlassianClient(config);
  const server = createServer({
    jira: new JiraAttachments(client),
    confluence: new ConfluenceAttachments(client),
    sandbox,
    siteHost: new URL(config.siteUrl).host,
  });
  await server.connect(new StdioServerTransport());
  // stdout carries the MCP protocol — human output goes to stderr only.
  console.error(
    `atlassian-attachments-mcp ready — site ${config.siteUrl}, sandbox ${sandbox.root}`,
  );
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
