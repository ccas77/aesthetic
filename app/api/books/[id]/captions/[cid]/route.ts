import { NextResponse } from "next/server";
import { mutateBook } from "@/lib/books-store";

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
  if (typeof body.text !== "string" || !body.text.trim()) {
    return NextResponse.json({ error: "text required" }, { status: 400 });
  }
  const text = body.text.trim();

  let notFound = false;
  const book = await mutateBook(id, (b) => {
    const captions = b.captions ?? [];
    const idx = captions.findIndex((c) => c.id === cid);
    if (idx === -1) {
      notFound = true;
      return b;
    }
    const next = captions.slice();
    next[idx] = { ...next[idx], text };
    return { ...b, captions: next };
  });
  if (!book) {
    return NextResponse.json({ error: "book not found" }, { status: 404 });
  }
  if (notFound) {
    return NextResponse.json({ error: "caption not found" }, { status: 404 });
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
  const { id, cid } = await params;
  let notFound = false;
  const book = await mutateBook(id, (b) => {
    const captions = b.captions ?? [];
    if (!captions.some((c) => c.id === cid)) {
      notFound = true;
      return b;
    }
    return { ...b, captions: captions.filter((c) => c.id !== cid) };
  });
  if (!book) {
    return NextResponse.json({ error: "book not found" }, { status: 404 });
  }
  if (notFound) {
    return NextResponse.json({ error: "caption not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, book });
}
