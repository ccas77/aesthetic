import { NextResponse } from "next/server";
import {
  buildAuthorizeUrl,
  encodePkceCookie,
  PKCE_COOKIE,
  PKCE_COOKIE_MAX_AGE,
} from "@/lib/higgsfield-oauth";

export const runtime = "nodejs";

function redirectUri(req: Request): string {
  const u = new URL(req.url);
  return `${u.origin}/api/auth/higgsfield/callback`;
}

export async function GET(req: Request) {
  try {
    const { url, state, verifier } = await buildAuthorizeUrl(redirectUri(req));
    const res = NextResponse.redirect(url);
    res.cookies.set(PKCE_COOKIE, encodePkceCookie(state, verifier), {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: PKCE_COOKIE_MAX_AGE,
    });
    return res;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
