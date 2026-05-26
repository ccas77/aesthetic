import { NextResponse } from "next/server";
import {
  mutateBook,
  slugify,
  uniqueId,
  type BookCategory,
} from "@/lib/books-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// Accepts a single category { label, prompt, id? } or { categories: [...] }.
export async function POST(req: Request, { params }: RouteParams) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "BLOB_READ_WRITE_TOKEN not set" },
      { status: 503 },
    );
  }
  const { id } = await params;
  let body: { categories?: unknown; label?: unknown; prompt?: unknown; id?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const incomingRaw: unknown[] = Array.isArray(body.categories)
    ? (body.categories as unknown[])
    : [body];

  let added: BookCategory[] = [];
  const rejected: Array<{ index: number; reason: string }> = [];

  const book = await mutateBook(id, (b) => {
    const taken = new Set(b.categories.map((c) => c.id));
    const localAdded: BookCategory[] = [];
    incomingRaw.forEach((raw, idx) => {
      if (!raw || typeof raw !== "object") {
        rejected.push({ index: idx, reason: "not an object" });
        return;
      }
      const r = raw as { id?: unknown; label?: unknown; prompt?: unknown };
      const label = typeof r.label === "string" ? r.label.trim() : "";
      const prompt = typeof r.prompt === "string" ? r.prompt.trim() : "";
      if (!label || !prompt) {
        rejected.push({ index: idx, reason: "label and prompt required" });
        return;
      }
      const requestedId =
        typeof r.id === "string" && r.id.trim()
          ? slugify(r.id.trim())
          : slugify(label);
      const catId = uniqueId(requestedId, taken);
      taken.add(catId);
      localAdded.push({ id: catId, label, prompt });
    });
    added = localAdded;
    if (localAdded.length === 0) return b;
    return { ...b, categories: [...b.categories, ...localAdded] };
  });

  if (!book) {
    return NextResponse.json({ error: "book not found" }, { status: 404 });
  }
  if (added.length === 0) {
    return NextResponse.json(
      { error: "no valid categories provided", rejected },
      { status: 400 },
    );
  }
  return NextResponse.json({ book, added, rejected });
}
