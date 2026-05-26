// PostBridge client. Ported from my-toolkit/patterns/postbridge/post-bridge.ts
// with an extra uploadVideo path since aesthetic publishes MP4 videos, not
// image carousels.

const PB_BASE = "https://api.post-bridge.com";
const MAX_RETRIES = 3;

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  retries = MAX_RETRIES,
): Promise<Response> {
  const res = await fetch(url, init);
  if (res.status === 429 && retries > 0) {
    const wait = Math.pow(2, MAX_RETRIES - retries) * 1000;
    await new Promise((r) => setTimeout(r, wait));
    return fetchWithRetry(url, init, retries - 1);
  }
  return res;
}

async function pbFetch(path: string, init: RequestInit = {}) {
  const key = process.env.POSTBRIDGE_API_KEY;
  if (!key) throw new Error("POSTBRIDGE_API_KEY not set");
  const res = await fetchWithRetry(`${PB_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`post-bridge ${path} ${res.status}: ${body.slice(0, 500)}`);
  }
  return res.json();
}

export type Platform = "tiktok" | "instagram" | "facebook";

export interface BridgeAccount {
  id: number;
  username: string;
  platform: Platform;
}

export async function listAllAccounts(): Promise<BridgeAccount[]> {
  const platforms: Platform[] = ["tiktok", "instagram", "facebook"];
  const responses = await Promise.all(
    platforms.map((p) =>
      pbFetch(`/v1/social-accounts?platform=${p}&limit=100`).catch(() => ({
        data: [],
      })),
    ),
  );
  const out: BridgeAccount[] = [];
  for (let i = 0; i < platforms.length; i++) {
    for (const a of (responses[i] as { data?: { id: number; username: string }[] }).data ||
      []) {
      out.push({ id: a.id, username: a.username, platform: platforms[i] });
    }
  }
  return out;
}

// Two-step media upload: ask PostBridge for a presigned URL, then PUT
// the bytes to S3. Returns the media_id to attach to the post body.
export async function uploadVideo(
  buffer: Buffer,
  name: string,
): Promise<string> {
  const upload = await pbFetch("/v1/media/create-upload-url", {
    method: "POST",
    body: JSON.stringify({
      name,
      mime_type: "video/mp4",
      size_bytes: buffer.length,
    }),
  });
  const putRes = await fetch(upload.upload_url, {
    method: "PUT",
    headers: { "Content-Type": "video/mp4" },
    body: new Uint8Array(buffer),
  });
  if (!putRes.ok) {
    const t = await putRes.text();
    throw new Error(`S3 upload failed: ${putRes.status} ${t.slice(0, 300)}`);
  }
  return upload.media_id as string;
}

export interface PostOptions {
  caption: string;
  mediaIds: string[];
  accountIds: number[];
  scheduledAt?: string;
  // Platform-specific configs. TikTok requires is_aigc:true for AI
  // generated content and we always pass that for renders coming out
  // of this app.
  platforms?: {
    tiktok?: { draft?: boolean; is_aigc?: boolean };
    instagram?: Record<string, unknown>;
    facebook?: Record<string, unknown>;
  };
}

export async function createPost(opts: PostOptions): Promise<string> {
  const body: Record<string, unknown> = {
    caption: opts.caption,
    media: opts.mediaIds,
    social_accounts: opts.accountIds,
    platform_configurations: opts.platforms ?? {
      tiktok: { draft: false, is_aigc: true },
      instagram: {},
      facebook: {},
    },
  };
  if (opts.scheduledAt) body.scheduled_at = opts.scheduledAt;
  const resp = await pbFetch("/v1/posts", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return (resp.id || resp.data?.id || "unknown") as string;
}
