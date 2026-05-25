// Calls Higgsfield's MCP server via the Anthropic API to generate a single
// image. Returns the URL of the generated image (still on Higgsfield's CDN).
//
// Requires env vars:
//   ANTHROPIC_API_KEY         — required
//   HIGGSFIELD_MCP_URL        — defaults to https://mcp.higgsfield.ai/mcp
//   HIGGSFIELD_TOKEN_SECRET   — required, encrypts the OAuth tokens at rest
//
// The Higgsfield bearer comes from the OAuth flow under
// /api/auth/higgsfield; getAccessToken() auto-refreshes near expiry.

import Anthropic from "@anthropic-ai/sdk";
import { getAccessToken } from "./higgsfield-oauth";

interface GenerateOptions {
  prompt: string;
  aspectRatio?: string; // e.g. "2:3"
}

export async function generateStillViaHiggsfield(
  opts: GenerateOptions,
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const mcpUrl = process.env.HIGGSFIELD_MCP_URL || "https://mcp.higgsfield.ai/mcp";
  const mcpToken = await getAccessToken();
  if (!mcpToken) {
    throw new Error(
      "Higgsfield not connected. Visit /api/auth/higgsfield to authorize.",
    );
  }

  const client = new Anthropic({ apiKey });

  const mcpServer: Record<string, unknown> = {
    type: "url",
    url: mcpUrl,
    name: "higgsfield",
    authorization_token: mcpToken,
  };

  const aspect = opts.aspectRatio || "2:3";

  // Higgsfield's generate_image is async: it returns a job UUID and the
  // image URL only appears later via job_status. The system prompt below
  // instructs Claude to chain generate_image → job_status(sync=true) until
  // the job lands in a terminal state, then emit the rawUrl as plain text.
  const response = await client.beta.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 8192,
    betas: ["mcp-client-2025-04-04"],
    mcp_servers: [
      mcpServer as unknown as Anthropic.Beta.BetaRequestMCPServerURLDefinition,
    ],
    system:
      "You are an image-fetching agent. Use the Higgsfield MCP tools.\n" +
      "1. Call generate_image with arguments { params: { prompt, model: \"nano_banana_pro\", aspect_ratio } }.\n" +
      "2. From the response, extract the job UUID at results[0].id (it is also called id or job_id in some shapes).\n" +
      "3. Call job_status with arguments { jobId: <UUID>, sync: true }. If status is pending or processing, call it again.\n" +
      "4. When status is completed or succeeded, extract generation.results.rawUrl (fall back to minUrl, then url).\n" +
      "5. Reply with ONLY that URL as plain text, nothing else. No prose, no markdown, no quotes.\n" +
      "If any tool call returns an error, reply with the literal string ERROR: followed by the error message.",
    messages: [
      {
        role: "user",
        content: `prompt: ${opts.prompt}\naspect_ratio: ${aspect}`,
      },
    ],
  });

  type AnyBlock = { type: string; text?: string; content?: unknown };
  const blocks = (response.content as unknown as AnyBlock[]) || [];

  // Preferred path: the final text block is the URL.
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (b.type === "text" && typeof b.text === "string") {
      const trimmed = b.text.trim();
      if (trimmed.startsWith("ERROR:")) {
        throw new Error(`Higgsfield: ${trimmed}`);
      }
      const url = extractAnyUrl(trimmed);
      if (url) return url;
    }
  }

  // Fallback: scan the last mcp_tool_result for a URL in the known JSON paths.
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (b.type !== "mcp_tool_result") continue;
    const inner = b.content;
    const texts: string[] = [];
    if (typeof inner === "string") texts.push(inner);
    else if (Array.isArray(inner)) {
      for (const item of inner as Array<{ type?: string; text?: string }>) {
        if (item?.text) texts.push(item.text);
      }
    }
    for (const t of texts) {
      const url = extractRawUrlFromJson(t) ?? extractAnyUrl(t);
      if (url) return url;
    }
  }

  const dump = blocks
    .map((b) => {
      if (b.type === "text") return `text: ${(b.text ?? "").slice(0, 200)}`;
      if (b.type === "mcp_tool_result") {
        const c = b.content;
        const flat = typeof c === "string" ? c : JSON.stringify(c);
        return `mcp_tool_result: ${flat.slice(0, 300)}`;
      }
      return b.type;
    })
    .join(" | ");
  throw new Error(`Higgsfield response did not include an image URL. Blocks: ${dump}`);
}

function extractRawUrlFromJson(s: string): string | null {
  try {
    const obj = JSON.parse(s);
    const candidates = [
      obj?.generation?.results?.rawUrl,
      obj?.generation?.results?.minUrl,
      obj?.generation?.results?.url,
      obj?.results?.[0]?.rawUrl,
      obj?.results?.[0]?.minUrl,
      obj?.results?.[0]?.url,
      obj?.url,
      obj?.image_url,
      obj?.imageUrl,
    ];
    for (const c of candidates) {
      if (typeof c === "string" && /^https?:\/\//.test(c)) return c;
    }
  } catch {
    /* not JSON */
  }
  return null;
}

function extractAnyUrl(s: string): string | null {
  const match = s.match(/https?:\/\/[^\s"'<>]+/i);
  return match ? match[0] : null;
}
