import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { readBooks } from "@/lib/books-store";
import { generateStillViaHiggsfield } from "@/lib/higgsfield";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/admin/generate-still { bookId: string, category: string }
// Generates one still via Higgsfield (through Anthropic API + MCP),
// downloads the result, and saves it to Vercel Blob at
// books/{bookId}/library/{category}.jpg.
export async function POST(req: Request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json({ error: "BLOB_READ_WRITE_TOKEN not set" }, { status: 503 });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 503 });
  }

  let body: { bookId?: string; category?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const bookId = body.bookId?.trim();
  const categoryId = body.category?.trim();
  if (!bookId) {
    return NextResponse.json({ error: "bookId required" }, { status: 400 });
  }
  if (!categoryId) {
    return NextResponse.json({ error: "category required" }, { status: 400 });
  }

  const books = await readBooks();
  const book = books.find((b) => b.id === bookId);
  if (!book) {
    return NextResponse.json(
      { error: `book "${bookId}" not found` },
      { status: 404 },
    );
  }
  const category = book.categories.find((c) => c.id === categoryId);
  if (!category) {
    return NextResponse.json(
      {
        error: `category "${categoryId}" not found in book "${bookId}"`,
        available: book.categories.map((c) => c.id),
      },
      { status: 400 },
    );
  }

  try {
    const imageUrl = await generateStillViaHiggsfield({
      prompt: category.prompt,
      aspectRatio: "2:3",
    });
    const dl = await fetch(imageUrl);
    if (!dl.ok) {
      throw new Error(`failed to download generated image: ${dl.status}`);
    }
    const buf = Buffer.from(await dl.arrayBuffer());
    const blob = await put(`books/${bookId}/library/${categoryId}.jpg`, buf, {
      access: "public",
      contentType: "image/jpeg",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return NextResponse.json({
      ok: true,
      bookId,
      id: categoryId,
      label: category.label,
      sourceUrl: imageUrl,
      blobUrl: blob.url,
    });
  } catch (e) {
    console.error("generate-still failed", e);
    return NextResponse.json(
      { error: (e as Error).message, bookId, category: categoryId },
      { status: 500 },
    );
  }
}
