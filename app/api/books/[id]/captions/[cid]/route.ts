import { NextResponse } from "next/server";
import { readBooks, upsertBook } from "@/lib/books-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string; cid: string }>;
}

export async function PATCH(req: Request, { params }: RouteParams) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "BLOB_READ_WRITE_TOKEN not set" },
      { status: 503 },
    );
  }
  const { id, cid } = await params;
  let body: { text?: unknown };
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
  const c = (book.captions ?? []).find((x) => x.id === cid);
  if (!c) {
    return NextResponse.json({ error: "caption not found" }, { status: 404 });
  }
  if (typeof body.text !== "string" || !body.text.trim()) {
    return NextResponse.json({ error: "text required" }, { status: 400 });
  }
  c.text = body.text.trim();
  await upsertBook(book);
  return NextResponse.json({ book, caption: c });
}

export async function DELETE(_req: Request, { params }: RouteParams) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "BLOB_READ_WRITE_TOKEN not set" },
      { status: 503 },
    );
  }
  const { id, cid } = await params;
  const books = await readBooks();
  const book = books.find((b) => b.id === id);
  if (!book) {
    return NextResponse.json({ error: "book not found" }, { status: 404 });
  }
  const before = (book.captions ?? []).length;
  book.captions = (book.captions ?? []).filter((x) => x.id !== cid);
  if ((book.captions ?? []).length === before) {
    return NextResponse.json({ error: "caption not found" }, { status: 404 });
  }
  await upsertBook(book);
  return NextResponse.json({ ok: true });
}
