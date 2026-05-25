import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { BANK } from "@/lib/bank";
import { generateStillViaHiggsfield } from "@/lib/higgsfield";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/admin/generate-still { category: string }
// Generates one still via Higgsfield (through Anthropic API + MCP),
// downloads the result, and saves it to Vercel Blob at library/{category}.jpg.
export async function POST(req: Request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json({ error: "BLOB_READ_WRITE_TOKEN not set" }, { status: 503 });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 503 });
  }

  let body: { category?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const category = BANK.find((c) => c.id === body.category);
  if (!category) {
    return NextResponse.json(
      { error: `unknown category "${body.category}"`, available: BANK.map((c) => c.id) },
      { status: 400 },
    );
  }

  try {
    // 1) Generate the image via Higgsfield MCP
    const imageUrl = await generateStillViaHiggsfield({
      prompt: category.prompt,
      aspectRatio: "2:3",
    });

    // 2) Download the image bytes
    const dl = await fetch(imageUrl);
    if (!dl.ok) {
      throw new Error(`failed to download generated image: ${dl.status}`);
    }
    const buf = Buffer.from(await dl.arrayBuffer());

    // 3) Save to Vercel Blob at a stable path
    const blob = await put(`library/${category.id}.jpg`, buf, {
      access: "public",
      contentType: "image/jpeg",
      addRandomSuffix: false,
      allowOverwrite: true,
    });

    return NextResponse.json({
      ok: true,
      id: category.id,
      label: category.label,
      sourceUrl: imageUrl,
      blobUrl: blob.url,
    });
  } catch (e) {
    console.error("generate-still failed", e);
    return NextResponse.json(
      { error: (e as Error).message, category: category.id },
      { status: 500 },
    );
  }
}
