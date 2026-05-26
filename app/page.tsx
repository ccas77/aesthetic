"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Book } from "@/lib/books-store";

interface BridgeAccount {
  id: number;
  username: string;
  platform: "tiktok" | "instagram" | "facebook";
}

interface RenderResult {
  ok: true;
  renderId: string;
  bookId: string;
  quoteId: string;
  songId: string;
  blobUrl: string;
  durationSec: number;
  shotCount: number;
  stillIds: string[];
}

interface BookLibraryStill {
  id: string;
  url: string;
}

type Stage = "idle" | "rendering" | "done";

const NO_PICK = "__NONE__";

export default function CreatePage() {
  const [books, setBooks] = useState<Book[]>([]);
  const [activeBookId, setActiveBookId] = useState<string | null>(null);
  const [activeCaptionId, setActiveCaptionId] = useState("");

  // Stills available for the active book: book's library + shared pool.
  // Used to show thumbnails of what'll likely be picked. The renderer
  // re-picks server-side so the thumbnails are a preview, not a binding.
  const [bookStills, setBookStills] = useState<BookLibraryStill[]>([]);
  const [sharedStills, setSharedStills] = useState<BookLibraryStill[]>([]);

  const [stage, setStage] = useState<Stage>("idle");
  const [renderError, setRenderError] = useState<string>("");
  const [result, setResult] = useState<RenderResult | null>(null);

  // Post / schedule controls (visible after a render lands).
  const [accounts, setAccounts] = useState<BridgeAccount[] | null>(null);
  const [accountsError, setAccountsError] = useState<string>("");
  const [postAccountId, setPostAccountId] = useState<string>("");
  const [scheduleAt, setScheduleAt] = useState<string>("");
  const [posting, setPosting] = useState(false);
  const [postMsg, setPostMsg] = useState<string>("");

  useEffect(() => {
    void (async () => {
      const r = await fetch("/api/books", { cache: "no-store" });
      if (!r.ok) return;
      const data = (await r.json()) as { books?: Book[] };
      const list = data.books ?? [];
      setBooks(list);
      if (list.length > 0) setActiveBookId(list[0].id);
    })();
  }, []);

  const activeBook = useMemo(
    () => books.find((b) => b.id === activeBookId) ?? null,
    [books, activeBookId],
  );

  useEffect(() => {
    setActiveCaptionId("");
    setResult(null);
    setStage("idle");
    setRenderError("");
    setBookStills([]);
    setPostMsg("");
    if (!activeBookId) return;
    void (async () => {
      const lr = await fetch(
        `/api/library?bookId=${encodeURIComponent(activeBookId)}`,
        { cache: "no-store" },
      );
      if (lr.ok) {
        const data = (await lr.json()) as { stills?: BookLibraryStill[] };
        setBookStills(data.stills ?? []);
      }
    })();
  }, [activeBookId]);

  useEffect(() => {
    void (async () => {
      const r = await fetch("/api/shared", { cache: "no-store" });
      if (!r.ok) return;
      const data = (await r.json()) as {
        stills?: Array<{ id: string; url: string }>;
      };
      setSharedStills(data.stills ?? []);
    })();
  }, []);

  // Lazy-load PostBridge accounts the first time the user reaches the
  // post controls (after a render lands).
  useEffect(() => {
    if (stage !== "done" || accounts !== null) return;
    void (async () => {
      try {
        const r = await fetch("/api/post-bridge/accounts", {
          cache: "no-store",
        });
        if (!r.ok) {
          setAccounts([]);
          setAccountsError(`fetch failed (${r.status})`);
          return;
        }
        const data = (await r.json()) as {
          configured?: boolean;
          accounts?: BridgeAccount[];
          reason?: string;
        };
        setAccounts(data.accounts ?? []);
        if (data.configured === false) {
          setAccountsError(data.reason || "PostBridge not configured");
        }
      } catch (e) {
        setAccounts([]);
        setAccountsError((e as Error).message);
      }
    })();
  }, [stage, accounts]);

  // Auto-pick: every render, the renderer shuffles the combined pool
  // and pins fresh-first-two. We display a small preview of the pool
  // here, with a "shuffle preview" hint that re-rolls the visible
  // sample.
  const [previewSeed, setPreviewSeed] = useState(0);
  const previewPool = useMemo(
    () => [...bookStills, ...sharedStills],
    [bookStills, sharedStills],
  );
  const previewSample = useMemo(() => {
    const arr = [...previewPool];
    // Stable shuffle using previewSeed.
    let seed = previewSeed || 1;
    const rng = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    arr.sort(() => rng() - 0.5);
    return arr.slice(0, 6);
  }, [previewPool, previewSeed]);

  const captions = activeBook?.captions ?? [];
  const hasSongs = (activeBook?.songs ?? []).length > 0;

  const onRender = useCallback(async () => {
    if (!activeBook || !activeCaptionId) return;
    const songPool = activeBook.songs ?? [];
    if (songPool.length === 0) return;
    const song = songPool[Math.floor(Math.random() * songPool.length)];
    setStage("rendering");
    setRenderError("");
    setResult(null);
    try {
      const r = await fetch("/api/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookId: activeBook.id,
          quoteId: activeCaptionId,
          songId: song.id,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        throw new Error(data.error || `render failed (${r.status})`);
      }
      setResult(data as RenderResult);
      setStage("done");
    } catch (e) {
      setRenderError((e as Error).message);
      setStage("idle");
    }
  }, [activeBook, activeCaptionId]);

  const onPost = useCallback(
    async (when: "now" | "schedule") => {
      if (!result || !activeBook) return;
      if (!postAccountId || postAccountId === NO_PICK) {
        setPostMsg("pick an account first");
        return;
      }
      const scheduledFor =
        when === "now"
          ? new Date().toISOString()
          : scheduleAt
            ? new Date(scheduleAt).toISOString()
            : "";
      if (when === "schedule" && !scheduledFor) {
        setPostMsg("pick a date/time first");
        return;
      }
      setPosting(true);
      setPostMsg("");
      try {
        const caption =
          (activeBook.captions ?? []).find((c) => c.id === result.quoteId)?.text ?? "";
        const fullCaption =
          caption + (activeBook.captionSuffix ? `\n\n${activeBook.captionSuffix}` : "");
        const r = await fetch("/api/posts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            renderId: result.renderId,
            bookId: result.bookId,
            accountIds: [Number(postAccountId)],
            scheduledFor,
            caption: fullCaption,
          }),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
          throw new Error(data.error || `queue failed (${r.status})`);
        }
        setPostMsg(
          when === "now"
            ? "queued for immediate post (cron drains every 30 min)"
            : `scheduled for ${new Date(scheduledFor).toLocaleString()}`,
        );
      } catch (e) {
        setPostMsg((e as Error).message);
      } finally {
        setPosting(false);
      }
    },
    [result, activeBook, postAccountId, scheduleAt],
  );

  const canRender =
    !!activeBook && !!activeCaptionId && captions.length > 0 && hasSongs;

  // Default the schedule datetime input to "1 hour from now" in local time.
  const defaultScheduleValue = useMemo(() => {
    const d = new Date(Date.now() + 60 * 60 * 1000);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }, [result]);

  return (
    <main className="max-w-3xl mx-auto px-6 md:px-12 py-8 font-sans text-ink">
      <h1 className="text-sm font-semibold uppercase tracking-wider text-muted mb-4">
        create
      </h1>

      {books.length === 0 ? (
        <div className="bg-surface border border-line rounded-md px-5 py-5">
          <p className="text-ink">No books yet.</p>
          <p className="text-sm text-muted mt-1">
            Add one before you can render anything.
          </p>
          <Link
            href="/books"
            className="inline-block mt-3 px-4 py-2 bg-ink text-bg rounded hover:bg-sepia transition-colors"
          >
            Go to Books
          </Link>
        </div>
      ) : (
        <section className="bg-surface border border-line rounded-md px-5 py-5 space-y-4">
          <label className="block">
            <span className="text-xs text-muted block mb-1">Book</span>
            <select
              value={activeBookId ?? ""}
              onChange={(e) => setActiveBookId(e.target.value || null)}
              className="w-full bg-bg border border-line2 rounded px-3 py-2 focus:border-ink focus:outline-none"
            >
              {books.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title}
                </option>
              ))}
            </select>
          </label>

          {activeBook && (
            <>
              {captions.length === 0 || !hasSongs ? (
                <div className="text-sm text-muted bg-bg border border-line rounded px-3 py-3">
                  <div className="text-ink mb-1">
                    {activeBook.title} isn&rsquo;t ready to render.
                  </div>
                  Needs at least one caption and one song.{" "}
                  <Link
                    href="/books"
                    className="text-ink underline underline-offset-4"
                  >
                    edit on Books
                  </Link>
                  .
                </div>
              ) : (
                <label className="block">
                  <span className="text-xs text-muted block mb-1">Caption</span>
                  <select
                    value={activeCaptionId}
                    onChange={(e) => setActiveCaptionId(e.target.value)}
                    className="w-full bg-bg border border-line2 rounded px-3 py-2 focus:border-ink focus:outline-none"
                  >
                    <option value="">pick a caption…</option>
                    {captions.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.text.replace(/\s+/g, " ").slice(0, 80)}
                        {c.text.length > 80 ? "…" : ""}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {captions.length > 0 && hasSongs && previewPool.length > 0 && (
                <div>
                  <div className="text-xs text-muted mb-2 flex items-center justify-between">
                    <span>
                      Images (auto-picked at render; {previewPool.length} in pool)
                    </span>
                    <button
                      onClick={() => setPreviewSeed((s) => s + 1)}
                      className="text-muted hover:text-ink underline underline-offset-4"
                    >
                      shuffle preview
                    </button>
                  </div>
                  <ul className="grid grid-cols-3 md:grid-cols-6 gap-2">
                    {previewSample.map((s) => (
                      <li key={s.id}>
                        <img
                          src={s.url}
                          alt=""
                          className="w-full aspect-[2/3] object-cover rounded border border-line2"
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={onRender}
                  disabled={!canRender || stage === "rendering"}
                  className="px-5 py-2.5 bg-ink text-bg rounded hover:bg-sepia transition-colors disabled:bg-line2 disabled:text-dim disabled:cursor-not-allowed"
                >
                  {stage === "rendering" ? "rendering…" : "Generate"}
                </button>
                {stage === "rendering" && (
                  <span className="text-sm text-muted">
                    30 to 90 seconds on the server
                  </span>
                )}
                {renderError && (
                  <span className="text-sm text-red-700 break-words">
                    {renderError}
                  </span>
                )}
              </div>
            </>
          )}
        </section>
      )}

      {stage === "done" && result && activeBook && (
        <section className="mt-8 bg-surface border border-line rounded-md px-5 py-5 space-y-4">
          <video
            src={result.blobUrl}
            controls
            className="w-full max-w-xs mx-auto border border-line2 rounded"
          />
          <div className="text-xs text-muted text-center">
            {result.shotCount} shots · {result.durationSec}s · {result.renderId.slice(0, 8)}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-3 border-t border-line">
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">
                Post now
              </h2>
              <AccountPicker
                accounts={accounts}
                accountsError={accountsError}
                value={postAccountId}
                onChange={setPostAccountId}
              />
              <button
                onClick={() => onPost("now")}
                disabled={posting || !accounts || accounts.length === 0}
                className="mt-3 px-4 py-2 bg-ink text-bg rounded hover:bg-sepia transition-colors disabled:bg-line2 disabled:text-dim disabled:cursor-not-allowed"
              >
                {posting ? "queueing…" : "Post now"}
              </button>
            </div>
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">
                Schedule
              </h2>
              <AccountPicker
                accounts={accounts}
                accountsError={accountsError}
                value={postAccountId}
                onChange={setPostAccountId}
              />
              <input
                type="datetime-local"
                value={scheduleAt || defaultScheduleValue}
                onChange={(e) => setScheduleAt(e.target.value)}
                className="mt-2 w-full bg-bg border border-line2 rounded px-3 py-2 focus:border-ink focus:outline-none"
              />
              <button
                onClick={() => onPost("schedule")}
                disabled={posting || !accounts || accounts.length === 0}
                className="mt-3 px-4 py-2 border border-line2 text-ink rounded hover:bg-ink hover:text-bg transition-colors disabled:text-dim disabled:cursor-not-allowed"
              >
                {posting ? "queueing…" : "Schedule"}
              </button>
            </div>
          </div>

          {postMsg && (
            <div className="text-sm text-muted bg-bg border border-line rounded px-3 py-2">
              {postMsg}
            </div>
          )}

          <div className="flex items-center gap-4 pt-3 border-t border-line">
            <a
              href={result.blobUrl}
              download={`${result.renderId}.mp4`}
              className="text-sm text-ink underline underline-offset-4 hover:text-sepia"
            >
              download
            </a>
            <button
              onClick={() => {
                setResult(null);
                setStage("idle");
                setPostMsg("");
                setScheduleAt("");
              }}
              className="text-sm text-muted hover:text-ink underline underline-offset-4"
            >
              another
            </button>
          </div>
        </section>
      )}
    </main>
  );
}

function AccountPicker({
  accounts,
  accountsError,
  value,
  onChange,
}: {
  accounts: BridgeAccount[] | null;
  accountsError: string;
  value: string;
  onChange: (v: string) => void;
}) {
  if (accounts === null) {
    return <div className="text-sm text-muted">loading accounts…</div>;
  }
  if (accountsError) {
    return (
      <div className="text-sm text-red-700">{accountsError}</div>
    );
  }
  if (accounts.length === 0) {
    return (
      <div className="text-sm text-muted">
        No PostBridge accounts connected.{" "}
        <Link
          href="/automation"
          className="text-ink underline underline-offset-4"
        >
          add accounts
        </Link>
      </div>
    );
  }
  const grouped = new Map<BridgeAccount["platform"], BridgeAccount[]>();
  for (const a of accounts) {
    const arr = grouped.get(a.platform) ?? [];
    arr.push(a);
    grouped.set(a.platform, arr);
  }
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-bg border border-line2 rounded px-3 py-2 text-sm focus:border-ink focus:outline-none"
    >
      <option value="">pick an account…</option>
      {Array.from(grouped.entries()).map(([platform, list]) => (
        <optgroup key={platform} label={platform}>
          {list.map((a) => (
            <option key={`${platform}:${a.id}`} value={String(a.id)}>
              @{a.username}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
