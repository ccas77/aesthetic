import { NextResponse } from "next/server";
import { readPostQueue, writePostQueue } from "@/lib/post-queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// DELETE /api/posts/[id] — cancels a scheduled post. If the post
// has already run (status !== "scheduled") the operation is a no-op.
export async function DELETE(_req: Request, { params }: RouteParams) {
  const { id } = await params;
  const entries = await readPostQueue();
  const idx = entries.findIndex((e) => e.id === id);
  if (idx === -1) {
    return NextResponse.json({ error: "post not found" }, { status: 404 });
  }
  if (entries[idx].status !== "scheduled") {
    return NextResponse.json(
      { error: `post is ${entries[idx].status}, not scheduled` },
      { status: 409 },
    );
  }
  entries[idx] = { ...entries[idx], status: "cancelled" };
  await writePostQueue(entries);
  return NextResponse.json({ ok: true });
}
