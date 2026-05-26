import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { findBook } from "@/lib/books-store";
import { readManifest } from "@/lib/renders-manifest";
import {
  appendPostQueue,
  readPostQueue,
  type PostQueueEntry,
} from "@/lib/post-queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/posts — list all post-queue entries, newest scheduled
//   first. Used by the Automation page's Queue view.
// POST /api/posts — create a new post-queue entry. Used by the
//   Create page's "Post now" and "Schedule" buttons. The cron
//   drains scheduled entries when their scheduledFor passes.
export async function GET() {
  const entries = await readPostQueue();
  return NextResponse.json({ entries });
}

interface PostBody {
  renderId?: string;
  bookId?: string;
  accountIds?: number[];
  scheduledFor?: string;
  caption?: string;
}

export async function POST(req: Request) {
  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const renderId = body.renderId?.trim();
  const bookId = body.bookId?.trim();
  const accountIds = Array.isArray(body.accountIds)
    ? body.accountIds.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0)
    : [];
  const scheduledFor = body.scheduledFor?.trim() || new Date().toISOString();
  const caption = (body.caption ?? "").trim();
  if (!renderId || !bookId) {
    return NextResponse.json(
      { error: "renderId and bookId required" },
      { status: 400 },
    );
  }
  if (accountIds.length === 0) {
    return NextResponse.json(
      { error: "at least one accountId required" },
      { status: 400 },
    );
  }
  // Verify the book + render exist before queueing the post, so the
  // user gets a clear error instead of a silent dead entry later.
  const book = await findBook(bookId);
  if (!book) {
    return NextResponse.json({ error: "book not found" }, { status: 404 });
  }
  const manifest = await readManifest(bookId);
  const render = manifest.find((r) => r.renderId === renderId);
  if (!render) {
    return NextResponse.json(
      { error: "render not found in book manifest" },
      { status: 404 },
    );
  }

  const entry: PostQueueEntry = {
    id: randomUUID(),
    renderId,
    bookId,
    accountIds,
    scheduledFor,
    status: "scheduled",
    caption,
    attempts: 0,
    createdAt: new Date().toISOString(),
  };
  await appendPostQueue(entry);
  return NextResponse.json({ entry });
}
