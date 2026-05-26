import { NextResponse } from "next/server";
import { list, del } from "@vercel/blob";
import { mutateBook } from "@/lib/books-store";

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
  let body: { label?: unknown; prompt?: unknown; appearsIn?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  let notFound = false;
  const book = await mutateBook(id, (b) => {
    const idx = b.categories.findIndex((c) => c.id === catId);
    if (idx === -1) {
      notFound = true;
      return b;
    }
    const cat = { ...b.categories[idx] };
    if (typeof body.label === "string" && body.label.trim()) {
      cat.label = body.label.trim();
    }
    if (typeof body.prompt === "string" && body.prompt.trim()) {
      cat.prompt = body.prompt.trim();
    }
    if (
      body.appearsIn === "female" ||
      body.appearsIn === "male" ||
      body.appearsIn === "both"
    ) {
      cat.appearsIn = body.appearsIn;
    }
    const categories = b.categories.slice();
    categories[idx] = cat;
    return { ...b, categories };
  });
  if (!book) {
    return NextResponse.json({ error: "book not found" }, { status: 404 });
  }
  if (notFound) {
    return NextResponse.json({ error: "category not found" }, { status: 404 });
  }
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
  let notFound = false;
  const book = await mutateBook(id, (b) => {
    if (!b.categories.some((c) => c.id === catId)) {
      notFound = true;
      return b;
    }
    return { ...b, categories: b.categories.filter((c) => c.id !== catId) };
  });
  if (!book) {
    return NextResponse.json({ error: "book not found" }, { status: 404 });
  }
  if (notFound) {
    return NextResponse.json({ error: "category not found" }, { status: 404 });
  }
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
  return NextResponse.json({ ok: true, book });
}
