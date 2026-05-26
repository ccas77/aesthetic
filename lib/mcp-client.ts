import { getAccessToken } from "./higgsfield-oauth";

// Minimal hand-rolled Streamable HTTP MCP client for the Higgsfield MCP
// server. We do NOT use the SDK because we don't need streaming, server
// push, or progress notifications, and the SDK pulls in extra deps. The
// transport is JSON-RPC 2.0 over HTTP POST with an OAuth bearer, plus an
// Mcp-Session-Id header that the server hands us at initialize time.

const ENDPOINT =
  (process.env.HIGGSFIELD_MCP_URL || "https://mcp.higgsfield.ai/mcp").replace(
    /\/$/,
    "",
  );

const PROTOCOL_VERSION = "2025-06-18";

let _rpcId = 0;
function nextId(): number {
  return ++_rpcId;
}

export interface CallToolResult {
  content?: Array<{ type?: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

interface JsonRpcResponse<T> {
  jsonrpc: "2.0";
  id: number | string;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

async function parseRpcResponse<T>(res: Response): Promise<JsonRpcResponse<T>> {
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("text/event-stream")) {
    // Streamable HTTP servers may return a single SSE event with the
    // JSON-RPC reply. Take the first "data:" line we find.
    const text = await res.text();
    const match = text.match(/^data:\s*(.*)$/m);
    if (!match) throw new Error("MCP SSE response had no data event");
    return JSON.parse(match[1]) as JsonRpcResponse<T>;
  }
  return (await res.json()) as JsonRpcResponse<T>;
}

export class McpSession {
  private sessionId: string | undefined;
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  private async request<T>(body: object, expectReply = true): Promise<{
    data?: JsonRpcResponse<T>;
    newSessionId?: string;
  }> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${this.token}`,
      "MCP-Protocol-Version": PROTOCOL_VERSION,
    };
    if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;

    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`MCP HTTP ${res.status}: ${text.slice(0, 500)}`);
    }
    const newSessionId = res.headers.get("Mcp-Session-Id") ?? undefined;

    if (!expectReply || res.status === 202) {
      // Notification or accepted-without-body
      await res.body?.cancel().catch(() => {});
      return { newSessionId };
    }
    const data = await parseRpcResponse<T>(res);
    if (data.error) {
      throw new Error(`MCP error ${data.error.code}: ${data.error.message}`);
    }
    return { data, newSessionId };
  }

  async initialize(): Promise<void> {
    const { data, newSessionId } = await this.request<{
      protocolVersion: string;
      capabilities: object;
      serverInfo: object;
    }>({
      jsonrpc: "2.0",
      id: nextId(),
      method: "initialize",
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "aesthetic", version: "0.3.0" },
      },
    });
    void data; // ack
    if (newSessionId) this.sessionId = newSessionId;
    // Notify the server that the client is ready to issue requests.
    await this.request(
      {
        jsonrpc: "2.0",
        method: "notifications/initialized",
        params: {},
      },
      false,
    );
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<CallToolResult> {
    const { data } = await this.request<CallToolResult>({
      jsonrpc: "2.0",
      id: nextId(),
      method: "tools/call",
      params: { name, arguments: args },
    });
    return data?.result ?? {};
  }

  async close(): Promise<void> {
    if (!this.sessionId) return;
    await fetch(ENDPOINT, {
      method: "DELETE",
      headers: {
        "Mcp-Session-Id": this.sessionId,
        Authorization: `Bearer ${this.token}`,
      },
    }).catch(() => {});
    this.sessionId = undefined;
  }
}

export async function withMcp<T>(
  fn: (session: McpSession) => Promise<T>,
): Promise<T> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error(
      "Higgsfield not connected. Visit /api/auth/higgsfield to authorize.",
    );
  }
  const session = new McpSession(token);
  try {
    await session.initialize();
    return await fn(session);
  } finally {
    await session.close();
  }
}
