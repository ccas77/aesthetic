import { NextResponse } from "next/server";
import { del, list } from "@vercel/blob";
import { mutateBook } from "@/lib/books-store";

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
  let notFound = false;
  const book = await mutateBook(id, (b) => {
    const songs = b.songs ?? [];
    if (!songs.some((s) => s.id === sid)) {
      notFound = true;
      return b;
    }
    return { ...b, songs: songs.filter((s) => s.id !== sid) };
  });
  if (!book) {
    return NextResponse.json({ error: "book not found" }, { status: 404 });
  }
  if (notFound) {
    return NextResponse.json({ error: "song not found" }, { status: 404 });
  }
  try {
    const { blobs } = await list({
      prefix: `books/${id}/songs/${sid}.`,
      limit: 5,
    });
    if (blobs.length) await del(blobs.map((b) => b.url));
  } catch (e) {
    console.error("song blob cleanup failed", e);
  }
  return NextResponse.json({ ok: true, book });
}
