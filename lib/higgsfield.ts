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

  // We use a tight system prompt that forces tool use rather than commentary.
  // The mcp_servers field is a beta feature; route through client.beta.messages
  // and pass the mcp-client beta flag so Anthropic accepts the parameter.
  const response = await client.beta.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 2048,
    betas: ["mcp-client-2025-04-04"],
    mcp_servers: [
      mcpServer as unknown as Anthropic.Beta.BetaRequestMCPServerURLDefinition,
    ],
    system:
      "Use the Higgsfield generate_image tool to produce exactly one image. " +
      `Always set aspect_ratio to "${aspect}". Use the nano_banana_pro model. ` +
      "Return only the tool result, no commentary.",
    messages: [
      {
        role: "user",
        content: `Generate this image with aspect_ratio="${aspect}" using nano_banana_pro:\n\n${opts.prompt}`,
      },
    ],
  });

  // Walk the response content blocks looking for the image URL in any
  // mcp_tool_result.
  type ContentBlock = { type: string; content?: unknown; text?: string };
  const blocks = (response.content as unknown as ContentBlock[]) || [];
  for (const block of blocks) {
    if (block.type !== "mcp_tool_result") continue;
    const inner = block.content;
    if (typeof inner === "string") {
      const url = extractImageUrl(inner);
      if (url) return url;
    } else if (Array.isArray(inner)) {
      for (const item of inner as Array<{ type?: string; text?: string }>) {
        if (item?.text) {
          const url = extractImageUrl(item.text);
          if (url) return url;
        }
      }
    }
  }

  // Fallback: scan ALL text blocks for an image URL (some MCP servers reply via text).
  for (const block of blocks) {
    if (block.type === "text" && block.text) {
      const url = extractImageUrl(block.text);
      if (url) return url;
    }
  }

  throw new Error(
    "Higgsfield response did not include an image URL. " +
      `Response had ${blocks.length} blocks: ${blocks.map((b) => b.type).join(", ")}`,
  );
}

function extractImageUrl(s: string): string | null {
  // Try JSON parse first — Higgsfield typically returns a structured payload.
  try {
    const obj = JSON.parse(s);
    const candidates = [
      obj?.url,
      obj?.image_url,
      obj?.result?.url,
      obj?.results?.[0]?.url,
      obj?.results?.[0]?.image_url,
      obj?.media?.[0]?.url,
      obj?.output?.[0]?.url,
    ];
    for (const c of candidates) {
      if (typeof c === "string" && /^https?:\/\/\S+\.(png|jpe?g|webp)/i.test(c)) return c;
    }
  } catch {
    /* not JSON */
  }
  // Fall back to a regex over the raw string.
  const match = s.match(/https?:\/\/\S+\.(?:png|jpe?g|webp)\S*/i);
  return match ? match[0] : null;
}
