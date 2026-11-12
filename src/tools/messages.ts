import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { DiscordClient } from "../client.js";
import { formatMessage, formatMessageList } from "../formatters.js";
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

  server.tool(
    "discord_send_message",
    "Send a message to a Discord channel as the user. Only call after the user approved the exact text. Optional reply_to creates a reply.",
    {
      channel_id: z.string().describe("The channel ID to send to."),
      content: z.string().describe("Message content. Supports Discord markdown."),
      reply_to: z.string().optional().describe("Message ID to reply to."),
    },
    async ({ channel_id, content, reply_to }) => {
      const msg = await client.sendMessage(channel_id, content, reply_to);
      return toolResult(`Message sent (ID: ${msg.id}).
${formatMessage(msg)}`);
    },
  );
}
