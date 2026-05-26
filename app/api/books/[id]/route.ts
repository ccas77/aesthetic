import { NextResponse } from "next/server";
import { put, list, del } from "@vercel/blob";
import { readBooks, upsertBook, removeBook } from "@/lib/books-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: Request, { params }: RouteParams) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "BLOB_READ_WRITE_TOKEN not set" },
      { status: 503 },
    );
  }
  const { id } = await params;
  const books = await readBooks();
  const book = books.find((b) => b.id === id);
  if (!book) {
    return NextResponse.json({ error: "book not found" }, { status: 404 });
  }

  const contentType = req.headers.get("content-type") || "";
  if (contentType.startsWith("multipart/")) {
    const form = await req.formData();
    const title = form.get("title");
    const cover = form.get("cover");
    if (typeof title === "string" && title.trim()) book.title = title.trim();
    if (cover instanceof File && cover.size > 0) {
      const ext = extFromMime(cover.type);
      const buf = Buffer.from(await cover.arrayBuffer());
      const blob = await put(`books/${id}/cover.${ext}`, buf, {
        access: "public",
        contentType: cover.type || "image/jpeg",
        addRandomSuffix: false,
        allowOverwrite: true,
      });
      book.coverUrl = blob.url;
    }
  } else {
    let body: {
      title?: string;
      stylePrompt?: string;
      postAccountIds?: unknown;
      captionSuffix?: string;
    };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
    }
    if (typeof body.title === "string" && body.title.trim()) {
      book.title = body.title.trim();
    }
    if (typeof body.stylePrompt === "string") {
      book.stylePrompt = body.stylePrompt.trim() || undefined;
    }
    if (Array.isArray(body.postAccountIds)) {
      const ids = body.postAccountIds
        .map((n) => Number(n))
        .filter((n) => Number.isFinite(n) && n > 0);
      book.postAccountIds = ids;
    }
    if (typeof body.captionSuffix === "string") {
      book.captionSuffix = body.captionSuffix.trim() || undefined;
    }
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
  const { id } = await params;
  const removed = await removeBook(id);
  if (!removed) {
    return NextResponse.json({ error: "book not found" }, { status: 404 });
  }
  try {
    const { blobs } = await list({ prefix: `books/${id}/`, limit: 1000 });
    if (blobs.length) {
      await del(blobs.map((b) => b.url));
    }
  } catch (e) {
    console.error("book delete cleanup failed", e);
  }
  return NextResponse.json({ ok: true });
}

function extFromMime(mime: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/gif") return "gif";
  return "jpg";
}
