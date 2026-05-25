import { cookies } from "next/headers";

// Anonymous user identity. Stored as a UUID in a cookie; auto-created on first
// API access. No login required — the cookie is the identity.
export async function getOrCreateUserId(): Promise<string> {
  const jar = await cookies();
  const existing = jar.get("uid")?.value;
  if (existing && /^[a-f0-9-]{36}$/i.test(existing)) return existing;
  const fresh = crypto.randomUUID();
  jar.set("uid", fresh, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365 * 2, // 2 years
    path: "/",
  });
  return fresh;
}

// Path conventions for Blob storage.
export const blobKeys = {
  state: (uid: string) => `users/${uid}/state.json`,
  audio: (uid: string) => `users/${uid}/audio.mp3`,
};

export interface UserState {
  quote: string;
  audioUrl: string | null;
  audioName: string | null;
  audioSize: number | null;
}

export const emptyState: UserState = {
  quote: "",
  audioUrl: null,
  audioName: null,
  audioSize: null,
};
