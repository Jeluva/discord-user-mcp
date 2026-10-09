import type {
  Channel,
  Guild,
  GuildDetailed,
  GuildMember,
  Message,
  MessageQuery,
  SearchQuery,
  SearchResponse,
  ThreadListResponse,
  User,
} from "./types.js";

export class DiscordAPIError extends Error {
  constructor(
    public status: number,
    public body: Record<string, unknown>,
  ) {
    const msg = (body.message as string) || `HTTP ${status}`;
    super(msg);
    this.name = "DiscordAPIError";
  }
}

// Read-only fork: the client can only issue GET requests, one at a time and at
// least MIN_GAP_MS apart, so the account never writes and reads at a human pace.
const MIN_GAP_MS = 1000;

export class DiscordClient {
  private baseUrl = "https://discord.com/api/v10";
  private chain: Promise<unknown> = Promise.resolve();
  private lastRequestAt = 0;

  constructor(private token: string) {}

  private get<T>(path: string): Promise<T> {
    const run = this.chain.then(() => this.fetchWithRetry<T>(path));
    this.chain = run.catch(() => {});
    return run;
  }

  private async pace(): Promise<void> {
    const wait = this.lastRequestAt + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastRequestAt = Date.now();
  }

  private async fetchWithRetry<T>(path: string): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      await this.pace();
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: "GET",
        headers: {
          Authorization: this.token,
          "User-Agent": "DiscordBot (discord-user-mcp, 0.1.0)",
        },
      });

      if (res.status === 429) {
        const data = (await res.json().catch(() => ({}))) as {
          retry_after?: number;
        };
        const wait = ((data.retry_after ?? 1) * 1000) + Math.random() * 100;
        console.error(`Rate limited, retrying in ${Math.round(wait)}ms...`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }

      if (!res.ok) {
        const error = (await res.json().catch(() => ({}))) as Record<
          string,
          unknown
        >;
        throw new DiscordAPIError(res.status, error);
      }

      return (await res.json()) as T;
    }

    throw new DiscordAPIError(429, {
      message: "Rate limited after 3 retries. Try again shortly.",
    });
  }

  // ── User ──

  getCurrentUser(): Promise<User> {
    return this.get("/users/@me");
  }

  getUser(userId: string): Promise<User> {
    return this.get(`/users/${userId}`);
  }

  // ── Guilds ──

  getMyGuilds(): Promise<Guild[]> {
    return this.get("/users/@me/guilds?with_counts=true");
  }

  getGuild(guildId: string): Promise<GuildDetailed> {
    return this.get(`/guilds/${guildId}?with_counts=true`);
  }

  getGuildChannels(guildId: string): Promise<Channel[]> {
    return this.get(`/guilds/${guildId}/channels`);
  }

  getGuildMember(guildId: string, userId: string): Promise<GuildMember> {
    return this.get(`/guilds/${guildId}/members/${userId}`);
  }

  searchGuildMembers(
    guildId: string,
    query: string,
    limit = 10,
  ): Promise<GuildMember[]> {
    return this.get(
      `/guilds/${guildId}/members/search?query=${encodeURIComponent(query)}&limit=${limit}`,
    );
  }

  // ── Channels ──

  getChannel(channelId: string): Promise<Channel> {
    return this.get(`/channels/${channelId}`);
  }

  // ── Messages ──

  getMessages(channelId: string, query: MessageQuery = {}): Promise<Message[]> {
    const params = new URLSearchParams();
    if (query.limit) params.set("limit", String(query.limit));
    if (query.before) params.set("before", query.before);
    if (query.after) params.set("after", query.after);
    if (query.around) params.set("around", query.around);
    const qs = params.toString();
    return this.get(`/channels/${channelId}/messages${qs ? `?${qs}` : ""}`);
  }

  getMessage(channelId: string, messageId: string): Promise<Message> {
    return this.get(`/channels/${channelId}/messages/${messageId}`);
  }

  getPinnedMessages(channelId: string): Promise<Message[]> {
    return this.get(`/channels/${channelId}/pins`);
  }

  // ── Search ──

  searchGuild(guildId: string, query: SearchQuery): Promise<SearchResponse> {
    const params = new URLSearchParams();
    if (query.content) params.set("content", query.content);
    if (query.author_id) params.set("author_id", query.author_id);
    if (query.channel_id) params.set("channel_id", query.channel_id);
    if (query.has) params.set("has", query.has);
    if (query.min_id) params.set("min_id", query.min_id);
    if (query.max_id) params.set("max_id", query.max_id);
    if (query.offset !== undefined) params.set("offset", String(query.offset));
    return this.get(
      `/guilds/${guildId}/messages/search?${params.toString()}`,
    );
  }

  // ── Threads ──

  getArchivedPublicThreads(channelId: string): Promise<ThreadListResponse> {
    return this.get(
      `/channels/${channelId}/threads/archived/public`,
    );
  }

  getArchivedPrivateThreads(channelId: string): Promise<ThreadListResponse> {
    return this.get(
      `/channels/${channelId}/threads/archived/private`,
    );
  }

  // ── DMs ──

  getDMChannels(): Promise<Channel[]> {
    return this.get("/users/@me/channels");
  }
}
