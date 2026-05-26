import { put, list } from "@vercel/blob";

// Books index, single JSON file in Blob. Single-tenant for the app's
// owner. Each book carries its own categories; per-book stills live at
// books/{bookId}/library/{categoryId}.jpg.

export interface BookCategory {
  id: string;
  label: string;
  prompt: string;
}

export interface Caption {
  id: string;
  text: string;
  createdAt: string;
}

// Legacy alias. Older code referred to these as "quotes"; the data
// shape is identical and stored books may carry a `quotes` field that
// we transparently migrate to `captions` on read (see normalizeBook).
export type Quote = Caption;

export interface Song {
  id: string;
  title: string;
  url: string;
  // Optional metadata. durationSec lets us pick a bpm-appropriate cut
  // density without re-probing every render; bpm lets the renderer
  // skip detection entirely once we've measured it once.
  durationSec?: number;
  bpm?: number;
  createdAt: string;
}

export interface Book {
  id: string;
  title: string;
  coverUrl: string;
  // Optional per-book aesthetic brief. Prepended to every category's
  // subject prompt at generation time so each book carries its own
  // visual style without baking style into individual category prompts.
  stylePrompt?: string;
  categories: BookCategory[];
  captions?: Caption[];
  // Deprecated; older books wrote here. normalizeBook() folds them
  // into captions on read.
  quotes?: Caption[];
  songs?: Song[];
  // PostBridge social account IDs to publish this book's renders to.
  // Empty / undefined means no auto-posting even if global autopost
  // is enabled.
  postAccountIds?: number[];
  // Optional caption suffix appended to the quote text on publish
  // (e.g. "#booktok #darkromance @cordelia"). The quote text itself
  // is the body of every caption.
  captionSuffix?: string;
  createdAt: string;
}

interface BooksIndex {
  books: Book[];
}

const INDEX_PATH = "books/index.json";

async function findIndexUrl(): Promise<string | null> {
  const { blobs } = await list({ prefix: INDEX_PATH, limit: 1 });
  const exact = blobs.find((b) => b.pathname === INDEX_PATH);
  return exact?.url ?? null;
}

export async function readBooks(): Promise<Book[]> {
  const url = await findIndexUrl();
  if (!url) return [];
  // Bust any Blob CDN cache: each read uses a unique URL so we never
  // get stale data inside a read-modify-write cycle.
  const res = await fetch(`${url}?_=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) return [];
  try {
    const data = (await res.json()) as BooksIndex;
    if (!Array.isArray(data.books)) return [];
    return data.books.map(normalizeBook);
  } catch {
    return [];
  }
}

function normalizeBook(b: Book): Book {
  // Fold the deprecated `quotes` field into `captions` on read so the
  // rest of the codebase only sees the new name. The next write
  // (upsertBook) drops the old field.
  if (b.quotes && b.quotes.length > 0) {
    const existing = b.captions ?? [];
    const have = new Set(existing.map((c) => c.id));
    const merged = [...existing];
    for (const q of b.quotes) {
      if (!have.has(q.id)) merged.push(q);
    }
    return { ...b, captions: merged, quotes: undefined };
  }
  return b;
}

export async function writeBooks(books: Book[]): Promise<void> {
  await put(INDEX_PATH, JSON.stringify({ books }, null, 2), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    // Mutable metadata file; never let the Blob CDN serve a stale copy
    // or the read-modify-write cycle silently loses subsequent writes.
    cacheControlMaxAge: 0,
  });
}

export async function findBook(id: string): Promise<Book | undefined> {
  const books = await readBooks();
  return books.find((b) => b.id === id);
}

export async function upsertBook(updated: Book): Promise<void> {
  const books = await readBooks();
  const idx = books.findIndex((b) => b.id === updated.id);
  if (idx === -1) books.push(updated);
  else books[idx] = updated;
  await writeBooks(books);
}

export async function removeBook(id: string): Promise<boolean> {
  const books = await readBooks();
  const next = books.filter((b) => b.id !== id);
  if (next.length === books.length) return false;
  await writeBooks(next);
  return true;
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

export function uniqueId(base: string, taken: Set<string>): string {
  let candidate = base || `item-${Date.now()}`;
  let n = 1;
  while (taken.has(candidate)) {
    n += 1;
    candidate = `${base}-${n}`;
  }
  return candidate;
}
