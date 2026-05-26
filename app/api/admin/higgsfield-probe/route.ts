import { NextResponse } from "next/server";
import { probeAuth, getJwt } from "@/lib/higgsfield-clerk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/admin/higgsfield-probe
// Verifies that HIGGSFIELD_CLERK_COOKIE + HIGGSFIELD_SESSION_ID are
// configured and can mint a Clerk JWT, then fetches the user's account
// info from fnf.higgsfield.ai/user. Useful for:
//   - confirming the new auth pipeline works before firing a generation
//   - checking the has_unlim flag and credit balance, so the user can
//     verify that subsequent unlimited generations don't decrement it
//
// Never echoes the cookie/session ID itself, only the derived account
// info from Higgsfield.
export async function GET() {
  const ok = await probeAuth();
  if (!ok) {
    return NextResponse.json(
      {
        ok: false,
        reason:
          "could not mint Clerk JWT. Check HIGGSFIELD_CLERK_COOKIE and HIGGSFIELD_SESSION_ID.",
      },
      { status: 503 },
    );
  }
  try {
    const jwt = await getJwt();
    const resp = await fetch("https://fnf.higgsfield.ai/user", {
      headers: {
        Authorization: `Bearer ${jwt}`,
        Origin: "https://higgsfield.ai",
        Referer: "https://higgsfield.ai/",
        Accept: "application/json",
      },
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      return NextResponse.json(
        {
          ok: false,
          reason: `fnf /user returned HTTP ${resp.status}`,
          body: body.slice(0, 400),
        },
        { status: 502 },
      );
    }
    const user = (await resp.json()) as Record<string, unknown>;
    return NextResponse.json({ ok: true, user });
  } catch (e) {
    return NextResponse.json(
      { ok: false, reason: (e as Error).message },
      { status: 500 },
    );
  }
}
