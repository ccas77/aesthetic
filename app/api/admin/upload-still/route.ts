import { NextResponse } from "next/server";
import { put, list, del } from "@vercel/blob";
import { readBooks } from "@/lib/books-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// POST (multipart): { bookId, category, file }
// Uploads a user-provided image directly as the still for a given
// category on a given book. Bypasses Higgsfield entirely.
export async function POST(req: Request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "BLOB_READ_WRITE_TOKEN not set" },
      { status: 503 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "expected multipart/form-data" },
      { status: 400 },
    );
  }

  const bookId = String(form.get("bookId") || "").trim();
  const categoryId = String(form.get("category") || "").trim();
  const file = form.get("file");
  if (!bookId || !categoryId) {
    return NextResponse.json(
      { error: "bookId and category required" },
      { status: 400 },
    );
  }
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "file required" }, { status: 400 });
  }

  const books = await readBooks();
  const book = books.find((b) => b.id === bookId);
  if (!book) {
    return NextResponse.json({ error: "book not found" }, { status: 404 });
  }
  const cat = book.categories.find((c) => c.id === categoryId);
  if (!cat) {
    return NextResponse.json(
      { error: "category not found", available: book.categories.map((c) => c.id) },
      { status: 400 },
    );
  }

  const ext = extFromMime(file.type);
  const buf = Buffer.from(await file.arrayBuffer());
  const blob = await put(`books/${bookId}/library/${categoryId}.${ext}`, buf, {
    access: "public",
    contentType: file.type || "image/jpeg",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
  return NextResponse.json({
    ok: true,
    bookId,
    id: categoryId,
    label: cat.label,
    blobUrl: blob.url,
  });
}

// DELETE (JSON body): { bookId, category }
// Removes the still blob for a category but keeps the category's
// prompt + label intact, so the user can regenerate or re-upload
// later. Use the /api/books/[id]/categories/[catId] DELETE to drop
// the whole category.
export async function DELETE(req: Request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "BLOB_READ_WRITE_TOKEN not set" },
      { status: 503 },
    );
  }
  let body: { bookId?: string; category?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const bookId = (body.bookId ?? "").trim();
  const categoryId = (body.category ?? "").trim();
  if (!bookId || !categoryId) {
    return NextResponse.json(
      { error: "bookId and category required" },
      { status: 400 },
    );
  }
  try {
    const { blobs } = await list({
      prefix: `books/${bookId}/library/${categoryId}.`,
      limit: 5,
    });
    if (blobs.length > 0) {
      await del(blobs.map((b) => b.url));
    }
    return NextResponse.json({ ok: true, removed: blobs.length });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 },
    );
  }
}

function extFromMime(mime: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/gif") return "gif";
  return "jpg";
}
