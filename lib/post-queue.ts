import { put, list } from "@vercel/blob";

// Post queue. Holds scheduled and pending social-media posts created
// from the Create page's "Post now" and "Schedule" buttons. Cron
// /api/cron/post drains entries whose scheduledFor is in the past.

export interface PostQueueEntry {
  id: string;
  renderId: string;
  bookId: string;
  // Target social-account IDs the post should publish to. Created
  // from the user's account picks on the Create page.
  accountIds: number[];
  // ISO8601. For "Post now" the createdAt and scheduledFor match;
  // for "Schedule" scheduledFor is a future time.
  scheduledFor: string;
  status: "scheduled" | "posted" | "failed" | "cancelled";
  caption: string;
  // Set when status transitions to posted.
  postedAt?: string;
  postBridgePostIds?: string[];
  // Set when status transitions to failed.
  lastError?: string;
  attempts: number;
  createdAt: string;
}

interface PostQueueState {
  entries: PostQueueEntry[];
}

const PATH = "system/post-queue.json";

async function findUrl(): Promise<string | null> {
  const { blobs } = await list({ prefix: PATH, limit: 1 });
  const exact = blobs.find((b) => b.pathname === PATH);
  return exact?.url ?? null;
}

export async function readPostQueue(): Promise<PostQueueEntry[]> {
  const url = await findUrl();
  if (!url) return [];
  const res = await fetch(`${url}?_=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) return [];
  try {
    const data = (await res.json()) as PostQueueState;
    return Array.isArray(data.entries) ? data.entries : [];
  } catch {
    return [];
  }
}

export async function writePostQueue(
  entries: PostQueueEntry[],
): Promise<void> {
  await put(PATH, JSON.stringify({ entries }, null, 2), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0,
  });
}

export async function appendPostQueue(
  entry: PostQueueEntry,
): Promise<PostQueueEntry[]> {
  const entries = await readPostQueue();
  entries.push(entry);
  await writePostQueue(entries);
  return entries;
}

export async function updatePostQueue(
  id: string,
  patch: Partial<PostQueueEntry>,
): Promise<PostQueueEntry | null> {
  const entries = await readPostQueue();
  const idx = entries.findIndex((e) => e.id === id);
  if (idx === -1) return null;
  entries[idx] = { ...entries[idx], ...patch };
  await writePostQueue(entries);
  return entries[idx];
}

// Pick the oldest entry that's due (scheduledFor <= now) and still
// scheduled. Used by /api/cron/post.
export async function pickDuePost(): Promise<PostQueueEntry | null> {
  const entries = await readPostQueue();
  const now = Date.now();
  const due = entries
    .filter((e) => e.status === "scheduled" && Date.parse(e.scheduledFor) <= now)
    .sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor));
  return due[0] ?? null;
}
