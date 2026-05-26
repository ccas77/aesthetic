import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { findBook } from "@/lib/books-store";
import { dequeueJob, enqueueJobs } from "@/lib/queue";
import { buildStillsPool, pickPinnedFirstStillIds } from "@/lib/render-planner";
import { renderServer } from "@/lib/render-server";
import { appendRender } from "@/lib/renders-manifest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Pro: up to 300s. One render typically fits.
export const maxDuration = 300;

// GET /api/cron/render — drains one queued render job. Vercel cron
// hits this on a schedule (see vercel.json). Authorization is the
// standard CRON_SECRET pattern when set; otherwise any caller can
// drain a single job, which is fine for a single-tenant deployment.
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

  const job = await dequeueJob();
  if (!job) return NextResponse.json({ drained: 0, reason: "queue empty" });

  const book = await findBook(job.bookId);
  if (!book) {
    return NextResponse.json(
      { drained: 1, job, status: "skipped", reason: "book not found" },
    );
  }
  const quote = (book.captions ?? []).find((q) => q.id === job.quoteId);
  const song = (book.songs ?? []).find((s) => s.id === job.songId);
  if (!quote || !song) {
    return NextResponse.json(
      {
        drained: 1,
        job,
        status: "skipped",
        reason: !quote ? "quote not found" : "song not found",
      },
    );
  }

  const { pool, freshIds } = await buildStillsPool(book);
  if (pool.length === 0) {
    return NextResponse.json(
      { drained: 1, job, status: "skipped", reason: "no stills in pool" },
    );
  }

  const renderId = randomUUID();
  const pinnedFirstStillIds = pickPinnedFirstStillIds(freshIds);
  // Top-up signal: when the book has fewer than 2 fresh stills, future
  // renders will start repeating still IDs in the first two slots. We
  // log it for now; Phase 3 will trigger a Higgsfield top-up here.
  const lowFresh = freshIds.length < 2;
  try {
    const result = await renderServer({
      audioUrl: song.url,
      bpm: song.bpm ?? 80,
      quote: quote.text,
      stills: pool,
      outputKey: `books/${book.id}/renders/${renderId}.mp4`,
      pinnedFirstStillIds,
    });
    await appendRender(book.id, {
      renderId,
      bookId: book.id,
      quoteId: job.quoteId,
      songId: job.songId,
      stillIds: result.stillIds,
      blobUrl: result.blobUrl,
      durationSec: result.durationSec,
      shotCount: result.shotCount,
      createdAt: new Date().toISOString(),
    });
    return NextResponse.json({
      drained: 1,
      job,
      status: "ok",
      renderId,
      blobUrl: result.blobUrl,
      pinnedFirstStillIds,
      lowFresh,
    });
  } catch (e) {
    // Re-queue with incremented attempt counter so we don't lose the
    // job; cap retries so a permanently broken pair doesn't loop.
    const next = { ...job, attempts: job.attempts + 1 };
    if (next.attempts < 3) {
      await enqueueJobs([next]);
    }
    console.error("cron render failed", e);
    return NextResponse.json(
      {
        drained: 1,
        job: next,
        status: "failed",
        retryable: next.attempts < 3,
        error: (e as Error).message,
      },
      { status: 500 },
    );
  }
}
