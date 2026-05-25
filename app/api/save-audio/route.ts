import { NextResponse } from "next/server";
import { put, list } from "@vercel/blob";
import { getOrCreateUserId, blobKeys } from "@/lib/user";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/save-audio — multipart form with field "audio" (the file).
export async function POST(req: Request) {
  const uid = await getOrCreateUserId();

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "Blob storage not configured" },
      { status: 503 },
    );
  }

  const form = await req.formData();
  const file = form.get("audio");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "missing audio file" }, { status: 400 });
  }

  // Reject anything bigger than 25 MB
  if (file.size > 25 * 1024 * 1024) {
    return NextResponse.json({ error: "audio too large (max 25MB)" }, { status: 413 });
  }

  // Upload the audio under a stable key (overwrites any previous file).
  const audioBlob = await put(blobKeys.audio(uid), file, {
    access: "public",
    contentType: file.type || "audio/mpeg",
    addRandomSuffix: false,
    allowOverwrite: true,
  });

  // Update the state blob with audio metadata, preserving any existing quote.
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

  const next = {
    ...existing,
    audioUrl: audioBlob.url,
    audioName: file.name,
    audioSize: file.size,
  };
  await put(blobKeys.state(uid), JSON.stringify(next), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  });

  return NextResponse.json({
    ok: true,
    audioUrl: audioBlob.url,
    audioName: file.name,
    audioSize: file.size,
  });
}
