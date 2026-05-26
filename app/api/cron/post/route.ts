import { NextResponse } from "next/server";
import { findBook } from "@/lib/books-store";
import { readBooks } from "@/lib/books-store";
import {
  readManifest,
  updateRender,
  type RenderEntry,
} from "@/lib/renders-manifest";
import { createPost, uploadVideo } from "@/lib/post-bridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// GET /api/cron/post — drains one un-posted render per tick. Picks
// the oldest entry across all books that has no postedAt, uploads
// the MP4 to PostBridge, creates the post against the owning book's
// configured social accounts, and writes postedAt + postBridgeIds
// back into the manifest.
//
// Hard-gated by POSTBRIDGE_AUTOPOST_ENABLED. Until that env var is
// the literal string "true", this route always reports a dry run.
// The user's standing instruction is: building/deploying the
// integration is not consent to actually publish.
export async function GET(req: Request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "BLOB_READ_WRITE_TOKEN not set" },
      { status: 503 },
    );
  }
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization") || "";
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const autopost = process.env.POSTBRIDGE_AUTOPOST_ENABLED === "true";
  const hasKey = !!process.env.POSTBRIDGE_API_KEY;

  // Look across every book's manifest for the oldest un-posted entry
  // that targets at least one PostBridge account.
  const books = await readBooks();
  const candidates: Array<{ entry: RenderEntry; accountIds: number[]; caption: string }> = [];
  for (const book of books) {
    const accountIds = book.postAccountIds ?? [];
    if (accountIds.length === 0) continue;
    const renders = await readManifest(book.id);
    for (const r of renders) {
      if (r.postedAt) continue;
      const quote = (book.quotes ?? []).find((q) => q.id === r.quoteId);
      const caption =
        (quote?.text ?? "").trim() +
        (book.captionSuffix ? `\n\n${book.captionSuffix}` : "");
      candidates.push({ entry: r, accountIds, caption });
    }
  }
  // Oldest first so the queue actually drains in order.
  candidates.sort((a, b) =>
    a.entry.createdAt.localeCompare(b.entry.createdAt),
  );
  if (candidates.length === 0) {
    return NextResponse.json({
      drained: 0,
      reason: "no un-posted renders with configured accounts",
      autopost,
      hasKey,
    });
  }

  const pick = candidates[0];
  if (!autopost) {
    return NextResponse.json({
      drained: 0,
      status: "dry-run",
      reason:
        "POSTBRIDGE_AUTOPOST_ENABLED is not 'true'; the cron is wired but will not publish",
      candidate: {
        renderId: pick.entry.renderId,
        bookId: pick.entry.bookId,
        accountIds: pick.accountIds,
        caption: pick.caption.slice(0, 200),
      },
      hasKey,
    });
  }
  if (!hasKey) {
    return NextResponse.json({
      drained: 0,
      status: "no-key",
      reason: "POSTBRIDGE_AUTOPOST_ENABLED=true but POSTBRIDGE_API_KEY not set",
    });
  }

  // Live path: fetch the rendered MP4, upload to PostBridge, create the post.
  const book = await findBook(pick.entry.bookId);
  if (!book) {
    return NextResponse.json(
      { drained: 0, status: "skipped", reason: "book not found", renderId: pick.entry.renderId },
    );
  }
  try {
    const videoRes = await fetch(pick.entry.blobUrl);
    if (!videoRes.ok) {
      throw new Error(`video fetch ${pick.entry.blobUrl} -> ${videoRes.status}`);
    }
    const buf = Buffer.from(await videoRes.arrayBuffer());
    const mediaId = await uploadVideo(buf, `${pick.entry.renderId}.mp4`);
    const postId = await createPost({
      caption: pick.caption || book.title,
      mediaIds: [mediaId],
      accountIds: pick.accountIds,
    });
    await updateRender(pick.entry.bookId, pick.entry.renderId, {
      postedAt: new Date().toISOString(),
      postBridgeIds: [postId],
    });
    return NextResponse.json({
      drained: 1,
      status: "posted",
      renderId: pick.entry.renderId,
      postId,
      accountIds: pick.accountIds,
    });
  } catch (e) {
    console.error("cron post failed", e);
    return NextResponse.json(
      {
        drained: 0,
        status: "failed",
        renderId: pick.entry.renderId,
        error: (e as Error).message,
      },
      { status: 500 },
    );
  }
}
