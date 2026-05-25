import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { generateStillViaHiggsfield } from "@/lib/higgsfield";
import { readFiller, writeFiller, type FillerStill } from "@/lib/filler-store";
import { slugify, uniqueId } from "@/lib/books-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/admin/generate-filler { label, prompt }
// Generates a single filler still via Higgsfield, saves to Blob, and
// appends the entry to system/filler.json.
export async function POST(req: Request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "BLOB_READ_WRITE_TOKEN not set" },
      { status: 503 },
    );
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY not set" },
      { status: 503 },
    );
  }

  let body: { label?: string; prompt?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const label = (body.label || "").trim();
  const prompt = (body.prompt || "").trim();
  if (!label || !prompt) {
    return NextResponse.json(
      { error: "label and prompt required" },
      { status: 400 },
    );
  }

  const existing = await readFiller();
  const id = uniqueId(slugify(label), new Set(existing.map((s) => s.id)));
  try {
    const sourceUrl = await generateStillViaHiggsfield({
      prompt,
      aspectRatio: "2:3",
    });
    const dl = await fetch(sourceUrl);
    if (!dl.ok) {
      throw new Error(`failed to download generated image: ${dl.status}`);
    }
    const buf = Buffer.from(await dl.arrayBuffer());
    const blob = await put(`system/filler/${id}.jpg`, buf, {
      access: "public",
      contentType: "image/jpeg",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    const still: FillerStill = {
      id,
      label,
      url: blob.url,
      prompt,
      createdAt: new Date().toISOString(),
    };
    await writeFiller([...existing, still]);
    return NextResponse.json({ ok: true, still });
  } catch (e) {
    console.error("generate-filler failed", e);
    return NextResponse.json(
      { error: (e as Error).message, label },
      { status: 500 },
    );
  }
}
