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
export const maxDuration = 60;

interface RouteParams {
  params: Promise<{ id: string }>;
}

// POST /api/books/[id]/references (multipart)
// Fields:
//   label (string)
//   sex   ("male"|"female")
//   file  (image File) — may be repeated to upload many at once.
// All files share the same label + sex (typical "here are five
// reference shots of the male lead" workflow). Append happens in a
// single mutateBook call so concurrent saves don't clobber each other.
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
  if (!label) {
    return NextResponse.json({ error: "label required" }, { status: 400 });
  }
  if (sex !== "male" && sex !== "female") {
    return NextResponse.json(
      { error: "sex must be 'male' or 'female'" },
      { status: 400 },
    );
  }

  const files = form
    .getAll("file")
    .filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) {
    return NextResponse.json(
      { error: "at least one file required" },
      { status: 400 },
    );
  }

  // Upload every file first (parallel) so we can stage all blob URLs
  // before touching the book index — that way the books JSON gets one
  // single write with all new references, no read-modify-write race.
  const uploaded = await Promise.all(
    files.map(async (file) => {
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
      return ref;
    }),
  );

  const book = await mutateBook(id, (b) => ({
    ...b,
    references: [...(b.references ?? []), ...uploaded],
  }));
  if (!book) {
    return NextResponse.json({ error: "book not found" }, { status: 404 });
  }
  return NextResponse.json({ book, refs: uploaded });
}

function extFromMime(mime: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/gif") return "gif";
  return "jpg";
}
