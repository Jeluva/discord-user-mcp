#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
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

  const tokenFile = process.env.DISCORD_TOKEN_FILE;
  const client = new DiscordClient(token, {
    stateDir:
      process.env.DISCORD_STATE_DIR ||
      (tokenFile ? dirname(tokenFile) : join(homedir(), ".discord-mcp")),
    dailyLimit: Number(process.env.DISCORD_DAILY_LIMIT || 40),
    dailySends: Number(process.env.DISCORD_DAILY_SENDS || 1),
    allowSend: process.env.DISCORD_ALLOW_SEND === "1",
  });

  // No token check on startup: every Claude session spawns this server, and a
  // GET /users/@me per session was most of the traffic. The first real call
  // fails clearly if the token is bad.
  if (client.isDisabled()) {
    console.error(`discord-mcp: kill switch on (${client.killSwitchPath}), every call will be refused.`);
  }

  const server = new McpServer({
    name: "discord",
    version: "0.1.0",
  });

  registerAllTools(server, client, process.env.DISCORD_ALLOW_SEND === "1");

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("discord-mcp: fatal error:", err);
  process.exit(1);
});
