import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import {
  readShared,
  writeShared,
  type SharedStill,
} from "@/lib/shared-store";
import { slugify, uniqueId } from "@/lib/books-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json({ configured: false, stills: [] });
  }
  const stills = await readShared();
  return NextResponse.json({ configured: true, stills });
}

// POST (multipart): { label, file } — uploads a user-provided image
// into the shared pool. For Higgsfield-generated shared stills, see
// /api/admin/generate-shared.
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
  const label = String(form.get("label") || "").trim();
  const file = form.get("file");
  if (!label) {
    return NextResponse.json({ error: "label required" }, { status: 400 });
  }
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "file required" }, { status: 400 });
  }
  const existing = await readShared();
  const id = uniqueId(slugify(label), new Set(existing.map((s) => s.id)));
  const ext = extFromMime(file.type);
  const buf = Buffer.from(await file.arrayBuffer());
  const blob = await put(`system/shared/${id}.${ext}`, buf, {
    access: "public",
    contentType: file.type || "image/jpeg",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
  const still: SharedStill = {
    id,
    label,
    url: blob.url,
    createdAt: new Date().toISOString(),
  };
  await writeShared([...existing, still]);
  return NextResponse.json({ still });
}

function extFromMime(mime: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/gif") return "gif";
  return "jpg";
}
