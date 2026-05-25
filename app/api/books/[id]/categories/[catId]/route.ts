import { NextResponse } from "next/server";
import { list, del } from "@vercel/blob";
import { readBooks, upsertBook } from "@/lib/books-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string; catId: string }>;
}

export async function PATCH(req: Request, { params }: RouteParams) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "BLOB_READ_WRITE_TOKEN not set" },
      { status: 503 },
    );
  }
  const { id, catId } = await params;
  let body: { label?: unknown; prompt?: unknown };
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
  const cat = book.categories.find((c) => c.id === catId);
  if (!cat) {
    return NextResponse.json({ error: "category not found" }, { status: 404 });
  }
  if (typeof body.label === "string" && body.label.trim()) {
    cat.label = body.label.trim();
  }
  if (typeof body.prompt === "string" && body.prompt.trim()) {
    cat.prompt = body.prompt.trim();
  }
  await upsertBook(book);
  return NextResponse.json({ book });
}

export async function DELETE(_req: Request, { params }: RouteParams) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "BLOB_READ_WRITE_TOKEN not set" },
      { status: 503 },
    );
  }
  const { id, catId } = await params;
  const books = await readBooks();
  const book = books.find((b) => b.id === id);
  if (!book) {
    return NextResponse.json({ error: "book not found" }, { status: 404 });
  }
  const before = book.categories.length;
  book.categories = book.categories.filter((c) => c.id !== catId);
  if (book.categories.length === before) {
    return NextResponse.json({ error: "category not found" }, { status: 404 });
  }
  await upsertBook(book);
  try {
    const { blobs } = await list({
      prefix: `books/${id}/library/${catId}.`,
      limit: 5,
    });
    if (blobs.length) {
      await del(blobs.map((b) => b.url));
    }
  } catch (e) {
    console.error("category image cleanup failed", e);
  }
  return NextResponse.json({ ok: true });
}
