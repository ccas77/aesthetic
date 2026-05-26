import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { randomUUID } from "node:crypto";
import { readBooks, upsertBook, type Song } from "@/lib/books-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// POST /api/books/[id]/songs (multipart)
// Fields: title (string), file (audio File), bpm (optional number),
// durationSec (optional number). The file is stored at
// books/{bookId}/songs/{songId}.<ext>; bpm/durationSec, if known, are
// persisted so the renderer doesn't have to re-detect.
export async function POST(req: Request, { params }: RouteParams) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "BLOB_READ_WRITE_TOKEN not set" },
      { status: 503 },
    );
  }
  const { id } = await params;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "expected multipart/form-data" },
      { status: 400 },
    );
  }
  const title = String(form.get("title") || "").trim();
  const file = form.get("file");
  if (!title) {
    return NextResponse.json({ error: "title required" }, { status: 400 });
  }
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "file required" }, { status: 400 });
  }

  const books = await readBooks();
  const book = books.find((b) => b.id === id);
  if (!book) {
    return NextResponse.json({ error: "book not found" }, { status: 404 });
  }

  const songId = randomUUID();
  const ext = extFromMime(file.type, file.name);
  const buf = Buffer.from(await file.arrayBuffer());
  const blob = await put(`books/${id}/songs/${songId}.${ext}`, buf, {
    access: "public",
    contentType: file.type || "audio/mpeg",
    addRandomSuffix: false,
    allowOverwrite: true,
  });

  const rawBpm = form.get("bpm");
  const bpm =
    typeof rawBpm === "string" && rawBpm.trim() && Number.isFinite(Number(rawBpm))
      ? Number(rawBpm)
      : undefined;
  const rawDur = form.get("durationSec");
  const durationSec =
    typeof rawDur === "string" && rawDur.trim() && Number.isFinite(Number(rawDur))
      ? Number(rawDur)
      : undefined;

  const song: Song = {
    id: songId,
    title,
    url: blob.url,
    bpm,
    durationSec,
    createdAt: new Date().toISOString(),
  };
  book.songs = [...(book.songs ?? []), song];
  await upsertBook(book);
  return NextResponse.json({ book, song });
}

function extFromMime(mime: string, filename: string): string {
  if (mime === "audio/mpeg" || mime === "audio/mp3") return "mp3";
  if (mime === "audio/wav" || mime === "audio/x-wav") return "wav";
  if (mime === "audio/ogg") return "ogg";
  if (mime === "audio/mp4" || mime === "audio/x-m4a") return "m4a";
  const m = filename.match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : "mp3";
}
