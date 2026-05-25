import { put, list } from "@vercel/blob";

// Books index, single JSON file in Blob. Single-tenant for the app's
// owner. Each book carries its own categories; per-book stills live at
// books/{bookId}/library/{categoryId}.jpg.

export interface BookCategory {
  id: string;
  label: string;
  prompt: string;
}

export interface Book {
  id: string;
  title: string;
  coverUrl: string;
  categories: BookCategory[];
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
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return [];
  try {
    const data = (await res.json()) as BooksIndex;
    return Array.isArray(data.books) ? data.books : [];
  } catch {
    return [];
  }
}

export async function writeBooks(books: Book[]): Promise<void> {
  await put(INDEX_PATH, JSON.stringify({ books }, null, 2), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
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
