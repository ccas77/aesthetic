import { NextResponse } from "next/server";
import { findBook } from "@/lib/books-store";
import { readManifest, updateRender } from "@/lib/renders-manifest";
import {
  pickDuePost,
  updatePostQueue,
} from "@/lib/post-queue";
import { createPost, uploadVideo } from "@/lib/post-bridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// GET /api/cron/post — drains one due post-queue entry per tick.
// Picks the oldest entry whose scheduledFor is in the past and whose
// status is "scheduled", uploads the render's MP4 to PostBridge,
// creates the post against the entry's accountIds, and updates the
// queue entry + the book's renders manifest.
//
// Hard-gated by POSTBRIDGE_AUTOPOST_ENABLED. Until that env var is
// the literal string "true", this route stays in dry-run mode and
// reports the entry it would have published.
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

  const entry = await pickDuePost();
  if (!entry) {
    return NextResponse.json({ drained: 0, reason: "no due posts", autopost, hasKey });
  }

  if (!autopost) {
    return NextResponse.json({
      drained: 0,
      status: "dry-run",
      reason: "POSTBRIDGE_AUTOPOST_ENABLED is not 'true'",
      candidate: {
        id: entry.id,
        renderId: entry.renderId,
        bookId: entry.bookId,
        accountIds: entry.accountIds,
        caption: entry.caption.slice(0, 200),
      },
      hasKey,
    });
  }
  if (!hasKey) {
    return NextResponse.json({
      drained: 0,
      status: "no-key",
      reason: "POSTBRIDGE_API_KEY not set",
    });
  }

  const book = await findBook(entry.bookId);
  if (!book) {
    await updatePostQueue(entry.id, {
      status: "failed",
      lastError: "book not found",
      attempts: entry.attempts + 1,
    });
    return NextResponse.json(
      { drained: 0, status: "skipped", reason: "book not found", id: entry.id },
    );
  }
  const manifest = await readManifest(entry.bookId);
  const render = manifest.find((r) => r.renderId === entry.renderId);
  if (!render) {
    await updatePostQueue(entry.id, {
      status: "failed",
      lastError: "render not found in manifest",
      attempts: entry.attempts + 1,
    });
    return NextResponse.json(
      { drained: 0, status: "skipped", reason: "render not found", id: entry.id },
    );
  }

  try {
    const videoRes = await fetch(render.blobUrl);
    if (!videoRes.ok) {
      throw new Error(`video fetch ${render.blobUrl} -> ${videoRes.status}`);
    }
    const buf = Buffer.from(await videoRes.arrayBuffer());
    const mediaId = await uploadVideo(buf, `${render.renderId}.mp4`);
    const postId = await createPost({
      caption: entry.caption || book.title,
      mediaIds: [mediaId],
      accountIds: entry.accountIds,
    });
    const postedAt = new Date().toISOString();
    await updatePostQueue(entry.id, {
      status: "posted",
      postedAt,
      postBridgePostIds: [postId],
      attempts: entry.attempts + 1,
    });
    await updateRender(entry.bookId, entry.renderId, {
      postedAt,
      postBridgeIds: [postId],
    });
    return NextResponse.json({
      drained: 1,
      status: "posted",
      id: entry.id,
      renderId: entry.renderId,
      postId,
      accountIds: entry.accountIds,
    });
  } catch (e) {
    const msg = (e as Error).message;
    await updatePostQueue(entry.id, {
      status: "failed",
      lastError: msg,
      attempts: entry.attempts + 1,
    });
    console.error("cron post failed", e);
    return NextResponse.json(
      { drained: 0, status: "failed", id: entry.id, error: msg },
      { status: 500 },
    );
  }
}
