import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { DiscordClient } from "../client.js";
import { formatDMList } from "../formatters.js";
import { toolResult } from "./helpers.js";

export function registerDMTools(
  server: McpServer,
  client: DiscordClient,
): void {
  server.tool(
    "discord_list_dms",
    "List your recent DM conversations. Returns the other user's name and the channel ID needed to read messages.",
    {
      limit: z
        .number()
        .min(1)
        .max(50)
        .optional()
        .describe("Number of DM channels to return (default 20)."),
    },
    async ({ limit }) => {
      const channels = await client.getDMChannels();
      const trimmed = channels.slice(0, limit ?? 20);
      return toolResult(formatDMList(trimmed));
    },
  );
}
