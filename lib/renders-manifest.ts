import { put, list } from "@vercel/blob";

// Per-book renders manifest. One JSON file per book at
// books/{bookId}/renders.json that lists every render produced for the
// book, with the (quoteId, songId, stillIds) used and the resulting
// Blob URL. Phase 3's dedup logic reads this to decide which pairs to
// skip in round-robin and which stills are "fresh" (never used).

export interface RenderEntry {
  renderId: string;
  bookId: string;
  quoteId: string;
  songId: string;
  stillIds: string[];
  blobUrl: string;
  durationSec: number;
  shotCount: number;
  createdAt: string;
  postedAt?: string;
  postBridgeIds?: string[];
}

interface ManifestState {
  renders: RenderEntry[];
}

function manifestPath(bookId: string): string {
  return `books/${bookId}/renders.json`;
}

async function findUrl(bookId: string): Promise<string | null> {
  const p = manifestPath(bookId);
  const { blobs } = await list({ prefix: p, limit: 1 });
  const exact = blobs.find((b) => b.pathname === p);
  return exact?.url ?? null;
}

export async function readManifest(bookId: string): Promise<RenderEntry[]> {
  const url = await findUrl(bookId);
  if (!url) return [];
  const res = await fetch(`${url}?_=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) return [];
  try {
    const data = (await res.json()) as ManifestState;
    return Array.isArray(data.renders) ? data.renders : [];
  } catch {
    return [];
  }
}

export async function writeManifest(
  bookId: string,
  renders: RenderEntry[],
): Promise<void> {
  await put(manifestPath(bookId), JSON.stringify({ renders }, null, 2), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0,
  });
}

export async function appendRender(
  bookId: string,
  entry: RenderEntry,
): Promise<void> {
  const renders = await readManifest(bookId);
  renders.push(entry);
  await writeManifest(bookId, renders);
}

export async function updateRender(
  bookId: string,
  renderId: string,
  patch: Partial<RenderEntry>,
): Promise<RenderEntry | null> {
  const renders = await readManifest(bookId);
  const idx = renders.findIndex((r) => r.renderId === renderId);
  if (idx === -1) return null;
  renders[idx] = { ...renders[idx], ...patch };
  await writeManifest(bookId, renders);
  return renders[idx];
}

export function pairKey(quoteId: string, songId: string): string {
  return `${quoteId}::${songId}`;
}
