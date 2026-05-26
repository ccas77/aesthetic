"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Book } from "@/lib/books-store";
import type { RenderEntry } from "@/lib/renders-manifest";

interface QueueJob {
  id: string;
  bookId: string;
  quoteId: string;
  songId: string;
  requestedAt: string;
  attempts: number;
}

export default function Home() {
  const [books, setBooks] = useState<Book[]>([]);
  const [activeBookId, setActiveBookId] = useState<string | null>(null);
  const [queue, setQueue] = useState<QueueJob[]>([]);
  const [renders, setRenders] = useState<RenderEntry[]>([]);
  const [queueCount, setQueueCount] = useState<number>(1);
  const [enqueuing, setEnqueuing] = useState(false);
  const [enqueueMsg, setEnqueueMsg] = useState<string>("");

  const refreshBooks = useCallback(async () => {
    const r = await fetch("/api/books", { cache: "no-store" });
    if (!r.ok) return [];
    const data = (await r.json()) as { books?: Book[] };
    const list = data.books ?? [];
    setBooks(list);
    return list;
  }, []);

  const refreshQueue = useCallback(async () => {
    const r = await fetch("/api/admin/queue-renders", { cache: "no-store" });
    if (!r.ok) return;
    const data = (await r.json()) as { queue?: QueueJob[] };
    setQueue(data.queue ?? []);
  }, []);

  const refreshRenders = useCallback(async (bookId: string | null) => {
    if (!bookId) {
      setRenders([]);
      return;
    }
    const r = await fetch(`/api/books/${bookId}/renders`, { cache: "no-store" });
    if (!r.ok) return;
    const data = (await r.json()) as { renders?: RenderEntry[] };
    setRenders(data.renders ?? []);
  }, []);

  useEffect(() => {
    void (async () => {
      const list = await refreshBooks();
      if (list.length > 0 && !activeBookId) setActiveBookId(list[0].id);
      void refreshQueue();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void refreshRenders(activeBookId);
  }, [activeBookId, refreshRenders]);

  const activeBook = useMemo(
    () => books.find((b) => b.id === activeBookId) ?? null,
    [books, activeBookId],
  );

  const activeQueue = useMemo(
    () => queue.filter((j) => j.bookId === activeBookId),
    [queue, activeBookId],
  );

  const quoteCount = (activeBook?.quotes ?? []).length;
  const songCount = (activeBook?.songs ?? []).length;
  const totalPairs = quoteCount * songCount;
  const renderedPairKeys = useMemo(
    () => new Set(renders.map((r) => `${r.quoteId}::${r.songId}`)),
    [renders],
  );
  const unrenderedPairs = Math.max(0, totalPairs - renderedPairKeys.size);

  const canEnqueue =
    !!activeBookId && quoteCount > 0 && songCount > 0 && queueCount > 0;

  const onEnqueue = useCallback(async () => {
    if (!canEnqueue) return;
    setEnqueuing(true);
    setEnqueueMsg("");
    try {
      const r = await fetch("/api/admin/queue-renders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookId: activeBookId, count: queueCount }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        setEnqueueMsg(data.error || `enqueue failed (${r.status})`);
      } else {
        setEnqueueMsg(`queued ${data.enqueued} render${data.enqueued === 1 ? "" : "s"}`);
        await refreshQueue();
      }
    } catch (e) {
      setEnqueueMsg((e as Error).message);
    } finally {
      setEnqueuing(false);
    }
  }, [canEnqueue, activeBookId, queueCount, refreshQueue]);

  const recentRenders = renders.slice(0, 5);

  return (
    <main className="min-h-screen px-6 md:px-12 py-8 max-w-4xl mx-auto font-sans text-ink">
      <header className="flex items-baseline justify-between mb-8 pb-3 border-b border-line2">
        <h1 className="h-serif text-3xl md:text-4xl tracking-tight">
          aesthetic<span className="text-sepia">.</span>
        </h1>
        <Link
          href="/books"
          className="text-sm text-muted hover:text-ink underline underline-offset-4"
        >
          manage books →
        </Link>
      </header>

      <div className="mb-8 flex flex-wrap items-center gap-3">
        <span className="text-xs text-muted uppercase tracking-wider">book</span>
        {books.length === 0 ? (
          <Link
            href="/books"
            className="text-sm text-ink underline underline-offset-4"
          >
            add your first book
          </Link>
        ) : (
          <select
            value={activeBookId ?? ""}
            onChange={(e) => setActiveBookId(e.target.value || null)}
            className="bg-bg border border-line2 rounded px-3 py-1.5 text-ink focus:border-ink focus:outline-none"
          >
            {books.map((b) => (
              <option key={b.id} value={b.id}>
                {b.title}
              </option>
            ))}
          </select>
        )}
        {activeBookId && (
          <Link
            href={`/books/${activeBookId}/renders`}
            className="ml-auto text-sm text-muted hover:text-ink underline underline-offset-4"
          >
            render history →
          </Link>
        )}
      </div>

      {activeBook && (quoteCount === 0 || songCount === 0) && (
        <section className="mb-8 bg-surface border border-line rounded-md px-4 py-4">
          <h2 className="text-sm font-semibold text-ink">
            {activeBook.title} isn&rsquo;t ready to render
          </h2>
          <p className="text-sm text-muted mt-1">
            Add at least one quote and one song before queueing.
          </p>
          <Link
            href="/books"
            className="inline-block mt-3 px-4 py-2 bg-ink text-bg rounded hover:bg-sepia transition-colors"
          >
            edit book
          </Link>
        </section>
      )}

      {activeBook && quoteCount > 0 && songCount > 0 && (
        <section className="mb-8">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted mb-3">
            queue
          </h2>
          <div className="bg-surface border border-line rounded-md px-5 py-5 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
              <Stat label="queued for this book" value={activeQueue.length} />
              <Stat label="total queue" value={queue.length} />
              <Stat
                label="unrendered pairs"
                value={`${unrenderedPairs} / ${totalPairs}`}
              />
            </div>
            <p className="text-xs text-muted">
              Pairs are picked round-robin through every (quote, song) combination. Cron drains
              one job per tick on the 0/30 minute schedule.
            </p>
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <label className="text-xs text-muted">
                count
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={queueCount}
                  onChange={(e) =>
                    setQueueCount(Math.max(1, Math.min(100, Number(e.target.value) || 1)))
                  }
                  className="ml-2 w-20 bg-bg border border-line2 rounded px-2 py-1.5 text-ink focus:border-ink focus:outline-none"
                />
              </label>
              <button
                onClick={onEnqueue}
                disabled={!canEnqueue || enqueuing}
                className="px-5 py-2 bg-ink text-bg rounded hover:bg-sepia transition-colors disabled:bg-line2 disabled:text-dim disabled:cursor-not-allowed"
              >
                {enqueuing ? "queueing…" : `queue ${queueCount} render${queueCount === 1 ? "" : "s"}`}
              </button>
              {enqueueMsg && (
                <span className="text-sm text-muted">{enqueueMsg}</span>
              )}
            </div>
          </div>
        </section>
      )}

      {activeBook && (
        <section className="mb-8">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted mb-3">
            recent renders
          </h2>
          {recentRenders.length === 0 ? (
            <div className="text-sm text-muted bg-surface border border-line rounded-md px-4 py-5">
              No renders for this book yet. Queue some above.
            </div>
          ) : (
            <ul className="space-y-3">
              {recentRenders.map((r) => (
                <li
                  key={r.renderId}
                  className="bg-surface border border-line rounded-md px-4 py-3 flex items-center gap-4"
                >
                  <video
                    src={r.blobUrl}
                    className="w-20 h-32 object-cover rounded border border-line2"
                  />
                  <div className="flex-1 min-w-0 text-sm">
                    <div className="text-xs text-muted">
                      {new Date(r.createdAt).toLocaleString()} · {r.shotCount} shots · {r.durationSec}s
                    </div>
                    <div className="text-ink mt-1 line-clamp-2">
                      {activeBook.quotes?.find((q) => q.id === r.quoteId)?.text ?? (
                        <em className="text-dim">deleted quote</em>
                      )}
                    </div>
                  </div>
                  <a
                    href={r.blobUrl}
                    download={`${r.renderId}.mp4`}
                    className="text-sm text-ink underline underline-offset-4 hover:text-sepia shrink-0"
                  >
                    download
                  </a>
                </li>
              ))}
            </ul>
          )}
          {renders.length > 5 && (
            <div className="mt-3 text-right">
              <Link
                href={`/books/${activeBook.id}/renders`}
                className="text-sm text-muted hover:text-ink underline underline-offset-4"
              >
                view all {renders.length} renders →
              </Link>
            </div>
          )}
        </section>
      )}

      <footer className="mt-12 pt-4 border-t border-line text-xs text-dim flex justify-between">
        <span>server-rendered · cron drained · single-tenant</span>
        <span>aesthetic / 2026</span>
      </footer>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="text-xs text-muted uppercase tracking-wider">{label}</div>
      <div className="text-2xl text-ink h-serif">{value}</div>
    </div>
  );
}
