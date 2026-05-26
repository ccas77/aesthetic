// Direct client for Higgsfield's web-app generation API (the path that
// the official MCP doesn't expose). use_unlim:true at both the params
// and top level unlocks unlimited mode on the user's plan. Endpoints
// and shapes were verified against cgl-higgsfield's source.

import { getJwt, invalidateJwt } from "./higgsfield-clerk";

const API_BASE = "https://fnf.higgsfield.ai";

const POLL_INITIAL_MS = 3000;
const POLL_MAX_MS = 15000;
const POLL_STEP_MS = 2000;

// 2:3 portrait fits the existing aesthetic renderer (1080x1920 output
// with center crop). cgl-higgsfield's table:
//   "9:16": (768, 1376), "2:3": (832, 1248), "1:1": (1024, 1024), ...
const ASPECT_DIMENSIONS: Record<string, [number, number]> = {
  "9:16": [768, 1376],
  "16:9": [1376, 768],
  "1:1": [1024, 1024],
  "4:5": [896, 1120],
  "5:4": [1120, 896],
  "2:3": [832, 1248],
  "3:2": [1248, 832],
  "21:9": [1680, 720],
  "4:3": [1152, 864],
  "3:4": [864, 1152],
};

export function resolveAspectDimensions(
  aspect: string,
): { width: number; height: number } {
  const found = ASPECT_DIMENSIONS[aspect];
  if (!found) {
    throw new Error(
      `unknown aspect_ratio ${JSON.stringify(aspect)}. Known: ${Object.keys(ASPECT_DIMENSIONS).join(", ")}`,
    );
  }
  return { width: found[0], height: found[1] };
}

// ─── HTTP layer with single 401 retry ───

interface RequestOpts {
  method: "GET" | "POST" | "DELETE";
  path: string;
  body?: unknown;
  query?: Record<string, string | number | boolean>;
}

async function request<T = unknown>(opts: RequestOpts): Promise<T> {
  const doOnce = async (jwt: string): Promise<Response> => {
    const url = new URL(`${API_BASE}${opts.path}`);
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) {
        url.searchParams.set(k, String(v));
      }
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${jwt}`,
      Origin: "https://higgsfield.ai",
      Referer: "https://higgsfield.ai/",
      Accept: "application/json",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    };
    const init: RequestInit = {
      method: opts.method,
      headers,
    };
    if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(opts.body);
    }
    return fetch(url.toString(), init);
  };

  let jwt = await getJwt();
  let resp = await doOnce(jwt);
  if (resp.status === 401) {
    invalidateJwt();
    jwt = await getJwt(true);
    resp = await doOnce(jwt);
  }
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(
      `Higgsfield ${opts.method} ${opts.path} -> HTTP ${resp.status}: ${body.slice(0, 400)}`,
    );
  }
  const ct = resp.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    return (await resp.json()) as T;
  }
  return (await resp.text()) as unknown as T;
}

// ─── job submit ───

interface SubmitOpts {
  model: string;
  params: Record<string, unknown>;
  topLevel?: Record<string, unknown>;
}

interface SubmitResponse {
  id?: string;
  job_id?: string;
  job_sets?: Array<{
    id?: string;
    jobs?: Array<{ id?: string }>;
  }>;
}

export async function submitJob(opts: SubmitOpts): Promise<string> {
  const bodyParams: Record<string, unknown> = {
    ...opts.params,
    use_unlim: true,
  };
  const body: Record<string, unknown> = {
    params: bodyParams,
    use_unlim: true,
    use_seedream_bonus: false,
    ...(opts.topLevel ?? {}),
  };

  const data = await request<SubmitResponse>({
    method: "POST",
    path: `/jobs/${opts.model}`,
    body,
  });

  // Verified shape: { id: <project_id>, job_sets: [{ id, jobs: [{ id, ... }] }] }
  // We need the inner job id; project/job-set ids 404 on /jobs/{id}.
  const inner = data.job_sets?.[0]?.jobs?.[0]?.id;
  const jobId = inner ?? data.job_id ?? data.id;
  if (!jobId) {
    throw new Error(`Higgsfield submit response had no job id: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return jobId;
}

// ─── poll ───

interface JobRecord {
  status?: string;
  results?: unknown;
  [key: string]: unknown;
}

export async function getJob(jobId: string): Promise<JobRecord> {
  return request<JobRecord>({ method: "GET", path: `/jobs/${jobId}` });
}

export async function pollJob(
  jobId: string,
  timeoutMs: number,
): Promise<JobRecord> {
  const start = Date.now();
  let interval = POLL_INITIAL_MS;
  while (Date.now() - start < timeoutMs) {
    const data = await getJob(jobId);
    const status = typeof data.status === "string" ? data.status : "unknown";
    if (status === "completed" || status === "succeeded") return data;
    if (
      status === "failed" ||
      status === "error" ||
      status === "cancelled" ||
      status === "canceled"
    ) {
      throw new Error(`Higgsfield job ${jobId} ended ${status}: ${JSON.stringify(data).slice(0, 300)}`);
    }
    await new Promise((r) => setTimeout(r, interval));
    interval = Math.min(interval + POLL_STEP_MS, POLL_MAX_MS);
  }
  throw new Error(`Higgsfield job ${jobId} did not finish in ${Math.round(timeoutMs / 1000)}s`);
}

// ─── extract URL ───

// cgl-higgsfield (verified live) for nano-banana-2:
//   { "results": { "raw": { "type": "image", "url": "https://..." } } }
// Plus several legacy/alternate shapes we handle defensively.
export function extractImageUrl(job: JobRecord): string | null {
  const candidates: unknown[] = [];

  const r = job.results;
  if (isRecord(r)) {
    const raw = r.raw;
    if (isRecord(raw)) candidates.push(raw.url, raw.rawUrl);
    candidates.push(r.url, r.rawUrl, r.minUrl, r.image_url, r.imageUrl);
    const items = r.items;
    if (Array.isArray(items)) {
      for (const it of items) {
        if (isRecord(it)) candidates.push(it.url, it.rawUrl);
      }
    }
  } else if (Array.isArray(r)) {
    for (const it of r) {
      if (isRecord(it)) candidates.push(it.url, it.rawUrl);
      else if (typeof it === "string") candidates.push(it);
    }
  }
  const gen = isRecord(job.generation) ? job.generation : undefined;
  if (gen) {
    const gr = gen.results;
    if (isRecord(gr)) {
      candidates.push(gr.rawUrl, gr.url, gr.minUrl);
      const wraps = gr.raw;
      if (isRecord(wraps)) candidates.push(wraps.url, wraps.rawUrl);
    }
    candidates.push(gen.url, gen.image_url, gen.imageUrl);
  }
  candidates.push(job.url, job.output_url, job.image_url);

  for (const c of candidates) {
    if (typeof c === "string" && /^https?:\/\//.test(c)) return c;
  }
  return null;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === "object" && !Array.isArray(x);
}
