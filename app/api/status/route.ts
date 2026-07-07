import { NextResponse } from "next/server";
import { readPostQueue } from "@/lib/post-queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;
const PB_BASE = "https://api.post-bridge.com";
const PB_CHUNK = 20;

type PBPostResult = { post_id?: string; success?: boolean };

class PBError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "PBError";
  }
}

async function pbGet<T>(path: string): Promise<T> {
  const key = process.env.POSTBRIDGE_API_KEY || process.env.POST_BRIDGE_API_KEY;
  if (!key) throw new Error("no PB key");
  const res = await fetch(`${PB_BASE}${path}`, {
    headers: { Authorization: `Bearer ${key}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new PBError(res.status, `PB ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

export async function GET(req: Request) {
  const expected = process.env.CRON_SECRET;
  const provided = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!expected || provided !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const utcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const yStart = utcMidnight - DAY_MS;
  const yEnd = utcMidnight;
  const yDate = new Date(yStart).toISOString().slice(0, 10);

  let queue: Awaited<ReturnType<typeof readPostQueue>> = [];
  let blobReachable = true;
  let blobError: string | null = null;
  try {
    queue = await readPostQueue();
  } catch (e) {
    blobReachable = false;
    blobError = (e as Error).message;
  }

  // Yesterday: any entry whose scheduledFor is in yesterday's UTC window
  // counts as planned. Attempted = those with status posted/failed/cancelled
  // (cron processed them). Confirmed = attempted with postBridgePostIds that
  // Post Bridge shows success for.
  const yesterdayEntries = queue.filter((e) => {
    const t = Date.parse(e.scheduledFor);
    return Number.isFinite(t) && t >= yStart && t < yEnd;
  });
  const planned = yesterdayEntries.length;
  const attemptedEntries = yesterdayEntries.filter(
    (e) => e.status === "posted" || e.status === "failed",
  );
  const attempted = attemptedEntries.length;

  const attemptGap = Math.max(0, planned - attempted);
  let confirmed = 0;
  let confirmGap = 0;
  let ycError: string | null = null;

  const pbIds: string[] = [];
  for (const e of attemptedEntries) {
    for (const id of e.postBridgePostIds || []) pbIds.push(id);
  }
  const uniqPbIds = [...new Set(pbIds)];

  if (uniqPbIds.length > 0) {
    if (!(process.env.POSTBRIDGE_API_KEY || process.env.POST_BRIDGE_API_KEY)) {
      ycError = "no PB key on this app";
    } else {
      try {
        const successById = new Set<string>();
        const chunks: string[][] = [];
        for (let i = 0; i < uniqPbIds.length; i += PB_CHUNK) chunks.push(uniqPbIds.slice(i, i + PB_CHUNK));
        for (const chunk of chunks) {
          const qs = new URLSearchParams({ limit: "100" });
          for (const id of chunk) qs.append("post_id", id);
          const r = await pbGet<{ data?: PBPostResult[] }>(`/v1/post-results?${qs}`);
          for (const row of r.data || []) {
            if (row.post_id && row.success === true) successById.add(row.post_id);
          }
        }
        // Confirmed = an attempted entry where AT LEAST ONE of its
        // postBridgePostIds shows success. That way multi-target posts count
        // as "went live" if any target landed.
        for (const e of attemptedEntries) {
          const ids = e.postBridgePostIds || [];
          if (ids.some((id) => successById.has(id))) confirmed += 1;
        }
        confirmGap = Math.max(0, attempted - confirmed);
      } catch (e) {
        ycError = (e as Error).message;
      }
    }
  }

  const nowMs = now.getTime();
  const posts24hEntries = queue.filter((e) => {
    const t = Date.parse(e.postedAt || e.scheduledFor);
    return e.status === "posted" && Number.isFinite(t) && t >= nowMs - DAY_MS;
  });
  const posts7dEntries = queue.filter((e) => {
    const t = Date.parse(e.postedAt || e.scheduledFor);
    return e.status === "posted" && Number.isFinite(t) && t >= nowMs - 7 * DAY_MS;
  });
  const failingCount = queue.filter(
    (e) => e.status === "failed" && Date.parse(e.scheduledFor) >= nowMs - DAY_MS,
  ).length;

  const lastPostSuccess = queue
    .filter((e) => e.status === "posted" && e.postedAt)
    .map((e) => e.postedAt as string)
    .sort()
    .at(-1) ?? null;

  return NextResponse.json({
    app: {
      name: "aesthetic",
      cron: "*/30 * * * * (render), 15,45 * * * * (post)",
      domain: process.env.VERCEL_PROJECT_PRODUCTION_URL ?? null,
      now: now.toISOString(),
    },
    connections: {
      blob: {
        configured: !!process.env.BLOB_READ_WRITE_TOKEN,
        reachable: blobReachable,
        error: blobReachable ? null : blobError,
      },
      postBridge: {
        configured: !!(process.env.POSTBRIDGE_API_KEY || process.env.POST_BRIDGE_API_KEY),
        lastSuccessAt: lastPostSuccess,
        lastFailureAt: null,
        lastErrorMessage: null,
      },
      higgsfield: {
        configured: !!(process.env.HIGGSFIELD_MCP_URL || process.env.HIGGSFIELD_TOKEN_SECRET),
        lastSuccessAt: null,
      },
    },
    automations: [],
    scheduled: [],
    posts: { recent: [], failing: [] },
    counts: {
      posts24h: posts24hEntries.length,
      posts7d: posts7dEntries.length,
      totalTracked: queue.length,
      automationsEnabled: 0,
      automationsTotal: 0,
      failingCount,
      silentMissCount: 0,
    },
    healthSummary: {
      anySilentMiss: false,
      anyRecentFailure: failingCount > 0,
      kvOk: blobReachable,
    },
    yesterday: {
      date: yDate,
      planned,
      attempted,
      confirmed,
      attemptGap,
      confirmGap,
      error: ycError,
    },
    generatedAt: new Date().toISOString(),
  });
}
