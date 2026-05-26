import { list } from "@vercel/blob";
import type { Book, Quote, Song } from "./books-store";
import { readFiller } from "./filler-store";
import { readManifest, pairKey } from "./renders-manifest";
import type { StillRef } from "./render-server";

// Planner: given a book + its accumulated render history, pick the next
// (quote, song) pair via round-robin and reserve the first two slots
// of the still pool for atmospheric images this book has never used.

export interface PlannedRender {
  quote: Quote;
  song: Song;
  stills: StillRef[];
  pinnedFirstStillIds: string[];
}

export interface PairChoice {
  quote: Quote;
  song: Song;
}

// Returns up to `count` (quote, song) pairs in round-robin order.
// Pairs already rendered for this book are skipped first; only once
// every possible pair has been used do we start cycling through again.
export async function pickNextPairs(
  book: Book,
  count: number,
  alreadyQueued: Set<string> = new Set(),
): Promise<PairChoice[]> {
  const quotes = sortStable(book.quotes ?? []);
  const songs = sortStable(book.songs ?? []);
  if (quotes.length === 0 || songs.length === 0) return [];

  const used = new Set<string>();
  const manifest = await readManifest(book.id);
  for (const r of manifest) used.add(pairKey(r.quoteId, r.songId));

  // Stable enumeration of every (quote, song) pair: quotes outer, songs
  // inner. Round-robin advances through this list; once we run out of
  // unused pairs we start over and re-allow previously rendered ones.
  const all: PairChoice[] = [];
  for (const q of quotes) {
    for (const s of songs) {
      all.push({ quote: q, song: s });
    }
  }

  const result: PairChoice[] = [];
  let pass = 0;
  while (result.length < count && pass < 2) {
    for (const p of all) {
      if (result.length >= count) break;
      const key = pairKey(p.quote.id, p.song.id);
      if (pass === 0 && (used.has(key) || alreadyQueued.has(key))) continue;
      if (alreadyQueued.has(key)) continue; // never queue the same pair twice in one call
      result.push(p);
      alreadyQueued.add(key);
    }
    pass += 1;
  }
  return result;
}

// Build the stills pool for a render: this book's category stills first,
// then the shared filler pool. Returns also the set of still IDs the
// book has never previously included in a render, ordered so we can
// pin two of them into the first two shot slots.
export async function buildStillsPool(book: Book): Promise<{
  pool: StillRef[];
  freshIds: string[];
}> {
  const { blobs } = await list({
    prefix: `books/${book.id}/library/`,
    limit: 200,
  });
  const categoryStills: StillRef[] = book.categories
    .map((c) => {
      const blob = blobs.find((b) =>
        b.pathname.startsWith(`books/${book.id}/library/${c.id}.`),
      );
      return blob ? { id: c.id, url: blob.url } : null;
    })
    .filter((s): s is StillRef => s !== null);

  const filler = await readFiller();
  const fillerStills: StillRef[] = filler.map((f) => ({
    id: `filler:${f.id}`,
    url: f.url,
  }));
  const pool = [...categoryStills, ...fillerStills];

  const seenIds = new Set<string>();
  const manifest = await readManifest(book.id);
  for (const r of manifest) for (const id of r.stillIds) seenIds.add(id);
  const freshIds = pool.map((s) => s.id).filter((id) => !seenIds.has(id));
  return { pool, freshIds };
}

// Pick which two stills to pin into the first two slots of the render.
// "Fresh" means never used in any prior render for this book.
export function pickPinnedFirstStillIds(freshIds: string[]): string[] {
  return freshIds.slice(0, 2);
}

function sortStable<T extends { createdAt: string }>(xs: T[]): T[] {
  return [...xs].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
