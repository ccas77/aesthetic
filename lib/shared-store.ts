import { put, list } from "@vercel/blob";

// System-level pool of shared (formerly "filler") stills. Available to
// every book at render time. Stored at system/shared.json with image
// bytes at system/shared/{id}.{ext}. On first read, falls back to the
// legacy system/filler.json index from before the rename; if neither
// exists, seeds from any legacy library/*.jpg blobs (the pre-books
// bank) so previously generated images aren't lost.

export interface SharedStill {
  id: string;
  label: string;
  url: string;
  prompt?: string;
  createdAt: string;
}

// Back-compat alias for any callers still importing FillerStill.
export type FillerStill = SharedStill;

interface SharedIndex {
  stills: SharedStill[];
}

const INDEX_PATH = "system/shared.json";
const LEGACY_FILLER_INDEX = "system/filler.json";

async function findIndexUrl(path: string): Promise<string | null> {
  const { blobs } = await list({ prefix: path, limit: 1 });
  const exact = blobs.find((b) => b.pathname === path);
  return exact?.url ?? null;
}

async function fetchIndex(url: string): Promise<SharedStill[] | null> {
  const res = await fetch(`${url}?_=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) return null;
  try {
    const data = (await res.json()) as SharedIndex;
    return Array.isArray(data.stills) ? data.stills : [];
  } catch {
    return null;
  }
}

async function seedFromLegacyLibrary(): Promise<SharedStill[]> {
  try {
    const { blobs } = await list({ prefix: "library/", limit: 100 });
    const stills: SharedStill[] = [];
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

export async function readShared(): Promise<SharedStill[]> {
  const primaryUrl = await findIndexUrl(INDEX_PATH);
  if (primaryUrl) {
    const stills = await fetchIndex(primaryUrl);
    if (stills) return stills;
  }
  // Migrate from the legacy filler index: read it, copy to the new
  // path, then return.
  const legacyUrl = await findIndexUrl(LEGACY_FILLER_INDEX);
  if (legacyUrl) {
    const stills = await fetchIndex(legacyUrl);
    if (stills) {
      if (stills.length > 0) await writeShared(stills);
      return stills;
    }
  }
  // Cold seed from the pre-books library/* bank.
  const seeded = await seedFromLegacyLibrary();
  if (seeded.length > 0) await writeShared(seeded);
  return seeded;
}

export async function writeShared(stills: SharedStill[]): Promise<void> {
  await put(INDEX_PATH, JSON.stringify({ stills }, null, 2), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0,
  });
}

// Back-compat function aliases.
export const readFiller = readShared;
export const writeFiller = writeShared;
