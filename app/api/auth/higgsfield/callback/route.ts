import { NextResponse } from "next/server";
import {
  decodePkceCookie,
  exchangeCode,
  PKCE_COOKIE,
} from "@/lib/higgsfield-oauth";

export const runtime = "nodejs";

function redirectUri(req: Request): string {
  const u = new URL(req.url);
  return `${u.origin}/api/auth/higgsfield/callback`;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  if (error) {
    return NextResponse.redirect(
      `${url.origin}/?higgsfield=denied&reason=${encodeURIComponent(error)}`,
    );
  }
  if (!code || !state) {
    return NextResponse.json(
      { error: "missing_code_or_state" },
      { status: 400 },
    );
  }

  const cookie = req.headers.get("cookie") ?? "";
  const raw = cookie
    .split(/;\s*/)
    .map((c) => c.split("="))
    .find(([k]) => k === PKCE_COOKIE)?.[1];
  const decoded = decodePkceCookie(raw ? decodeURIComponent(raw) : undefined);
  if (!decoded || decoded.state !== state) {
    return NextResponse.json(
      { error: "invalid_state - start the flow again" },
      { status: 400 },
    );
  }
  try {
    await exchangeCode(code, decoded.verifier, redirectUri(req));
    const res = NextResponse.redirect(`${url.origin}/?higgsfield=connected`);
    res.cookies.set(PKCE_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
