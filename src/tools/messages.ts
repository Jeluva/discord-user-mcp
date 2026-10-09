import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { DiscordClient } from "../client.js";
import { formatMessageList } from "../formatters.js";
import { toolResult } from "./helpers.js";

export function registerMessageTools(
  server: McpServer,
  client: DiscordClient,
): void {
  server.tool(
    "discord_read_messages",
    "Read recent messages from a Discord channel. Returns messages in chronological order (oldest first). Use 'before' for pagination to read further back in history.",
    {
      channel_id: z.string().describe("The channel ID to read from."),
      limit: z
        .number()
        .min(1)
        .max(100)
        .optional()
        .describe("Number of messages to fetch (1-100, default 25)."),
      before: z
        .string()
        .optional()
        .describe(
          "Message ID — fetch messages before this one (for pagination backward).",
        ),
      after: z
        .string()
        .optional()
        .describe(
          "Message ID — fetch messages after this one (for pagination forward).",
        ),
    },
    async ({ channel_id, limit, before, after }) => {
      const messages = await client.getMessages(channel_id, {
        limit: limit ?? 25,
        before,
        after,
      });
      return toolResult(formatMessageList(messages, { showPagination: true }));
    },
  );
}
