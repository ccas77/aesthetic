"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { use } from "react";
import Link from "next/link";
import type { Book, Quote, Song } from "@/lib/books-store";
import type { RenderEntry } from "@/lib/renders-manifest";

export default function BookRendersPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [book, setBook] = useState<Book | null>(null);
  const [renders, setRenders] = useState<RenderEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [bRes, rRes] = await Promise.all([
        fetch("/api/books", { cache: "no-store" }),
        fetch(`/api/books/${id}/renders`, { cache: "no-store" }),
      ]);
      if (bRes.ok) {
        const data = (await bRes.json()) as { books?: Book[] };
        setBook((data.books ?? []).find((b) => b.id === id) ?? null);
      }
      if (rRes.ok) {
        const data = (await rRes.json()) as { renders?: RenderEntry[] };
        setRenders(data.renders ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const quoteById = useMemo(() => {
    const m = new Map<string, Quote>();
    for (const q of book?.quotes ?? []) m.set(q.id, q);
    return m;
  }, [book]);
  const songById = useMemo(() => {
    const m = new Map<string, Song>();
    for (const s of book?.songs ?? []) m.set(s.id, s);
    return m;
  }, [book]);

  return (
    <main className="min-h-screen px-6 md:px-12 py-8 max-w-5xl mx-auto font-sans text-ink">
      <header className="flex items-baseline justify-between mb-6 pb-3 border-b border-line2">
        <div>
          <h1 className="h-serif text-3xl md:text-4xl tracking-tight">
            renders
          </h1>
          {book && (
            <p className="text-sm text-muted mt-1">{book.title}</p>
          )}
        </div>
        <div className="flex items-center gap-4 text-sm">
          <Link
            href="/books"
            className="text-muted hover:text-ink underline underline-offset-4"
          >
            ← all books
          </Link>
          <Link
            href="/"
            className="text-muted hover:text-ink underline underline-offset-4"
          >
            home
          </Link>
        </div>
      </header>

      {loading ? (
        <div className="text-muted text-sm">loading…</div>
      ) : renders.length === 0 ? (
        <div className="text-muted text-sm bg-surface border border-line rounded-md px-4 py-6">
          No renders yet for this book.
        </div>
      ) : (
        <ul className="space-y-4">
          {renders.map((r) => {
            const q = quoteById.get(r.quoteId);
            const s = songById.get(r.songId);
            return (
              <li
                key={r.renderId}
                className="bg-surface border border-line rounded-md px-4 py-4"
              >
                <div className="grid grid-cols-1 md:grid-cols-[14rem_1fr] gap-4 items-start">
                  <video
                    src={r.blobUrl}
                    controls
                    className="w-full max-w-[14rem] border border-line2 rounded"
                  />
                  <div className="space-y-2 text-sm">
                    <div>
                      <span className="text-xs text-muted uppercase tracking-wider">quote</span>
                      <p className="text-ink whitespace-pre-wrap mt-1">
                        {q?.text ?? <em className="text-dim">deleted quote</em>}
                      </p>
                    </div>
                    <div>
                      <span className="text-xs text-muted uppercase tracking-wider">song</span>
                      <div className="text-ink mt-1">
                        {s ? s.title : <em className="text-dim">deleted song</em>}
                        {s?.bpm ? ` · ${s.bpm} bpm` : ""}
                      </div>
                    </div>
                    <div className="text-xs text-muted flex flex-wrap gap-x-4 gap-y-1 pt-2">
                      <span>render: {r.renderId.slice(0, 8)}</span>
                      <span>{r.shotCount} shots · {r.durationSec}s</span>
                      <span>{new Date(r.createdAt).toLocaleString()}</span>
                      {r.postedAt && (
                        <span className="text-ink">posted {new Date(r.postedAt).toLocaleString()}</span>
                      )}
                    </div>
                    <div className="pt-1">
                      <a
                        href={r.blobUrl}
                        download={`${r.renderId}.mp4`}
                        className="text-ink underline underline-offset-4 text-sm hover:text-sepia"
                      >
                        download
                      </a>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
