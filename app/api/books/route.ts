import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import {
  readBooks,
  upsertBook,
  slugify,
  uniqueId,
  type Book,
  type BookCategory,
} from "@/lib/books-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json({ configured: false, books: [] });
  }
  const books = await readBooks();
  return NextResponse.json({ configured: true, books });
}

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

  const title = String(form.get("title") || "").trim();
  const cover = form.get("cover");
  const copyFromBookId = String(form.get("copyFromBookId") || "").trim();
  const stylePrompt = String(form.get("stylePrompt") || "").trim();
  if (!title) {
    return NextResponse.json({ error: "title required" }, { status: 400 });
  }
  if (!(cover instanceof File) || cover.size === 0) {
    return NextResponse.json({ error: "cover image required" }, { status: 400 });
  }

  const books = await readBooks();
  const id = uniqueId(slugify(title), new Set(books.map((b) => b.id)));

  const ext = extFromMime(cover.type);
  const coverBuf = Buffer.from(await cover.arrayBuffer());
  const blob = await put(`books/${id}/cover.${ext}`, coverBuf, {
    access: "public",
    contentType: cover.type || "image/jpeg",
    addRandomSuffix: false,
    allowOverwrite: true,
  });

  let categories: BookCategory[] = [];
  if (copyFromBookId) {
    const source = books.find((b) => b.id === copyFromBookId);
    if (source) {
      categories = source.categories.map((c) => ({ ...c }));
    }
  }

  const book: Book = {
    id,
    title,
    coverUrl: blob.url,
    stylePrompt: stylePrompt || undefined,
    categories,
    createdAt: new Date().toISOString(),
  };
  await upsertBook(book);
  return NextResponse.json({ book });
}

function extFromMime(mime: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/gif") return "gif";
  return "jpg";
}
