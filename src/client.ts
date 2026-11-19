import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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

// Guarded fork. The account got disabled on 2026-11-18 right after a POST from
// a datacenter IP, so every request now goes through these limits:
// - one request at a time, MIN_GAP_MS plus jitter apart;
// - a daily budget persisted on disk (DISCORD_DAILY_LIMIT, default 40);
// - sends only when DISCORD_ALLOW_SEND=1, at most DISCORD_DAILY_SENDS a day (default 1);
// - a kill switch file (DISABLED next to the token): if it exists nothing is sent
//   to Discord, and any 401 or account-level 403 creates it automatically;
// - no retries on 429: the call fails and the caller stops.
const MIN_GAP_MS = 3000;
const JITTER_MS = 2000;

export interface GuardOptions {
  stateDir: string;
  dailyLimit: number;
  dailySends: number;
  allowSend: boolean;
}

interface Usage {
  date: string;
  requests: number;
  sends: number;
}

export class DiscordClient {
  private baseUrl = "https://discord.com/api/v10";
  private chain: Promise<unknown> = Promise.resolve();
  private lastRequestAt = 0;

  constructor(
    private token: string,
    private guard: GuardOptions,
  ) {}

  get killSwitchPath(): string {
    return join(this.guard.stateDir, "DISABLED");
  }

  isDisabled(): boolean {
    return existsSync(this.killSwitchPath);
  }

  private trip(reason: string): void {
    try {
      mkdirSync(this.guard.stateDir, { recursive: true });
      writeFileSync(
        this.killSwitchPath,
        `${new Date().toISOString()} ${reason}\nBorrar este archivo solo despues de revisar la cuenta.\n`,
      );
    } catch {
      // best effort
    }
    console.error(`discord-mcp: kill switch on (${reason}).`);
  }

  private usagePath(): string {
    return join(this.guard.stateDir, "usage.json");
  }

  private readUsage(): Usage {
    const today = new Date().toISOString().slice(0, 10);
    try {
      const u = JSON.parse(readFileSync(this.usagePath(), "utf8")) as Usage;
      if (u.date === today) return u;
    } catch {
      // first use today
    }
    return { date: today, requests: 0, sends: 0 };
  }

  private writeUsage(u: Usage): void {
    try {
      mkdirSync(this.guard.stateDir, { recursive: true });
      writeFileSync(this.usagePath(), JSON.stringify(u));
    } catch {
      // best effort
    }
  }

  // Checks the kill switch and the budgets, then books the request.
  private admit(method: "GET" | "POST"): void {
    if (this.isDisabled()) {
      throw new DiscordAPIError(0, {
        message: `Discord MCP deshabilitado (existe ${this.killSwitchPath}). No se hizo ninguna llamada.`,
      });
    }
    const u = this.readUsage();
    if (u.requests >= this.guard.dailyLimit) {
      throw new DiscordAPIError(0, {
        message: `Tope diario de ${this.guard.dailyLimit} llamadas a Discord alcanzado. Seguir manana.`,
      });
    }
    if (method === "POST") {
      if (!this.guard.allowSend) {
        throw new DiscordAPIError(0, {
          message: "Enviar esta apagado (DISCORD_ALLOW_SEND no es 1). Pasale el texto a Jero para que lo mande el.",
        });
      }
      if (u.sends >= this.guard.dailySends) {
        throw new DiscordAPIError(0, {
          message: `Tope diario de ${this.guard.dailySends} mensajes alcanzado.`,
        });
      }
      u.sends++;
    }
    u.requests++;
    this.writeUsage(u);
  }

  private get<T>(path: string): Promise<T> {
    return this.send<T>("GET", path);
  }

  // Only sendMessage may use a non-GET method (POST /channels/{id}/messages).
  private send<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const run = this.chain.then(() => this.fetchOnce<T>(method, path, body));
    this.chain = run.catch(() => {});
    return run;
  }

  private async pace(): Promise<void> {
    const gap = MIN_GAP_MS + Math.random() * JITTER_MS;
    const wait = this.lastRequestAt + gap - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastRequestAt = Date.now();
  }

  private async fetchOnce<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    this.admit(method);
    await this.pace();
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: this.token,
        "User-Agent": "DiscordBot (discord-user-mcp, 0.1.0)",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (res.ok) return (await res.json()) as T;

    const error = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const code = Number(error.code ?? 0);
    // 401 = token invalid or account disabled. 40001/40002/40003 = unauthorized,
    // unverified or rate-limited account. Stop for good instead of insisting.
    if (res.status === 401 || [40001, 40002, 40003].includes(code)) {
      this.trip(`HTTP ${res.status} code ${code} on ${method} ${path.split("?")[0]}`);
    }
    if (res.status === 429) {
      throw new DiscordAPIError(429, {
        message: "Discord limito las llamadas (429). No se reintenta: parar y seguir otro dia.",
      });
    }
    throw new DiscordAPIError(res.status, error);
  }

  // ── Send (the only write) ──

  sendMessage(channelId: string, content: string, replyTo?: string): Promise<Message> {
    return this.send("POST", `/channels/${channelId}/messages`, {
      content,
      nonce: String(Date.now()),
      ...(replyTo ? { message_reference: { message_id: replyTo } } : {}),
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
