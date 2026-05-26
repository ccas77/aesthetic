import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { list } from "@vercel/blob";
import { findBook } from "@/lib/books-store";
import { readFiller } from "@/lib/filler-store";
import { renderServer, type StillRef } from "@/lib/render-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Vercel Pro is required for >60s. A 15s render with a few Higgsfield-served
// stills typically fits in 30-90s.
export const maxDuration = 300;

// POST /api/render { bookId, quoteId, songId, pinnedFirstStillIds? }
// Synchronous renderer. Phase 0 calls it directly; Phase 2 will move it
// behind a queue + cron worker but the contract stays the same.
export async function POST(req: Request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "BLOB_READ_WRITE_TOKEN not set" },
      { status: 503 },
    );
  }

  let body: {
    bookId?: string;
    quoteId?: string;
    songId?: string;
    pinnedFirstStillIds?: string[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const { bookId, quoteId, songId } = body;
  if (!bookId || !quoteId || !songId) {
    return NextResponse.json(
      { error: "bookId, quoteId, songId required" },
      { status: 400 },
    );
  }

  const book = await findBook(bookId);
  if (!book) {
    return NextResponse.json({ error: "book not found" }, { status: 404 });
  }
  const quote = (book.quotes ?? []).find((q) => q.id === quoteId);
  if (!quote) {
    return NextResponse.json({ error: "quote not found" }, { status: 404 });
  }
  const song = (book.songs ?? []).find((s) => s.id === songId);
  if (!song) {
    return NextResponse.json({ error: "song not found" }, { status: 404 });
  }

  // Build the available stills pool: this book's category stills + the
  // shared filler pool. Phase 3 will add opt-in filtering on filler.
  const { blobs } = await list({
    prefix: `books/${bookId}/library/`,
    limit: 200,
  });
  const bookStills: StillRef[] = book.categories
    .map((c) => {
      const blob = blobs.find((b) =>
        b.pathname.startsWith(`books/${bookId}/library/${c.id}.`),
      );
      return blob ? { id: c.id, url: blob.url } : null;
    })
    .filter((s): s is StillRef => s !== null);

  const filler = await readFiller();
  const fillerStills: StillRef[] = filler.map((f) => ({
    id: `filler:${f.id}`,
    url: f.url,
  }));

  const stills = [...bookStills, ...fillerStills];
  if (stills.length === 0) {
    return NextResponse.json(
      { error: "no stills available for this book" },
      { status: 400 },
    );
  }

  const renderId = randomUUID();
  const outputKey = `books/${bookId}/renders/${renderId}.mp4`;

  try {
    const result = await renderServer({
      audioUrl: song.url,
      bpm: song.bpm ?? 80,
      quote: quote.text,
      stills,
      outputKey,
      pinnedFirstStillIds: body.pinnedFirstStillIds,
    });
    return NextResponse.json({
      ok: true,
      renderId,
      bookId,
      quoteId,
      songId,
      ...result,
    });
  } catch (e) {
    console.error("render failed", e);
    return NextResponse.json(
      { error: (e as Error).message, bookId, quoteId, songId },
      { status: 500 },
    );
  }
}
