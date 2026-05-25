import { NextResponse } from "next/server";
import { list } from "@vercel/blob";
import { getOrCreateUserId, blobKeys, emptyState, type UserState } from "@/lib/user";

export const dynamic = "force-dynamic";

// GET /api/state — returns the user's saved state (quote + audio URL).
// Returns emptyState if nothing saved yet or if Blob isn't configured.
export async function GET() {
  const uid = await getOrCreateUserId();

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json({ ...emptyState, configured: false });
  }

  try {
    const { blobs } = await list({ prefix: `users/${uid}/`, limit: 10 });
    const stateBlob = blobs.find((b) => b.pathname === blobKeys.state(uid));
    const audioBlob = blobs.find((b) => b.pathname === blobKeys.audio(uid));

    let state: UserState = { ...emptyState };
    if (stateBlob) {
      const r = await fetch(stateBlob.url, { cache: "no-store" });
      if (r.ok) {
        const parsed = (await r.json()) as Partial<UserState>;
        state = { ...emptyState, ...parsed };
      }
    }
    // Always refresh audioUrl from the latest blob listing
    state.audioUrl = audioBlob?.url ?? null;
    return NextResponse.json({ ...state, configured: true });
  } catch (e) {
    console.error("state GET failed", e);
    return NextResponse.json({ ...emptyState, configured: false });
  }
}
