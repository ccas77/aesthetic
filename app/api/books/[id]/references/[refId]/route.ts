import { NextResponse } from "next/server";
import { del, list } from "@vercel/blob";
import { mutateBook } from "@/lib/books-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string; refId: string }>;
}

export async function DELETE(_req: Request, { params }: RouteParams) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "BLOB_READ_WRITE_TOKEN not set" },
      { status: 503 },
    );
  }
  const { id, refId } = await params;
  let notFound = false;
  const book = await mutateBook(id, (b) => {
    const refs = b.references ?? [];
    if (!refs.some((r) => r.id === refId)) {
      notFound = true;
      return b;
    }
    return { ...b, references: refs.filter((r) => r.id !== refId) };
  });
  if (!book) {
    return NextResponse.json({ error: "book not found" }, { status: 404 });
  }
  if (notFound) {
    return NextResponse.json({ error: "reference not found" }, { status: 404 });
  }
  try {
    const { blobs } = await list({
      prefix: `books/${id}/refs/${refId}.`,
      limit: 5,
    });
    if (blobs.length) await del(blobs.map((b) => b.url));
  } catch (e) {
    console.error("reference blob cleanup failed", e);
  }
  return NextResponse.json({ ok: true, book });
}
