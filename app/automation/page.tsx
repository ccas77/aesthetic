"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Book } from "@/lib/books-store";
import type { PostQueueEntry } from "@/lib/post-queue";

interface BridgeAccount {
  id: number;
  username: string;
  platform: "tiktok" | "instagram" | "facebook";
}

export default function AutomationPage() {
  const [accounts, setAccounts] = useState<BridgeAccount[] | null>(null);
  const [accountsError, setAccountsError] = useState<string>("");
  const [queue, setQueue] = useState<PostQueueEntry[]>([]);
  const [books, setBooks] = useState<Book[]>([]);

  const refreshAccounts = useCallback(async () => {
    try {
      const r = await fetch("/api/post-bridge/accounts", { cache: "no-store" });
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
      } else {
        setAccountsError("");
      }
    } catch (e) {
      setAccounts([]);
      setAccountsError((e as Error).message);
    }
  }, []);

  const refreshQueue = useCallback(async () => {
    const r = await fetch("/api/posts", { cache: "no-store" });
    if (!r.ok) return;
    const data = (await r.json()) as { entries?: PostQueueEntry[] };
    setQueue(data.entries ?? []);
  }, []);

  const refreshBooks = useCallback(async () => {
    const r = await fetch("/api/books", { cache: "no-store" });
    if (!r.ok) return;
    const data = (await r.json()) as { books?: Book[] };
    setBooks(data.books ?? []);
  }, []);

  useEffect(() => {
    void refreshAccounts();
    void refreshQueue();
    void refreshBooks();
  }, [refreshAccounts, refreshQueue, refreshBooks]);

  const accountsById = useMemo(() => {
    const m = new Map<number, BridgeAccount>();
    for (const a of accounts ?? []) m.set(a.id, a);
    return m;
  }, [accounts]);
  const bookById = useMemo(() => {
    const m = new Map<string, Book>();
    for (const b of books) m.set(b.id, b);
    return m;
  }, [books]);

  const sortedQueue = useMemo(() => {
    return [...queue].sort((a, b) =>
      a.scheduledFor.localeCompare(b.scheduledFor),
    );
  }, [queue]);

  const cancel = useCallback(
    async (id: string) => {
      if (!confirm("Cancel this scheduled post?")) return;
      const r = await fetch(`/api/posts/${id}`, { method: "DELETE" });
      if (r.ok) await refreshQueue();
    },
    [refreshQueue],
  );

  return (
    <main className="max-w-5xl mx-auto px-6 md:px-12 py-8 font-sans text-ink space-y-12">
      <h1 className="text-sm font-semibold uppercase tracking-wider text-muted">
        automation
      </h1>

      <section>
        <h2 className="text-xs text-muted uppercase tracking-wider mb-2">
          accounts · {accounts?.length ?? 0}
        </h2>
        <p className="text-xs text-dim mb-3">
          Read-only mirror of accounts connected to your PostBridge workspace at{" "}
          <a
            href="https://post-bridge.com"
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-4 hover:text-ink"
          >
            post-bridge.com
          </a>
          . Add or remove accounts there; this list refreshes on reload.
        </p>
        {accounts === null && (
          <div className="text-sm text-muted">loading…</div>
        )}
        {accounts && accountsError && (
          <div className="text-sm text-red-700">{accountsError}</div>
        )}
        {accounts && !accountsError && accounts.length === 0 && (
          <div className="text-sm text-muted bg-surface border border-line rounded px-3 py-3">
            No social accounts connected.
          </div>
        )}
        {accounts && accounts.length > 0 && (
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {accounts.map((a) => (
              <li
                key={`${a.platform}:${a.id}`}
                className="bg-bg border border-line rounded px-3 py-2 flex items-center gap-3 text-sm"
              >
                <span className="text-xs uppercase tracking-wider text-muted w-20 shrink-0">
                  {a.platform}
                </span>
                <span className="text-ink truncate">@{a.username}</span>
                <span className="text-xs text-dim ml-auto">#{a.id}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-xs text-muted uppercase tracking-wider mb-2">
          queue · {sortedQueue.length}
        </h2>
        <p className="text-xs text-dim mb-3">
          Scheduled, pending, posted, and failed entries. Autoposting is gated
          by the <code>POSTBRIDGE_AUTOPOST_ENABLED</code> env var; until it&rsquo;s
          set to <code>true</code>, the cron at <code>/api/cron/post</code>{" "}
          dry-runs and entries here just sit at <em>scheduled</em>.
        </p>
        {sortedQueue.length === 0 ? (
          <div className="text-sm text-muted bg-surface border border-line rounded px-3 py-3">
            Queue is empty. Use{" "}
            <Link href="/" className="text-ink underline underline-offset-4">
              Create
            </Link>{" "}
            to render something and schedule a post.
          </div>
        ) : (
          <ul className="space-y-2">
            {sortedQueue.map((e) => {
              const book = bookById.get(e.bookId);
              const accountSummary = e.accountIds
                .map((id) => {
                  const a = accountsById.get(id);
                  return a ? `${a.platform}/@${a.username}` : `#${id}`;
                })
                .join(", ");
              return (
                <li
                  key={e.id}
                  className="bg-bg border border-line rounded-md px-4 py-3 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-3">
                      <span
                        className={`text-xs uppercase tracking-wider ${statusClass(e.status)}`}
                      >
                        {e.status}
                      </span>
                      <span className="text-sm text-ink truncate">
                        {book?.title ?? "(deleted book)"} · {accountSummary}
                      </span>
                    </div>
                    <div className="text-xs text-muted mt-1">
                      {fmtDate(e.scheduledFor)}
                      {e.postedAt && ` · posted ${fmtDate(e.postedAt)}`}
                    </div>
                    {e.caption && (
                      <div className="text-sm text-muted mt-1 line-clamp-2 whitespace-pre-wrap">
                        {e.caption}
                      </div>
                    )}
                    {e.lastError && (
                      <div className="text-sm text-red-700 mt-1 break-words">
                        {e.lastError}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-2 items-end text-sm shrink-0">
                    {e.status === "scheduled" && (
                      <button
                        onClick={() => cancel(e.id)}
                        className="text-red-700 hover:text-red-900"
                      >
                        cancel
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-xs text-muted uppercase tracking-wider mb-2">
          stats
        </h2>
        <div className="bg-surface border border-line rounded-md px-4 py-6 text-sm text-muted">
          Analytics coming. The plan is: per-post views/likes/comments pulled from
          PostBridge analytics, grouped by book, with a 24h delta strip.
        </div>
      </section>
    </main>
  );
}

function statusClass(status: PostQueueEntry["status"]): string {
  switch (status) {
    case "posted":
      return "text-emerald-700";
    case "failed":
      return "text-red-700";
    case "cancelled":
      return "text-dim";
    default:
      return "text-muted";
  }
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}
