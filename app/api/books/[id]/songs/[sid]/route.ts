import { NextResponse } from "next/server";
import { del, list } from "@vercel/blob";
import { readBooks, upsertBook } from "@/lib/books-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string; sid: string }>;
}

export async function DELETE(_req: Request, { params }: RouteParams) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "BLOB_READ_WRITE_TOKEN not set" },
      { status: 503 },
    );
  }
  const { id, sid } = await params;
  const books = await readBooks();
  const book = books.find((b) => b.id === id);
  if (!book) {
    return NextResponse.json({ error: "book not found" }, { status: 404 });
  }
  const before = (book.songs ?? []).length;
  book.songs = (book.songs ?? []).filter((x) => x.id !== sid);
  if ((book.songs ?? []).length === before) {
    return NextResponse.json({ error: "song not found" }, { status: 404 });
  }
  await upsertBook(book);

  // Best-effort: delete the audio blob.
  try {
    const { blobs } = await list({
      prefix: `books/${id}/songs/${sid}.`,
      limit: 5,
    });
    if (blobs.length) await del(blobs.map((b) => b.url));
  } catch (e) {
    console.error("song blob cleanup failed", e);
  }
  return NextResponse.json({ ok: true });
}
