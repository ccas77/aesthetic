import { NextResponse } from "next/server";
import { listAllAccounts } from "@/lib/post-bridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/post-bridge/accounts — proxies to PostBridge's social
// account listing across TikTok / Instagram / Facebook. Used by the
// /books UI so the user can select which accounts each book publishes
// to.
export async function GET() {
  if (!process.env.POSTBRIDGE_API_KEY) {
    return NextResponse.json({
      configured: false,
      accounts: [],
      reason: "POSTBRIDGE_API_KEY not set",
    });
  }
  try {
    const accounts = await listAllAccounts();
    return NextResponse.json({ configured: true, accounts });
  } catch (e) {
    return NextResponse.json(
      { configured: false, accounts: [], error: (e as Error).message },
      { status: 502 },
    );
  }
}
