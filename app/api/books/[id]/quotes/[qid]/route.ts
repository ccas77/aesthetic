import { NextResponse } from "next/server";
import { readBooks, upsertBook } from "@/lib/books-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string; qid: string }>;
}

export async function PATCH(req: Request, { params }: RouteParams) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "BLOB_READ_WRITE_TOKEN not set" },
      { status: 503 },
    );
  }
  const { id, qid } = await params;
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
  const q = (book.quotes ?? []).find((x) => x.id === qid);
  if (!q) {
    return NextResponse.json({ error: "quote not found" }, { status: 404 });
  }
  if (typeof body.text !== "string" || !body.text.trim()) {
    return NextResponse.json({ error: "text required" }, { status: 400 });
  }
  q.text = body.text.trim();
  await upsertBook(book);
  return NextResponse.json({ book, quote: q });
}

export async function DELETE(_req: Request, { params }: RouteParams) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "BLOB_READ_WRITE_TOKEN not set" },
      { status: 503 },
    );
  }
  const { id, qid } = await params;
  const books = await readBooks();
  const book = books.find((b) => b.id === id);
  if (!book) {
    return NextResponse.json({ error: "book not found" }, { status: 404 });
  }
  const before = (book.quotes ?? []).length;
  book.quotes = (book.quotes ?? []).filter((x) => x.id !== qid);
  if ((book.quotes ?? []).length === before) {
    return NextResponse.json({ error: "quote not found" }, { status: 404 });
  }
  await upsertBook(book);
  return NextResponse.json({ ok: true });
}
