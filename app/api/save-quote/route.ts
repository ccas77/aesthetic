import { NextResponse } from "next/server";
import { put, list } from "@vercel/blob";
import { getOrCreateUserId, blobKeys } from "@/lib/user";

export const dynamic = "force-dynamic";

// POST /api/save-quote { quote: string }
export async function POST(req: Request) {
  const uid = await getOrCreateUserId();

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "Blob storage not configured" },
      { status: 503 },
    );
  }

  let quote = "";
  try {
    const body = await req.json();
    quote = typeof body?.quote === "string" ? body.quote : "";
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  // Pull existing state so we preserve audioUrl/audioName/audioSize.
  let existing: Record<string, unknown> = {};
  try {
    const { blobs } = await list({ prefix: `users/${uid}/`, limit: 10 });
    const stateBlob = blobs.find((b) => b.pathname === blobKeys.state(uid));
    if (stateBlob) {
      const r = await fetch(stateBlob.url, { cache: "no-store" });
      if (r.ok) existing = await r.json();
    }
  } catch {
    /* ignore — first save */
  }

  const next = { ...existing, quote };
  const blob = await put(blobKeys.state(uid), JSON.stringify(next), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  });

  return NextResponse.json({ ok: true, url: blob.url });
}
