import { NextResponse } from "next/server";
import { list } from "@vercel/blob";
import { readBooks } from "@/lib/books-store";

export const dynamic = "force-dynamic";

// GET /api/library?bookId=<id> returns the per-book stills bank.
// Without bookId we return an empty list so the renderer can gracefully
// no-op until a book is selected.
export async function GET(req: Request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json({ configured: false, stills: [], missing: [] });
  }
  const url = new URL(req.url);
  const bookId = url.searchParams.get("bookId");
  if (!bookId) {
    return NextResponse.json({ configured: true, stills: [], missing: [] });
  }
  try {
    const books = await readBooks();
    const book = books.find((b) => b.id === bookId);
    if (!book) {
      return NextResponse.json(
        { configured: true, stills: [], missing: [] },
        { status: 200 },
      );
    }
    const { blobs } = await list({
      prefix: `books/${bookId}/library/`,
      limit: 200,
    });
    const stills = book.categories
      .map((cat) => {
        const blob = blobs.find((b) =>
          b.pathname.startsWith(`books/${bookId}/library/${cat.id}.`),
        );
        return blob ? { id: cat.id, url: blob.url } : null;
      })
      .filter((s): s is { id: string; url: string } => !!s);
    return NextResponse.json({
      configured: true,
      stills,
      missing: book.categories
        .filter((c) => !stills.find((s) => s.id === c.id))
        .map((c) => c.id),
    });
  } catch (e) {
    console.error("library GET failed", e);
    return NextResponse.json(
      { configured: false, stills: [], missing: [] },
      { status: 500 },
    );
  }
}
