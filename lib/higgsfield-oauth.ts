import { createHash, randomBytes } from "node:crypto";
import { decryptToken, encryptToken } from "./crypto";
import {
  deleteTokenRow,
  readTokenRow,
  writeTokenRow,
  type TokenRow,
} from "./higgsfield-store";

// MCP OAuth 2.1 client for Higgsfield. Adapted from tslides/lib/oauth.ts,
// but token state lives in Vercel Blob (see higgsfield-store.ts) instead of
// a Postgres row, since aesthetic has no DB.

export const HIGGSFIELD_BASE =
  process.env.HIGGSFIELD_BASE || "https://mcp.higgsfield.ai";

type OAuthMetadata = {
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
};

type DcrResponse = {
  client_id: string;
  client_secret?: string;
};

type TokenResponse = {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
};

export const PKCE_COOKIE = "aesthetic_oauth_pkce";
export const PKCE_COOKIE_MAX_AGE = 10 * 60;

export function encodePkceCookie(state: string, verifier: string): string {
  return encryptToken(JSON.stringify({ state, verifier }));
}

export function decodePkceCookie(
  raw: string | undefined,
): { state: string; verifier: string } | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(decryptToken(raw)) as {
      state?: unknown;
      verifier?: unknown;
    };
    if (typeof parsed.state !== "string" || typeof parsed.verifier !== "string")
      return null;
    return { state: parsed.state, verifier: parsed.verifier };
  } catch {
    return null;
  }
}

async function metadata(): Promise<OAuthMetadata> {
  const res = await fetch(
    `${HIGGSFIELD_BASE}/.well-known/oauth-authorization-server`,
  );
  if (!res.ok) throw new Error(`oauth metadata: ${res.status}`);
  return res.json();
}

async function ensureClient(redirectUri: string): Promise<{
  clientId: string;
  clientSecret: string | null;
}> {
  const existing = await readTokenRow();
  if (existing?.clientId) {
    return {
      clientId: existing.clientId,
      clientSecret: existing.clientSecretEnc
        ? decryptToken(existing.clientSecretEnc)
        : null,
    };
  }

  const meta = await metadata();
  if (!meta.registration_endpoint) {
    throw new Error("provider does not support dynamic client registration");
  }
  const res = await fetch(meta.registration_endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "Aesthetic",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: "openid email offline_access",
    }),
  });
  if (!res.ok) {
    throw new Error(`DCR failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as DcrResponse;

  const placeholder: TokenRow = {
    clientId: data.client_id,
    clientSecretEnc: data.client_secret
      ? encryptToken(data.client_secret)
      : undefined,
    accessTokenEnc: encryptToken(""),
    scopes: [],
    updatedAt: new Date().toISOString(),
  };
  await writeTokenRow(placeholder);
  return {
    clientId: data.client_id,
    clientSecret: data.client_secret ?? null,
  };
}

function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export async function buildAuthorizeUrl(redirectUri: string): Promise<{
  url: string;
  state: string;
  verifier: string;
}> {
  const meta = await metadata();
  const { clientId } = await ensureClient(redirectUri);
  const { verifier, challenge } = pkce();
  const state = randomBytes(16).toString("base64url");

  const url = new URL(meta.authorization_endpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", "openid email offline_access");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return { url: url.toString(), state, verifier };
}

export async function exchangeCode(
  code: string,
  verifier: string,
  redirectUri: string,
): Promise<void> {
  const meta = await metadata();
  const row = await readTokenRow();
  if (!row) throw new Error("no registered client - call ensureClient first");

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: row.clientId,
    code_verifier: verifier,
  });
  if (row.clientSecretEnc) {
    body.set("client_secret", decryptToken(row.clientSecretEnc));
  }
  const res = await fetch(meta.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`token exchange failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as TokenResponse;
  await persistTokens(row, data);
}

async function persistTokens(
  row: TokenRow,
  data: TokenResponse,
): Promise<void> {
  const updated: TokenRow = {
    clientId: row.clientId,
    clientSecretEnc: row.clientSecretEnc,
    accessTokenEnc: encryptToken(data.access_token),
    refreshTokenEnc: data.refresh_token
      ? encryptToken(data.refresh_token)
      : row.refreshTokenEnc,
    expiresAt: data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000).toISOString()
      : undefined,
    scopes: data.scope ? data.scope.split(/\s+/) : [],
    updatedAt: new Date().toISOString(),
  };
  await writeTokenRow(updated);
}

async function refresh(): Promise<string> {
  const row = await readTokenRow();
  if (!row?.refreshTokenEnc) throw new Error("no refresh token");
  const meta = await metadata();
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: decryptToken(row.refreshTokenEnc),
    client_id: row.clientId,
  });
  if (row.clientSecretEnc) {
    body.set("client_secret", decryptToken(row.clientSecretEnc));
  }
  const res = await fetch(meta.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`refresh failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as TokenResponse;
  await persistTokens(row, data);
  return data.access_token;
}

export async function getAccessToken(): Promise<string | null> {
  const row = await readTokenRow();
  if (!row) return null;
  const access = row.accessTokenEnc ? decryptToken(row.accessTokenEnc) : "";
  if (!access) return null;
  if (row.expiresAt) {
    const expiresMs = new Date(row.expiresAt).getTime();
    if (expiresMs - Date.now() < 60_000) {
      if (row.refreshTokenEnc) return refresh();
      return null;
    }
  }
  return access;
}

export async function isConnected(): Promise<boolean> {
  return !!(await getAccessToken());
}

export async function disconnect(): Promise<void> {
  await deleteTokenRow();
}
