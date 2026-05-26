import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { findBook } from "@/lib/books-store";
import { enqueueJobs, readQueue, type QueueJob } from "@/lib/queue";
import { pickNextPairs } from "@/lib/render-planner";
import { pairKey } from "@/lib/renders-manifest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/admin/queue-renders { bookId, count }
// Round-robins through (quote, song) pairs for the book, skipping pairs
// already rendered or already queued, and appends count new jobs to the
// render queue. Returns the appended jobs.
export async function POST(req: Request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "BLOB_READ_WRITE_TOKEN not set" },
      { status: 503 },
    );
  }
  let body: { bookId?: string; count?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const bookId = (body.bookId ?? "").trim();
  const count = Math.min(Math.max(1, Math.floor(Number(body.count) || 1)), 100);
  if (!bookId) {
    return NextResponse.json({ error: "bookId required" }, { status: 400 });
  }

  const book = await findBook(bookId);
  if (!book) {
    return NextResponse.json({ error: "book not found" }, { status: 404 });
  }
  if ((book.captions ?? []).length === 0 || (book.songs ?? []).length === 0) {
    return NextResponse.json(
      { error: "book needs at least one caption and one song" },
      { status: 400 },
    );
  }

  const existingQueue = await readQueue();
  const alreadyQueued = new Set(
    existingQueue
      .filter((j) => j.bookId === bookId)
      .map((j) => pairKey(j.quoteId, j.songId)),
  );

  const pairs = await pickNextPairs(book, count, alreadyQueued);
  if (pairs.length === 0) {
    return NextResponse.json(
      { error: "no pairs to enqueue (all already queued)" },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();
  const jobs: QueueJob[] = pairs.map((p) => ({
    id: randomUUID(),
    bookId,
    // QueueJob field name stays "quoteId" for backwards-compat with
    // any in-flight queue entries; it holds a caption id now.
    quoteId: p.caption.id,
    songId: p.song.id,
    requestedAt: now,
    attempts: 0,
  }));
  await enqueueJobs(jobs);
  return NextResponse.json({ enqueued: jobs.length, jobs });
}

export async function GET() {
  const queue = await readQueue();
  return NextResponse.json({ size: queue.length, queue });
}
