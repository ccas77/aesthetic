import { put, list } from "@vercel/blob";

// System-level pool of fallback stills shared across all books.
// Stored at system/filler.json (an index of metadata) with the actual
// image bytes at system/filler/{id}.{ext}. On first read, if the index
// doesn't yet exist, we auto-seed it from any legacy library/*.jpg
// blobs (the pre-books bank) so those generated images aren't lost.

export interface FillerStill {
  id: string;
  label: string;
  url: string;
  prompt?: string;
  createdAt: string;
}

interface FillerIndex {
  stills: FillerStill[];
}

const INDEX_PATH = "system/filler.json";

async function findIndexUrl(): Promise<string | null> {
  const { blobs } = await list({ prefix: INDEX_PATH, limit: 1 });
  const exact = blobs.find((b) => b.pathname === INDEX_PATH);
  return exact?.url ?? null;
}

async function seedFromLegacyLibrary(): Promise<FillerStill[]> {
  try {
    const { blobs } = await list({ prefix: "library/", limit: 100 });
    const stills: FillerStill[] = [];
    for (const b of blobs) {
      const m = b.pathname.match(/^library\/([^/.]+)\.[^/.]+$/);
      if (!m) continue;
      const id = m[1];
      stills.push({
        id,
        label: id.replace(/[-_]/g, " "),
        url: b.url,
        createdAt: new Date().toISOString(),
      });
    }
    return stills;
  } catch {
    return [];
  }
}

export async function readFiller(): Promise<FillerStill[]> {
  const url = await findIndexUrl();
  if (url) {
    const res = await fetch(url, { cache: "no-store" });
    if (res.ok) {
      try {
        const data = (await res.json()) as FillerIndex;
        return Array.isArray(data.stills) ? data.stills : [];
      } catch {
        return [];
      }
    }
  }
  // Auto-seed from legacy library/* on first read.
  const seeded = await seedFromLegacyLibrary();
  if (seeded.length > 0) {
    await writeFiller(seeded);
  }
  return seeded;
}

export async function writeFiller(stills: FillerStill[]): Promise<void> {
  await put(INDEX_PATH, JSON.stringify({ stills }, null, 2), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}
