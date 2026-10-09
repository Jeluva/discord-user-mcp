#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { DiscordClient } from "./client.js";
import { registerAllTools } from "./tools/register.js";

// DISCORD_TOKEN_FILE keeps the token out of the MCP client config.
function readToken(): string | undefined {
  if (process.env.DISCORD_TOKEN) return process.env.DISCORD_TOKEN;
  const file = process.env.DISCORD_TOKEN_FILE;
  if (!file) return undefined;
  try {
    return readFileSync(file, "utf8").trim() || undefined;
  } catch {
    console.error(`discord-mcp: could not read DISCORD_TOKEN_FILE (${file}).`);
    return undefined;
  }
}

async function main() {
  const token = readToken();
  if (!token) {
    console.error("DISCORD_TOKEN or DISCORD_TOKEN_FILE is required.");
    console.error(
      "This is your Discord USER token (not a bot token).",
    );
    console.error(
      "Set it in your MCP server config or export it in your shell.",
    );
    process.exit(1);
  }

  const client = new DiscordClient(token);

  // Validate token on startup
  try {
    const me = await client.getCurrentUser();
    console.error(`discord-mcp: authenticated as ${me.username}`);
  } catch {
    console.error(
      "discord-mcp: failed to authenticate. Check your DISCORD_TOKEN.",
    );
    process.exit(1);
  }

  const server = new McpServer({
    name: "discord",
    version: "0.1.0",
  });

  registerAllTools(server, client);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("discord-mcp: fatal error:", err);
  process.exit(1);
});
