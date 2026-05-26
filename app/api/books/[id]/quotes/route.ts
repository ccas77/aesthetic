import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { readBooks, upsertBook, type Quote } from "@/lib/books-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// POST /api/books/[id]/quotes
// Body: { text: "..." }  OR  { texts: ["...", "..."] }  OR  { quotes: [{ text }] }
// Bulk paste from the UI splits a textarea into rows and posts them as
// `texts`. A single add posts `text`. Returns the updated book and the
// list of newly-added quotes.
export async function POST(req: Request, { params }: RouteParams) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "BLOB_READ_WRITE_TOKEN not set" },
      { status: 503 },
    );
  }
  const { id } = await params;
  let body: { text?: unknown; texts?: unknown; quotes?: unknown };
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
  if (Array.isArray(body.quotes)) {
    for (const q of body.quotes) {
      if (q && typeof q === "object") {
        const t = (q as { text?: unknown }).text;
        if (typeof t === "string" && t.trim()) incomingTexts.push(t.trim());
      }
    }
  }
  if (incomingTexts.length === 0) {
    return NextResponse.json(
      { error: "no valid quote text provided" },
      { status: 400 },
    );
  }

  const added: Quote[] = incomingTexts.map((text) => ({
    id: randomUUID(),
    text,
    createdAt: new Date().toISOString(),
  }));
  book.quotes = [...(book.quotes ?? []), ...added];
  await upsertBook(book);
  return NextResponse.json({ book, added });
}
