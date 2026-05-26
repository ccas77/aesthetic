import { withMcp, type CallToolResult } from "./mcp-client";

// Generates a single image via the Higgsfield MCP server. Returns the
// URL of the generated image on Higgsfield's CDN.
//
// generate_image is async: it returns a job UUID and the image URL only
// appears later via job_status. We poll job_status with sync=true so the
// MCP server holds each call for up to ~25s and replies on the first
// terminal state, instead of forcing a tight client-side polling loop.

interface GenerateOptions {
  prompt: string;
  aspectRatio?: string;
  model?: string;
}

export async function generateStillViaHiggsfield(
  opts: GenerateOptions,
): Promise<string> {
  const aspect = opts.aspectRatio || "2:3";
  const model = opts.model || "nano_banana_pro";

  return withMcp(async (session) => {
    const genResult = await session.callTool("generate_image", {
      params: { prompt: opts.prompt, model, aspect_ratio: aspect },
    });
    if (genResult.isError) {
      throw new Error(
        `Higgsfield generate_image error: ${describeResult(genResult)}`,
      );
    }
    const jobId = extractJobId(genResult);
    if (!jobId) {
      throw new Error(
        `Higgsfield generate_image returned no job id: ${describeResult(genResult)}`,
      );
    }

    const deadline = Date.now() + 4 * 60_000;
    let lastStatus = "pending";
    while (Date.now() < deadline) {
      const statusResult = await session.callTool("job_status", {
        jobId,
        sync: true,
      });
      if (statusResult.isError) {
        throw new Error(
          `Higgsfield job_status error: ${describeResult(statusResult)}`,
        );
      }
      const { status, imageUrl } = extractStatus(statusResult);
      lastStatus = status;
      if (status === "completed" || status === "succeeded") {
        if (!imageUrl) {
          throw new Error(
            `Higgsfield job ${jobId} completed but URL missing: ${describeResult(statusResult)}`,
          );
        }
        return imageUrl;
      }
      if (status === "failed" || status === "cancelled" || status === "error") {
        throw new Error(
          `Higgsfield job ${jobId} ${status}: ${describeResult(statusResult)}`,
        );
      }
      // Otherwise pending/processing — sync:true already held the call,
      // loop once to issue another long-poll.
    }
    throw new Error(
      `Higgsfield job ${jobId} timed out after 4 min (last status: ${lastStatus})`,
    );
  });
}

function extractJobId(r: CallToolResult): string | undefined {
  const merged = mergeResult(r);
  const firstResult = firstResultRecord(merged);
  return (
    pickString(merged, ["job_id", "jobId", "id"]) ??
    (firstResult ? pickString(firstResult, ["id", "job_id"]) : undefined)
  );
}

function extractStatus(
  r: CallToolResult,
): { status: string; imageUrl?: string } {
  const merged = mergeResult(r);
  const gen =
    (isRecord(merged.generation) ? merged.generation : undefined) ??
    firstResultRecord(merged);
  const status =
    pickString(merged, ["status", "state"]) ??
    (gen ? pickString(gen, ["status", "state"]) : undefined) ??
    "unknown";
  let imageUrl = pickString(merged, ["image_url", "imageUrl", "url"]);
  if (!imageUrl && gen) {
    const results = gen.results;
    if (isRecord(results)) {
      imageUrl = pickString(results, [
        "rawUrl",
        "url",
        "minUrl",
        "image_url",
        "imageUrl",
      ]);
    }
    if (!imageUrl) {
      imageUrl = pickString(gen, ["url", "image_url", "imageUrl"]);
    }
  }
  return { status, imageUrl };
}

function mergeResult(r: CallToolResult): Record<string, unknown> {
  const sc = r.structuredContent ?? {};
  const fromText = parseTextContent(r.content);
  return { ...fromText, ...sc };
}

function parseTextContent(
  content: CallToolResult["content"],
): Record<string, unknown> {
  if (!content) return {};
  for (const c of content) {
    if (c.type === "text" && typeof c.text === "string") {
      try {
        const parsed = JSON.parse(c.text);
        if (isRecord(parsed)) return parsed;
      } catch {
        // not JSON, ignore
      }
    }
  }
  return {};
}

function firstResultRecord(
  obj: Record<string, unknown>,
): Record<string, unknown> | undefined {
  for (const k of ["results", "result", "data", "images"]) {
    const v = obj[k];
    if (Array.isArray(v) && v.length > 0 && isRecord(v[0])) return v[0];
    if (isRecord(v) && !Array.isArray(v)) return v;
  }
  return undefined;
}

function pickString(
  obj: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return undefined;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === "object" && !Array.isArray(x);
}

function describeResult(r: CallToolResult): string {
  const sc = r.structuredContent ? JSON.stringify(r.structuredContent).slice(0, 300) : "";
  const texts = (r.content ?? [])
    .filter((c) => c.type === "text" && c.text)
    .map((c) => c.text!.slice(0, 200))
    .join(" | ");
  return [sc, texts].filter(Boolean).join(" :: ");
}
