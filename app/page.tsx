"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Book } from "@/lib/books-store";

type Stage = "idle" | "rendering" | "done";

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

export default function Home() {
  const [books, setBooks] = useState<Book[]>([]);
  const [activeBookId, setActiveBookId] = useState<string | null>(null);
  const [activeQuoteId, setActiveQuoteId] = useState<string>("");
  const [activeSongId, setActiveSongId] = useState<string>("");
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string>("");
  const [result, setResult] = useState<RenderResult | null>(null);

  const refreshBooks = useCallback(async () => {
    const r = await fetch("/api/books", { cache: "no-store" });
    if (!r.ok) return;
    const data = (await r.json()) as { books?: Book[] };
    const list = data.books ?? [];
    setBooks(list);
    return list;
  }, []);

  useEffect(() => {
    void (async () => {
      const list = await refreshBooks();
      if (list && list.length > 0 && !activeBookId) {
        setActiveBookId(list[0].id);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeBook = useMemo(
    () => books.find((b) => b.id === activeBookId) ?? null,
    [books, activeBookId],
  );

  // Reset quote/song selection when switching books.
  useEffect(() => {
    setActiveQuoteId("");
    setActiveSongId("");
    setResult(null);
    setStage("idle");
    setError("");
  }, [activeBookId]);

  const canRender = !!activeBookId && !!activeQuoteId && !!activeSongId;

  const onRender = useCallback(async () => {
    if (!canRender) return;
    setStage("rendering");
    setError("");
    setResult(null);
    try {
      const r = await fetch("/api/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookId: activeBookId,
          quoteId: activeQuoteId,
          songId: activeSongId,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        throw new Error(data.error || `render failed (${r.status})`);
      }
      setResult(data as RenderResult);
      setStage("done");
    } catch (e) {
      setError((e as Error).message);
      setStage("idle");
    }
  }, [canRender, activeBookId, activeQuoteId, activeSongId]);

  return (
    <main className="min-h-screen px-6 md:px-12 py-8 max-w-3xl mx-auto font-sans text-ink">
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

      <section className="mb-8">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted mb-3">
          render
        </h2>
        <div className="bg-surface border border-line rounded-md px-5 py-5 space-y-4">
          <label className="block">
            <span className="text-xs text-muted block mb-1">Book</span>
            {books.length === 0 ? (
              <div className="flex items-center gap-3">
                <span className="text-muted text-sm">no books yet</span>
                <Link
                  href="/books"
                  className="text-sm text-ink underline underline-offset-4"
                >
                  add one
                </Link>
              </div>
            ) : (
              <select
                value={activeBookId ?? ""}
                onChange={(e) => setActiveBookId(e.target.value || null)}
                className="w-full bg-bg border border-line2 rounded px-3 py-2 text-ink focus:border-ink focus:outline-none"
              >
                {books.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.title}
                  </option>
                ))}
              </select>
            )}
          </label>

          {activeBook && (
            <>
              <label className="block">
                <span className="text-xs text-muted block mb-1">Quote</span>
                {(activeBook.quotes ?? []).length === 0 ? (
                  <div className="flex items-center gap-3">
                    <span className="text-muted text-sm">no quotes on this book</span>
                    <Link
                      href="/books"
                      className="text-sm text-ink underline underline-offset-4"
                    >
                      add quotes
                    </Link>
                  </div>
                ) : (
                  <select
                    value={activeQuoteId}
                    onChange={(e) => setActiveQuoteId(e.target.value)}
                    className="w-full bg-bg border border-line2 rounded px-3 py-2 text-ink focus:border-ink focus:outline-none"
                  >
                    <option value="">pick a quote…</option>
                    {(activeBook.quotes ?? []).map((q) => (
                      <option key={q.id} value={q.id}>
                        {q.text.replace(/\s+/g, " ").slice(0, 80)}
                        {q.text.length > 80 ? "…" : ""}
                      </option>
                    ))}
                  </select>
                )}
              </label>

              <label className="block">
                <span className="text-xs text-muted block mb-1">Song</span>
                {(activeBook.songs ?? []).length === 0 ? (
                  <div className="flex items-center gap-3">
                    <span className="text-muted text-sm">no songs on this book</span>
                    <Link
                      href="/books"
                      className="text-sm text-ink underline underline-offset-4"
                    >
                      add songs
                    </Link>
                  </div>
                ) : (
                  <select
                    value={activeSongId}
                    onChange={(e) => setActiveSongId(e.target.value)}
                    className="w-full bg-bg border border-line2 rounded px-3 py-2 text-ink focus:border-ink focus:outline-none"
                  >
                    <option value="">pick a song…</option>
                    {(activeBook.songs ?? []).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.title}
                        {s.bpm ? ` · ${s.bpm} bpm` : ""}
                      </option>
                    ))}
                  </select>
                )}
              </label>
            </>
          )}

          <div className="flex items-center gap-4 pt-2">
            <button
              onClick={onRender}
              disabled={!canRender || stage === "rendering"}
              className="px-5 py-2.5 bg-ink text-bg rounded hover:bg-sepia transition-colors disabled:bg-line2 disabled:text-dim disabled:cursor-not-allowed"
            >
              {stage === "rendering" ? "rendering…" : "render video"}
            </button>
            {stage === "rendering" && (
              <span className="text-sm text-muted">
                30 to 90 seconds on the server
              </span>
            )}
            {error && (
              <span className="text-red-700 text-sm break-words">{error}</span>
            )}
          </div>
        </div>
      </section>

      {stage === "done" && result && (
        <section className="mb-8">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted mb-3">
            result
          </h2>
          <div className="bg-surface border border-line rounded-md px-5 py-5 space-y-4">
            <video
              src={result.blobUrl}
              controls
              className="w-full max-w-xs mx-auto border border-line2 rounded"
            />
            <div className="text-xs text-muted space-y-1">
              <div>render id: <span className="text-ink">{result.renderId}</span></div>
              <div>{result.shotCount} shots · {result.durationSec}s</div>
            </div>
            <div className="grid grid-cols-2 gap-3 max-w-xs mx-auto">
              <a
                href={result.blobUrl}
                download={`${result.renderId}.mp4`}
                className="py-2 bg-ink text-bg rounded text-center hover:bg-sepia transition-colors"
              >
                download
              </a>
              <button
                onClick={() => {
                  setResult(null);
                  setStage("idle");
                }}
                className="py-2 border border-line2 rounded text-muted hover:border-ink hover:text-ink transition-colors"
              >
                another
              </button>
            </div>
          </div>
        </section>
      )}

      <footer className="mt-16 pt-4 border-t border-line text-xs text-dim flex justify-between">
        <span>server-rendered</span>
        <span>aesthetic / 2026</span>
      </footer>
    </main>
  );
}
