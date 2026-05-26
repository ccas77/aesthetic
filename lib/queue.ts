import { put, list } from "@vercel/blob";

// Blob-backed render queue. The brief calls for Upstash Redis (matching
// the slideshow-creator pattern); we use Blob for now because Upstash
// requires a separate marketplace install + billing relationship that
// the user hasn't authorized yet. The interface below is intentionally
// narrow so we can drop in Upstash later by swapping the underlying
// read/write without touching callers.

export interface QueueJob {
  id: string;
  bookId: string;
  quoteId: string;
  songId: string;
  requestedAt: string;
  attempts: number;
}

interface QueueState {
  jobs: QueueJob[];
}

const QUEUE_PATH = "system/queue.json";

async function findUrl(): Promise<string | null> {
  const { blobs } = await list({ prefix: QUEUE_PATH, limit: 1 });
  const exact = blobs.find((b) => b.pathname === QUEUE_PATH);
  return exact?.url ?? null;
}

export async function readQueue(): Promise<QueueJob[]> {
  const url = await findUrl();
  if (!url) return [];
  const res = await fetch(`${url}?_=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) return [];
  try {
    const data = (await res.json()) as QueueState;
    return Array.isArray(data.jobs) ? data.jobs : [];
  } catch {
    return [];
  }
}

export async function writeQueue(jobs: QueueJob[]): Promise<void> {
  await put(QUEUE_PATH, JSON.stringify({ jobs }, null, 2), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0,
  });
}

export async function enqueueJobs(jobs: QueueJob[]): Promise<QueueJob[]> {
  const existing = await readQueue();
  const next = [...existing, ...jobs];
  await writeQueue(next);
  return next;
}

// Pops the front job and returns it. If the queue is empty, returns null.
// Read-modify-write; the Blob CDN cache-bust on reads keeps consecutive
// drains consistent at the single-tenant scale we operate at.
export async function dequeueJob(): Promise<QueueJob | null> {
  const jobs = await readQueue();
  if (jobs.length === 0) return null;
  const [head, ...rest] = jobs;
  await writeQueue(rest);
  return head;
}

export async function queueSize(): Promise<number> {
  return (await readQueue()).length;
}
