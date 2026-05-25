import { NextResponse } from "next/server";
import { list } from "@vercel/blob";
import { BANK } from "@/lib/bank";

export const dynamic = "force-dynamic";

// GET /api/library — returns the global stills bank (shared across users).
// Each entry { id, url, tags } is what the renderer needs.
export async function GET() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json({ configured: false, stills: [] });
  }
  try {
    const { blobs } = await list({ prefix: "library/", limit: 200 });
    const stills = BANK
      .map((cat) => {
        const blob = blobs.find((b) =>
          b.pathname.startsWith(`library/${cat.id}`),
        );
        return blob
          ? { id: cat.id, url: blob.url, tags: cat.tags }
          : null;
      })
      .filter((s): s is { id: string; url: string; tags: string[] } => !!s);

    return NextResponse.json({
      configured: true,
      stills,
      missing: BANK.filter((c) => !stills.find((s) => s.id === c.id)).map((c) => c.id),
    });
  } catch (e) {
    console.error("library GET failed", e);
    return NextResponse.json({ configured: false, stills: [] }, { status: 500 });
  }
}
