import { NextResponse } from "next/server";
import { del } from "@vercel/blob";
import { readFiller, writeFiller } from "@/lib/filler-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: Request, { params }: RouteParams) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "BLOB_READ_WRITE_TOKEN not set" },
      { status: 503 },
    );
  }
  const { id } = await params;
  let body: { label?: unknown; prompt?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const stills = await readFiller();
  const idx = stills.findIndex((s) => s.id === id);
  if (idx === -1) {
    return NextResponse.json({ error: "filler not found" }, { status: 404 });
  }
  if (typeof body.label === "string" && body.label.trim()) {
    stills[idx].label = body.label.trim();
  }
  if (typeof body.prompt === "string") {
    stills[idx].prompt = body.prompt.trim() || undefined;
  }
  await writeFiller(stills);
  return NextResponse.json({ still: stills[idx] });
}

export async function DELETE(_req: Request, { params }: RouteParams) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "BLOB_READ_WRITE_TOKEN not set" },
      { status: 503 },
    );
  }
  const { id } = await params;
  const stills = await readFiller();
  const target = stills.find((s) => s.id === id);
  if (!target) {
    return NextResponse.json({ error: "filler not found" }, { status: 404 });
  }
  const next = stills.filter((s) => s.id !== id);
  await writeFiller(next);
  // Best-effort: only delete the blob if it lives under our system/filler/
  // namespace. Legacy library/* URLs (auto-seeded migrations) we leave alone.
  if (target.url.includes("/system/filler/")) {
    try {
      await del(target.url);
    } catch (e) {
      console.error("filler blob delete failed", e);
    }
  }
  return NextResponse.json({ ok: true });
}
