import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { DiscordClient } from "../client.js";
import { formatDMList } from "../formatters.js";
import type { Channel } from "../types.js";
import { toolResult } from "./helpers.js";

export function registerDMTools(
  server: McpServer,
  client: DiscordClient,
): void {
  server.tool(
    "discord_list_dms",
    "List your DM conversations, most recently active first. Returns the other user's name (or the group's name or members) and the channel ID needed to read messages.",
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
      // The API returns DM channels oldest first; last_message_id is a snowflake, so it sorts by last activity.
      const lastActivity = (ch: Channel) => BigInt(ch.last_message_id ?? ch.id);
      channels.sort((a, b) => (lastActivity(b) > lastActivity(a) ? 1 : -1));
      return toolResult(formatDMList(channels.slice(0, limit ?? 20)));
    },
  );
}
