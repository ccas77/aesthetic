import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { put } from "@vercel/blob";
import {
  mutateBook,
  type BookReference,
  type CharacterSex,
} from "@/lib/books-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// POST /api/books/[id]/references (multipart)
// Fields: label (string), sex ("male"|"female"), file (image File)
// Image is uploaded to books/{bookId}/refs/{refId}.<ext> and a
// BookReference record is appended to the book.
export async function POST(req: Request, { params }: RouteParams) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "BLOB_READ_WRITE_TOKEN not set" },
      { status: 503 },
    );
  }
  const { id } = await params;
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "expected multipart/form-data" },
      { status: 400 },
    );
  }
  const label = String(form.get("label") || "").trim();
  const sex = String(form.get("sex") || "").trim();
  const file = form.get("file");
  if (!label) {
    return NextResponse.json({ error: "label required" }, { status: 400 });
  }
  if (sex !== "male" && sex !== "female") {
    return NextResponse.json(
      { error: "sex must be 'male' or 'female'" },
      { status: 400 },
    );
  }
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "file required" }, { status: 400 });
  }

  const refId = randomUUID();
  const ext = extFromMime(file.type);
  const buf = Buffer.from(await file.arrayBuffer());
  const blob = await put(`books/${id}/refs/${refId}.${ext}`, buf, {
    access: "public",
    contentType: file.type || "image/jpeg",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
  const ref: BookReference = {
    id: refId,
    label,
    url: blob.url,
    sex: sex as CharacterSex,
    createdAt: new Date().toISOString(),
  };
  const book = await mutateBook(id, (b) => ({
    ...b,
    references: [...(b.references ?? []), ref],
  }));
  if (!book) {
    return NextResponse.json({ error: "book not found" }, { status: 404 });
  }
  return NextResponse.json({ book, ref });
}

function extFromMime(mime: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/gif") return "gif";
  return "jpg";
}
