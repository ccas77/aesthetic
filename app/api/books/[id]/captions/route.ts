import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { readBooks, upsertBook, type Caption } from "@/lib/books-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// POST /api/books/[id]/captions
// Body: { text } | { texts: [...] } | { captions: [{ text }, ...] }
// Also accepts the legacy `quotes` array key. Bulk paste splits a
// textarea by blank lines client-side and posts as `texts`.
export async function POST(req: Request, { params }: RouteParams) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "BLOB_READ_WRITE_TOKEN not set" },
      { status: 503 },
    );
  }
  const { id } = await params;
  let body: {
    text?: unknown;
    texts?: unknown;
    captions?: unknown;
    quotes?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const books = await readBooks();
  const book = books.find((b) => b.id === id);
  if (!book) {
    return NextResponse.json({ error: "book not found" }, { status: 404 });
  }

  const incomingTexts: string[] = [];
  if (typeof body.text === "string" && body.text.trim()) {
    incomingTexts.push(body.text.trim());
  }
  if (Array.isArray(body.texts)) {
    for (const t of body.texts) {
      if (typeof t === "string" && t.trim()) incomingTexts.push(t.trim());
    }
  }
  const arr = Array.isArray(body.captions) ? body.captions : body.quotes;
  if (Array.isArray(arr)) {
    for (const item of arr) {
      if (item && typeof item === "object") {
        const t = (item as { text?: unknown }).text;
        if (typeof t === "string" && t.trim()) incomingTexts.push(t.trim());
      }
    }
  }
  if (incomingTexts.length === 0) {
    return NextResponse.json(
      { error: "no valid caption text provided" },
      { status: 400 },
    );
  }

  const added: Caption[] = incomingTexts.map((text) => ({
    id: randomUUID(),
    text,
    createdAt: new Date().toISOString(),
  }));
  book.captions = [...(book.captions ?? []), ...added];
  await upsertBook(book);
  return NextResponse.json({ book, added });
}
