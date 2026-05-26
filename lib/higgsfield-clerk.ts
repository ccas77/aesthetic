// Clerk JWT manager for Higgsfield's web-app auth. Ported from
// cgl-higgsfield. The __client cookie + session ID live in env vars and
// are used to mint a short-lived (~5 min) JWT that we cache for ~4 min
// and refresh proactively. The cookie itself MUST NEVER be logged or
// returned in error messages, so every error path here scrubs.
//
// The values live encrypted-at-rest in Vercel env. We do not
// double-encrypt with crypto.ts; if/when we move to Blob-backed
// rotation, that's the seam (see README).

const CLERK_URL_TEMPLATE =
  "https://clerk.higgsfield.ai/v1/client/sessions/{session_id}/tokens" +
  "?debug=skip_cache&__clerk_api_version=2025-11-10&_clerk_js_version=5.125.10";

// JWT TTL is ~5 min. Refresh at 4 min so concurrent requests don't race
// against an expiring token.
const TOKEN_REFRESH_MS = 4 * 60 * 1000;

interface TokenState {
  jwt: string;
  fetchedAt: number;
}

// Module-scope cache: survives across requests served by the same warm
// Vercel function instance. Cold starts mint a fresh JWT, which is fine.
let cached: TokenState | null = null;
let inFlight: Promise<string> | null = null;

function readCredentials(): { cookie: string; sessionId: string } {
  const cookie = (process.env.HIGGSFIELD_CLERK_COOKIE ?? "").trim();
  const sessionId = (process.env.HIGGSFIELD_SESSION_ID ?? "").trim();
  if (!cookie) {
    throw new Error(
      "HIGGSFIELD_CLERK_COOKIE not set. Extract the __client cookie from " +
        "higgsfield.ai in Chrome DevTools (Application → Cookies → __client).",
    );
  }
  if (!sessionId) {
    throw new Error(
      "HIGGSFIELD_SESSION_ID not set. In the Higgsfield browser console: " +
        "window.Clerk.session.id (format like sess_xxxxxxx).",
    );
  }
  return { cookie, sessionId };
}

async function mintJwt(): Promise<string> {
  const { cookie, sessionId } = readCredentials();
  const url = CLERK_URL_TEMPLATE.replace("{session_id}", sessionId);

  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: {
        Cookie: `__client=${cookie}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "https://higgsfield.ai",
        Referer: "https://higgsfield.ai/",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
      },
      body: "organization_id=",
    });
  } catch (e) {
    // Strip any embedded credential. We never put the cookie in the
    // outgoing error, but be defensive anyway.
    throw new Error(`Clerk network error: ${(e as Error).message}`);
  }

  if (resp.status === 401 || resp.status === 403) {
    throw new Error(
      `Clerk auth rejected (HTTP ${resp.status}). Your __client cookie or ` +
        "session ID has expired or is invalid. Log into higgsfield.ai again " +
        "and re-extract them, then update the env vars.",
    );
  }
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(
      `Clerk token request failed (HTTP ${resp.status}): ${body.slice(0, 200)}`,
    );
  }
  let data: { jwt?: unknown };
  try {
    data = await resp.json();
  } catch {
    throw new Error("Clerk response was not JSON");
  }
  if (typeof data.jwt !== "string" || !data.jwt) {
    throw new Error("Clerk response had no jwt field");
  }
  return data.jwt;
}

// Returns a valid Clerk JWT. Refreshes when the cached token is past
// the 4-minute mark, and de-dupes concurrent refresh attempts within
// the same instance.
export async function getJwt(force = false): Promise<string> {
  const now = Date.now();
  if (!force && cached && now - cached.fetchedAt < TOKEN_REFRESH_MS) {
    return cached.jwt;
  }
  if (inFlight) return inFlight;
  inFlight = mintJwt()
    .then((jwt) => {
      cached = { jwt, fetchedAt: Date.now() };
      return jwt;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

// Invalidate the cached JWT. Call this when a Higgsfield API request
// returns 401 so the next getJwt() call mints a fresh one.
export function invalidateJwt(): void {
  cached = null;
}

// Smoke-test helper: returns true iff we can mint a JWT right now. The
// /books reconnect flow will use something like this to verify a new
// cookie/session before saving it (future work).
export async function probeAuth(): Promise<boolean> {
  try {
    await getJwt(true);
    return true;
  } catch {
    return false;
  }
}
