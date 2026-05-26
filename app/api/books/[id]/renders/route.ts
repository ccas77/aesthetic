import { NextResponse } from "next/server";
import { readManifest } from "@/lib/renders-manifest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/books/[id]/renders — returns the book's manifest, newest first.
export async function GET(_req: Request, { params }: RouteParams) {
  const { id } = await params;
  const renders = await readManifest(id);
  const sorted = [...renders].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  return NextResponse.json({ renders: sorted });
}
