import { NextResponse } from "next/server";
import { del } from "@vercel/blob";
import { readShared, writeShared } from "@/lib/shared-store";

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
  const stills = await readShared();
  const idx = stills.findIndex((s) => s.id === id);
  if (idx === -1) {
    return NextResponse.json({ error: "still not found" }, { status: 404 });
  }
  if (typeof body.label === "string" && body.label.trim()) {
    stills[idx].label = body.label.trim();
  }
  if (typeof body.prompt === "string") {
    stills[idx].prompt = body.prompt.trim() || undefined;
  }
  await writeShared(stills);
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
  const stills = await readShared();
  const target = stills.find((s) => s.id === id);
  if (!target) {
    return NextResponse.json({ error: "still not found" }, { status: 404 });
  }
  await writeShared(stills.filter((s) => s.id !== id));
  // Only delete the blob if it lives in our shared/filler namespace.
  // Legacy library/*.jpg URLs (auto-seeded) are left alone.
  if (
    target.url.includes("/system/shared/") ||
    target.url.includes("/system/filler/")
  ) {
    try {
      await del(target.url);
    } catch (e) {
      console.error("shared blob delete failed", e);
    }
  }
  return NextResponse.json({ ok: true });
}
