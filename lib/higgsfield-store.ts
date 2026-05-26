import { put, list } from "@vercel/blob";

// Single-tenant token store, backed by Vercel Blob since aesthetic has no DB.
// The Blob is publicly addressable by URL, but the access/refresh tokens
// inside are encrypted at rest with HIGGSFIELD_TOKEN_SECRET (see lib/crypto.ts).

const TOKEN_PATH = "system/higgsfield-token.json";

export interface TokenRow {
  clientId: string;
  clientSecretEnc?: string;
  accessTokenEnc: string;
  refreshTokenEnc?: string;
  expiresAt?: string;
  scopes: string[];
  updatedAt: string;
}

async function findExistingUrl(): Promise<string | null> {
  const { blobs } = await list({ prefix: TOKEN_PATH, limit: 1 });
  const exact = blobs.find((b) => b.pathname === TOKEN_PATH);
  return exact?.url ?? null;
}

export async function readTokenRow(): Promise<TokenRow | null> {
  const url = await findExistingUrl();
  if (!url) return null;
  // Bust the Blob CDN cache so refreshed tokens are immediately visible.
  const res = await fetch(`${url}?_=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) return null;
  try {
    return (await res.json()) as TokenRow;
  } catch {
    return null;
  }
}

export async function writeTokenRow(row: TokenRow): Promise<void> {
  await put(TOKEN_PATH, JSON.stringify(row), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    // Mutable metadata; bypass CDN cache so subsequent reads see writes.
    cacheControlMaxAge: 0,
  });
}

export async function deleteTokenRow(): Promise<void> {
  const { del } = await import("@vercel/blob");
  const url = await findExistingUrl();
  if (url) await del(url);
}
