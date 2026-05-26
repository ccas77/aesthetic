// Generates a single still on Higgsfield's unlimited-mode API. The call
// path is now Clerk JWT → POST /jobs/{model} with use_unlim:true → poll
// /jobs/{id} → extract URL. No MCP, no Anthropic SDK; the user's plan
// entitles them to unlimited Nano Banana, so this path doesn't deduct
// from the monthly credit pool.
//
// Caller signature is unchanged from the previous MCP-based version, so
// every site that called generateStillViaHiggsfield() keeps working.

import {
  submitJob,
  pollJob,
  extractImageUrl,
  resolveAspectDimensions,
} from "./higgsfield-jobs";

interface GenerateOptions {
  prompt: string;
  aspectRatio?: string;
  model?: string;
}

// Total time budget for one generation: clerk + submit + polling. The
// API route's maxDuration caps the outer wall clock; this is just the
// poll loop's deadline.
const GENERATION_TIMEOUT_MS = 150_000; // 2.5 min

export async function generateStillViaHiggsfield(
  opts: GenerateOptions,
): Promise<string> {
  const aspect = opts.aspectRatio || "2:3";
  const model =
    opts.model ||
    (process.env.HIGGSFIELD_DEFAULT_MODEL ?? "nano-banana-2").trim() ||
    "nano-banana-2";
  const { width, height } = resolveAspectDimensions(aspect);

  const jobId = await submitJob({
    model,
    params: {
      prompt: opts.prompt,
      input_images: [],
      width,
      height,
      batch_size: 1,
      aspect_ratio: aspect,
      is_storyboard: false,
      is_zoom_control: false,
      resolution: "2k",
    },
  });

  const job = await pollJob(jobId, GENERATION_TIMEOUT_MS);
  const url = extractImageUrl(job);
  if (!url) {
    throw new Error(
      `Higgsfield job ${jobId} completed but no image URL in payload: ` +
        JSON.stringify(job).slice(0, 400),
    );
  }
  return url;
}
