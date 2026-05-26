"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Book, BookCategory, Quote, Song } from "@/lib/books-store";
import type { FillerStill } from "@/lib/filler-store";

export default function BooksPage() {
  const [books, setBooks] = useState<Book[]>([]);
  const [filler, setFiller] = useState<FillerStill[]>([]);
  const [stillsByBook, setStillsByBook] = useState<Record<string, Set<string>>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const refreshBooks = useCallback(async () => {
    const r = await fetch("/api/books", { cache: "no-store" });
    if (!r.ok) return;
    const data = (await r.json()) as { books?: Book[] };
    const list = data.books ?? [];
    setBooks(list);
    // Refresh library presence for each book in parallel.
    const entries = await Promise.all(
      list.map(async (b) => {
        try {
          const lr = await fetch(`/api/library?bookId=${encodeURIComponent(b.id)}`, {
            cache: "no-store",
          });
          if (!lr.ok) return [b.id, new Set<string>()] as const;
          const d = (await lr.json()) as { stills?: Array<{ id: string }> };
          return [b.id, new Set((d.stills ?? []).map((s) => s.id))] as const;
        } catch {
          return [b.id, new Set<string>()] as const;
        }
      }),
    );
    setStillsByBook(Object.fromEntries(entries));
  }, []);

  const refreshFiller = useCallback(async () => {
    const r = await fetch("/api/filler", { cache: "no-store" });
    if (!r.ok) return;
    const data = (await r.json()) as { stills?: FillerStill[] };
    setFiller(data.stills ?? []);
  }, []);

  useEffect(() => {
    void refreshBooks();
    void refreshFiller();
  }, [refreshBooks, refreshFiller]);

  return (
    <main className="min-h-screen px-6 md:px-12 py-8 max-w-5xl mx-auto font-sans text-ink">
      <header className="flex items-baseline justify-between mb-8 pb-3 border-b border-line2">
        <h1 className="h-serif text-3xl md:text-4xl tracking-tight">books</h1>
        <Link
          href="/"
          className="text-sm text-muted hover:text-ink underline underline-offset-4"
        >
          ← back to render
        </Link>
      </header>

      <section className="mb-12">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted mb-3">
          add a book
        </h2>
        <AddBookForm
          books={books}
          onCreated={async (newId) => {
            await refreshBooks();
            setExpandedId(newId);
          }}
        />
      </section>

      <section className="mb-12">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted mb-3">
          your books · {books.length}
        </h2>
        {books.length === 0 ? (
          <div className="text-muted text-sm bg-surface border border-line px-4 py-6 rounded-md">
            No books yet. Add one above to get started.
          </div>
        ) : (
          <ul className="space-y-3">
            {books.map((b) => (
              <li key={b.id}>
                <BookCard
                  book={b}
                  stillIds={stillsByBook[b.id] ?? new Set()}
                  expanded={expandedId === b.id}
                  onToggle={() =>
                    setExpandedId((prev) => (prev === b.id ? null : b.id))
                  }
                  onChanged={refreshBooks}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mb-16">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted mb-3">
          filler stills · {filler.length}
        </h2>
        <p className="text-sm text-muted mb-4">
          Shared across all books. Used as fallback variety at render time.
        </p>
        <FillerManager filler={filler} onChanged={refreshFiller} />
      </section>
    </main>
  );
}

function AddBookForm({
  books,
  onCreated,
}: {
  books: Book[];
  onCreated: (newId: string) => void | Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [cover, setCover] = useState<File | null>(null);
  const [copyFromId, setCopyFromId] = useState("");
  const [stylePrompt, setStylePrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const submit = useCallback(async () => {
    if (!title.trim() || !cover) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const form = new FormData();
      form.append("title", title.trim());
      form.append("cover", cover);
      if (copyFromId) form.append("copyFromBookId", copyFromId);
      if (stylePrompt.trim()) form.append("stylePrompt", stylePrompt.trim());
      const r = await fetch("/api/books", { method: "POST", body: form });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || `create failed (${r.status})`);
      }
      const data = (await r.json()) as { book: Book };
      setSuccess(`added "${data.book.title}"`);
      setTitle("");
      setCover(null);
      setCopyFromId("");
      setStylePrompt("");
      await onCreated(data.book.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [title, cover, copyFromId, stylePrompt, onCreated]);

  return (
    <div className="bg-surface border border-line rounded-md px-4 py-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label className="block">
          <span className="text-xs text-muted block mb-1">Title</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="book title"
            className="w-full bg-bg border border-line2 rounded px-3 py-2 text-ink placeholder:text-dim focus:border-ink focus:outline-none"
          />
        </label>
        <div>
          <span className="text-xs text-muted block mb-1">Cover image</span>
          <label className="inline-flex items-center gap-3 cursor-pointer">
            <span className="px-3 py-2 border border-line2 rounded bg-bg text-ink hover:bg-ink hover:text-bg transition-colors">
              {cover ? "Replace image" : "Choose image"}
            </span>
            <span className="text-sm text-muted">
              {cover
                ? `${cover.name} · ${(cover.size / 1024).toFixed(0)} kb`
                : "no file chosen"}
            </span>
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(e) => setCover(e.target.files?.[0] ?? null)}
            />
          </label>
        </div>
        {books.length > 0 && (
          <label className="block md:col-span-2">
            <span className="text-xs text-muted block mb-1">
              Copy categories from (optional)
            </span>
            <select
              value={copyFromId}
              onChange={(e) => setCopyFromId(e.target.value)}
              className="w-full bg-bg border border-line2 rounded px-3 py-2 text-ink focus:border-ink focus:outline-none"
            >
              <option value="">start with no categories</option>
              {books.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title} ({b.categories.length})
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="block md:col-span-2">
          <span className="text-xs text-muted block mb-1">
            Style brief (optional)
          </span>
          <textarea
            value={stylePrompt}
            onChange={(e) => setStylePrompt(e.target.value)}
            placeholder="e.g. black-dominant low-key photography, shadow-weighted exposure, suppressed midtones, near-monochromatic palette…"
            rows={3}
            className="w-full bg-bg border border-line2 rounded px-3 py-2 text-sm focus:border-ink focus:outline-none resize-y"
          />
          <span className="text-xs text-dim block mt-1">
            Prepended to every category prompt when generating this book&rsquo;s stills.
            Leave blank if you want category prompts to stand alone.
          </span>
        </label>
      </div>
      <div className="flex items-center gap-3 mt-4">
        <button
          onClick={submit}
          disabled={!title.trim() || !cover || busy}
          className="px-5 py-2 bg-ink text-bg rounded hover:bg-sepia transition-colors disabled:bg-line2 disabled:text-dim disabled:cursor-not-allowed"
        >
          {busy ? "creating…" : "Create book"}
        </button>
        {error && <span className="text-red-700 text-sm">{error}</span>}
        {success && !error && (
          <span className="text-muted text-sm">{success}</span>
        )}
      </div>
    </div>
  );
}

function BookCard({
  book,
  stillIds,
  expanded,
  onToggle,
  onChanged,
}: {
  book: Book;
  stillIds: Set<string>;
  expanded: boolean;
  onToggle: () => void;
  onChanged: () => Promise<void> | void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState(book.title);
  const completeCount = book.categories.filter((c) => stillIds.has(c.id)).length;

  const saveRename = useCallback(async () => {
    if (!titleDraft.trim() || titleDraft.trim() === book.title) {
      setRenaming(false);
      return;
    }
    const r = await fetch(`/api/books/${book.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: titleDraft.trim() }),
    });
    if (r.ok) await onChanged();
    setRenaming(false);
  }, [titleDraft, book.title, book.id, onChanged]);

  const onDelete = useCallback(async () => {
    if (
      !confirm(
        `Delete "${book.title}"? This removes its cover and all generated stills.`,
      )
    ) {
      return;
    }
    const r = await fetch(`/api/books/${book.id}`, { method: "DELETE" });
    if (r.ok) await onChanged();
  }, [book.id, book.title, onChanged]);

  return (
    <article className="border border-line rounded-md bg-bg overflow-hidden">
      <div className="flex items-center gap-4 px-4 py-3">
        <img
          src={book.coverUrl}
          alt=""
          className="w-12 h-16 object-cover rounded border border-line2"
        />
        <div className="flex-1 min-w-0">
          {renaming ? (
            <div className="flex gap-2">
              <input
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void saveRename();
                  if (e.key === "Escape") {
                    setTitleDraft(book.title);
                    setRenaming(false);
                  }
                }}
                autoFocus
                className="flex-1 bg-bg border border-line2 rounded px-2 py-1 text-ink focus:border-ink focus:outline-none"
              />
              <button
                onClick={saveRename}
                className="text-sm text-muted hover:text-ink"
              >
                save
              </button>
            </div>
          ) : (
            <>
              <h3 className="h-serif text-xl text-ink leading-tight truncate">
                {book.title}
              </h3>
              <div className="text-xs text-muted mt-0.5">
                {book.categories.length} categories ·{" "}
                {completeCount}/{book.categories.length} stills ready
              </div>
            </>
          )}
        </div>
        <div className="flex items-center gap-3 text-sm">
          <button onClick={() => setRenaming((v) => !v)} className="text-muted hover:text-ink">
            rename
          </button>
          <button onClick={onDelete} className="text-red-700 hover:text-red-900">
            delete
          </button>
          <button
            onClick={onToggle}
            className="px-3 py-1.5 border border-line2 rounded text-ink hover:bg-ink hover:text-bg transition-colors"
          >
            {expanded ? "close" : "categories"}
          </button>
        </div>
      </div>
      {expanded && (
        <div className="border-t border-line bg-surface px-4 py-5 space-y-8">
          <StyleEditor book={book} onChanged={onChanged} />
          <CategoryManager
            book={book}
            stillIds={stillIds}
            onChanged={onChanged}
          />
          <QuotesManager book={book} onChanged={onChanged} />
          <SongsManager book={book} onChanged={onChanged} />
        </div>
      )}
    </article>
  );
}

function QuotesManager({
  book,
  onChanged,
}: {
  book: Book;
  onChanged: () => Promise<void> | void;
}) {
  const [bulk, setBulk] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState("");

  const [single, setSingle] = useState("");
  const [singleBusy, setSingleBusy] = useState(false);

  const quotes = book.quotes ?? [];

  const addBulk = useCallback(async () => {
    setBulkError("");
    // Each PARAGRAPH (blank-line-separated block) becomes one quote so a
    // multi-line quote with internal line breaks survives the paste.
    const blocks = bulk
      .split(/\n\s*\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (blocks.length === 0) return;
    setBulkBusy(true);
    try {
      const r = await fetch(`/api/books/${book.id}/quotes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texts: blocks }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || `add failed (${r.status})`);
      }
      setBulk("");
      await onChanged();
    } catch (e) {
      setBulkError((e as Error).message);
    } finally {
      setBulkBusy(false);
    }
  }, [bulk, book.id, onChanged]);

  const addSingle = useCallback(async () => {
    if (!single.trim()) return;
    setSingleBusy(true);
    try {
      const r = await fetch(`/api/books/${book.id}/quotes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: single.trim() }),
      });
      if (r.ok) {
        setSingle("");
        await onChanged();
      }
    } finally {
      setSingleBusy(false);
    }
  }, [single, book.id, onChanged]);

  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">
        quotes · {quotes.length}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block">
            <span className="text-xs text-muted block mb-1">Bulk paste</span>
            <textarea
              value={bulk}
              onChange={(e) => setBulk(e.target.value)}
              placeholder={"Separate each quote with a blank line.\n\nLine breaks within a quote are preserved."}
              rows={5}
              className="w-full bg-bg border border-line2 rounded px-3 py-2 text-sm focus:border-ink focus:outline-none resize-y"
            />
            <span className="text-xs text-dim block mt-1">
              One quote per blank-line-separated block. Newlines inside a block stay intact.
            </span>
          </label>
          {bulkError && <div className="text-red-700 text-sm mt-2">{bulkError}</div>}
          <button
            onClick={addBulk}
            disabled={!bulk.trim() || bulkBusy}
            className="mt-2 px-4 py-1.5 bg-ink text-bg rounded hover:bg-sepia transition-colors disabled:bg-line2 disabled:text-dim disabled:cursor-not-allowed"
          >
            {bulkBusy ? "adding…" : "Add all"}
          </button>
        </div>
        <div>
          <label className="block">
            <span className="text-xs text-muted block mb-1">Add one</span>
            <textarea
              value={single}
              onChange={(e) => setSingle(e.target.value)}
              rows={5}
              placeholder="A single quote, line breaks allowed"
              className="w-full bg-bg border border-line2 rounded px-3 py-2 text-sm focus:border-ink focus:outline-none resize-y"
            />
          </label>
          <button
            onClick={addSingle}
            disabled={!single.trim() || singleBusy}
            className="mt-2 px-4 py-1.5 border border-line2 text-ink rounded hover:bg-ink hover:text-bg transition-colors disabled:text-dim disabled:cursor-not-allowed"
          >
            {singleBusy ? "adding…" : "Add"}
          </button>
        </div>
      </div>
      {quotes.length > 0 && (
        <ul className="mt-5 space-y-2">
          {quotes.map((q) => (
            <li key={q.id}>
              <QuoteRow bookId={book.id} quote={q} onChanged={onChanged} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function QuoteRow({
  bookId,
  quote,
  onChanged,
}: {
  bookId: string;
  quote: Quote;
  onChanged: () => Promise<void> | void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(quote.text);
  const [busy, setBusy] = useState(false);

  const save = useCallback(async () => {
    if (!draft.trim() || draft.trim() === quote.text) {
      setEditing(false);
      return;
    }
    setBusy(true);
    try {
      const r = await fetch(`/api/books/${bookId}/quotes/${quote.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: draft.trim() }),
      });
      if (r.ok) {
        setEditing(false);
        await onChanged();
      }
    } finally {
      setBusy(false);
    }
  }, [draft, quote.text, quote.id, bookId, onChanged]);

  const remove = useCallback(async () => {
    if (!confirm("Remove this quote?")) return;
    setBusy(true);
    const r = await fetch(`/api/books/${bookId}/quotes/${quote.id}`, {
      method: "DELETE",
    });
    if (r.ok) await onChanged();
    setBusy(false);
  }, [bookId, quote.id, onChanged]);

  return (
    <div className="bg-bg border border-line rounded-md px-3 py-2">
      {editing ? (
        <div className="space-y-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            className="w-full bg-bg border border-line2 rounded px-2 py-1 text-sm focus:border-ink focus:outline-none resize-y"
          />
          <div className="flex gap-3 text-sm">
            <button
              onClick={save}
              disabled={busy || !draft.trim()}
              className="text-ink hover:text-sepia disabled:text-dim"
            >
              {busy ? "saving…" : "save"}
            </button>
            <button
              onClick={() => {
                setDraft(quote.text);
                setEditing(false);
              }}
              className="text-muted hover:text-ink"
            >
              cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0 whitespace-pre-wrap text-sm text-ink leading-relaxed">
            {quote.text}
          </div>
          <div className="flex flex-col gap-1 text-sm shrink-0">
            <button
              onClick={() => setEditing(true)}
              disabled={busy}
              className="text-muted hover:text-ink"
            >
              edit
            </button>
            <button
              onClick={remove}
              disabled={busy}
              className="text-red-700 hover:text-red-900"
            >
              remove
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SongsManager({
  book,
  onChanged,
}: {
  book: Book;
  onChanged: () => Promise<void> | void;
}) {
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [bpm, setBpm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const songs = book.songs ?? [];

  const submit = useCallback(async () => {
    if (!title.trim() || !file) return;
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.append("title", title.trim());
      form.append("file", file);
      if (bpm.trim() && Number.isFinite(Number(bpm))) form.append("bpm", bpm.trim());
      const r = await fetch(`/api/books/${book.id}/songs`, {
        method: "POST",
        body: form,
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || `upload failed (${r.status})`);
      }
      setTitle("");
      setFile(null);
      setBpm("");
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [title, file, bpm, book.id, onChanged]);

  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">
        songs · {songs.length}
      </div>
      <div className="bg-bg border border-line rounded-md px-4 py-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs text-muted block mb-1">Title</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="song title"
              className="w-full bg-bg border border-line2 rounded px-3 py-2 focus:border-ink focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="text-xs text-muted block mb-1">BPM (optional)</span>
            <input
              value={bpm}
              onChange={(e) => setBpm(e.target.value)}
              placeholder="80"
              inputMode="numeric"
              className="w-full bg-bg border border-line2 rounded px-3 py-2 focus:border-ink focus:outline-none"
            />
            <span className="text-xs text-dim block mt-1">
              Leave blank and the renderer assumes 80 bpm.
            </span>
          </label>
        </div>
        <div>
          <span className="text-xs text-muted block mb-1">Audio file</span>
          <label className="inline-flex items-center gap-3 cursor-pointer">
            <span className="px-3 py-2 border border-line2 rounded bg-bg text-ink hover:bg-ink hover:text-bg transition-colors">
              {file ? "Replace audio" : "Choose audio"}
            </span>
            <span className="text-sm text-muted">
              {file
                ? `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB`
                : "no file chosen"}
            </span>
            <input
              type="file"
              accept="audio/*"
              className="sr-only"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={submit}
            disabled={!title.trim() || !file || busy}
            className="px-5 py-2 bg-ink text-bg rounded hover:bg-sepia transition-colors disabled:bg-line2 disabled:text-dim disabled:cursor-not-allowed"
          >
            {busy ? "uploading…" : "Upload song"}
          </button>
          {error && <span className="text-red-700 text-sm">{error}</span>}
        </div>
      </div>
      {songs.length > 0 && (
        <ul className="mt-4 space-y-2">
          {songs.map((s) => (
            <li key={s.id}>
              <SongRow bookId={book.id} song={s} onChanged={onChanged} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SongRow({
  bookId,
  song,
  onChanged,
}: {
  bookId: string;
  song: Song;
  onChanged: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);

  const remove = useCallback(async () => {
    if (!confirm(`Remove "${song.title}"?`)) return;
    setBusy(true);
    const r = await fetch(`/api/books/${bookId}/songs/${song.id}`, {
      method: "DELETE",
    });
    if (r.ok) await onChanged();
    setBusy(false);
  }, [bookId, song.id, song.title, onChanged]);

  return (
    <div className="bg-bg border border-line rounded-md px-3 py-3 flex items-center gap-3">
      <audio src={song.url} controls className="h-8 max-w-xs" />
      <div className="flex-1 min-w-0">
        <div className="text-ink truncate">{song.title}</div>
        <div className="text-xs text-muted">
          {song.bpm ? `${song.bpm} bpm · ` : ""}
          {song.durationSec ? `${song.durationSec.toFixed(0)}s` : ""}
        </div>
      </div>
      <button
        onClick={remove}
        disabled={busy}
        className="text-red-700 hover:text-red-900 text-sm"
      >
        remove
      </button>
    </div>
  );
}

function StyleEditor({
  book,
  onChanged,
}: {
  book: Book;
  onChanged: () => Promise<void> | void;
}) {
  const [draft, setDraft] = useState(book.stylePrompt ?? "");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const dirty = (book.stylePrompt ?? "") !== draft;

  const save = useCallback(async () => {
    setBusy(true);
    setStatus("");
    try {
      const r = await fetch(`/api/books/${book.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stylePrompt: draft }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || `save failed (${r.status})`);
      }
      setStatus("saved");
      await onChanged();
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [book.id, draft, onChanged]);

  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">
        style brief
      </div>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="e.g. black-dominant low-key photography, shadow-weighted exposure, suppressed midtones…"
        rows={4}
        className="w-full bg-bg border border-line2 rounded px-3 py-2 text-sm focus:border-ink focus:outline-none resize-y"
      />
      <div className="text-xs text-dim mt-1">
        Prepended to every category prompt when generating this book&rsquo;s stills. Leave blank for none.
      </div>
      <div className="flex items-center gap-3 mt-2">
        <button
          onClick={save}
          disabled={busy || !dirty}
          className="px-4 py-1.5 bg-ink text-bg rounded hover:bg-sepia transition-colors disabled:bg-line2 disabled:text-dim disabled:cursor-not-allowed"
        >
          {busy ? "saving…" : "Save style"}
        </button>
        {status && <span className="text-xs text-muted">{status}</span>}
      </div>
    </div>
  );
}

function CategoryManager({
  book,
  stillIds,
  onChanged,
}: {
  book: Book;
  stillIds: Set<string>;
  onChanged: () => Promise<void> | void;
}) {
  const [bulk, setBulk] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState("");

  const [rowLabel, setRowLabel] = useState("");
  const [rowPrompt, setRowPrompt] = useState("");
  const [rowBusy, setRowBusy] = useState(false);
  const [rowError, setRowError] = useState("");

  const submitBulk = useCallback(async () => {
    setBulkError("");
    const rows = bulk.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const parsed: Array<{ id?: string; label: string; prompt: string }> = [];
    const malformed: number[] = [];
    rows.forEach((line, idx) => {
      const parts = line.split("|").map((s) => s.trim()).filter(Boolean);
      if (parts.length === 2) {
        parsed.push({ label: parts[0], prompt: parts[1] });
      } else if (parts.length >= 3) {
        parsed.push({
          id: parts[0],
          label: parts[1],
          prompt: parts.slice(2).join(" | "),
        });
      } else {
        malformed.push(idx + 1);
      }
    });
    if (parsed.length === 0) {
      setBulkError("Use one of: `label | prompt` or `id | label | prompt` per line.");
      return;
    }
    setBulkBusy(true);
    try {
      const r = await fetch(`/api/books/${book.id}/categories`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categories: parsed }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || `add failed (${r.status})`);
      }
      setBulk("");
      if (malformed.length) setBulkError(`Skipped lines: ${malformed.join(", ")}`);
      await onChanged();
    } catch (e) {
      setBulkError((e as Error).message);
    } finally {
      setBulkBusy(false);
    }
  }, [bulk, book.id, onChanged]);

  const submitRow = useCallback(async () => {
    if (!rowLabel.trim() || !rowPrompt.trim()) return;
    setRowBusy(true);
    setRowError("");
    try {
      const r = await fetch(`/api/books/${book.id}/categories`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: rowLabel.trim(),
          prompt: rowPrompt.trim(),
        }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || `add failed (${r.status})`);
      }
      setRowLabel("");
      setRowPrompt("");
      await onChanged();
    } catch (e) {
      setRowError((e as Error).message);
    } finally {
      setRowBusy(false);
    }
  }, [rowLabel, rowPrompt, book.id, onChanged]);

  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">
          add categories
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block">
              <span className="text-xs text-muted block mb-1">Bulk paste</span>
              <textarea
                value={bulk}
                onChange={(e) => setBulk(e.target.value)}
                placeholder={"books | a hand pulling a leather book from a shelf\ncoffee | top-down ceramic mug of black coffee"}
                className="w-full bg-bg border border-line2 rounded px-3 py-2 text-sm focus:border-ink focus:outline-none resize-y"
                rows={4}
              />
              <span className="text-xs text-dim block mt-1">
                Format: <span className="text-ink">label | prompt</span> per line.
              </span>
            </label>
            {bulkError && (
              <div className="text-red-700 text-sm mt-2">{bulkError}</div>
            )}
            <button
              onClick={submitBulk}
              disabled={!bulk.trim() || bulkBusy}
              className="mt-2 px-4 py-1.5 bg-ink text-bg rounded hover:bg-sepia transition-colors disabled:bg-line2 disabled:text-dim disabled:cursor-not-allowed"
            >
              {bulkBusy ? "adding…" : "Add all"}
            </button>
          </div>
          <div>
            <label className="block">
              <span className="text-xs text-muted block mb-1">Add one</span>
              <input
                value={rowLabel}
                onChange={(e) => setRowLabel(e.target.value)}
                placeholder="label"
                className="w-full bg-bg border border-line2 rounded px-3 py-2 mb-2 focus:border-ink focus:outline-none"
              />
              <textarea
                value={rowPrompt}
                onChange={(e) => setRowPrompt(e.target.value)}
                placeholder="prompt"
                rows={3}
                className="w-full bg-bg border border-line2 rounded px-3 py-2 text-sm focus:border-ink focus:outline-none resize-y"
              />
            </label>
            {rowError && (
              <div className="text-red-700 text-sm mt-2">{rowError}</div>
            )}
            <button
              onClick={submitRow}
              disabled={!rowLabel.trim() || !rowPrompt.trim() || rowBusy}
              className="mt-2 px-4 py-1.5 border border-line2 text-ink rounded hover:bg-ink hover:text-bg transition-colors disabled:text-dim disabled:cursor-not-allowed"
            >
              {rowBusy ? "adding…" : "Add"}
            </button>
          </div>
        </div>
      </div>

      {book.categories.length > 0 && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">
            categories
          </div>
          <ul className="space-y-2">
            {book.categories.map((c) => (
              <li key={c.id}>
                <CategoryRow
                  bookId={book.id}
                  category={c}
                  hasStill={stillIds.has(c.id)}
                  onChanged={onChanged}
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function CategoryRow({
  bookId,
  category,
  hasStill,
  onChanged,
}: {
  bookId: string;
  category: BookCategory;
  hasStill: boolean;
  onChanged: () => Promise<void> | void;
}) {
  const [editing, setEditing] = useState(false);
  const [labelDraft, setLabelDraft] = useState(category.label);
  const [promptDraft, setPromptDraft] = useState(category.prompt);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>("");

  const save = useCallback(async () => {
    setBusy(true);
    try {
      const r = await fetch(
        `/api/books/${bookId}/categories/${category.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            label: labelDraft.trim(),
            prompt: promptDraft.trim(),
          }),
        },
      );
      if (r.ok) {
        setEditing(false);
        await onChanged();
      }
    } finally {
      setBusy(false);
    }
  }, [bookId, category.id, labelDraft, promptDraft, onChanged]);

  const remove = useCallback(async () => {
    if (
      !confirm(
        `Remove "${category.label}"? This also deletes its generated still.`,
      )
    ) {
      return;
    }
    const r = await fetch(
      `/api/books/${bookId}/categories/${category.id}`,
      { method: "DELETE" },
    );
    if (r.ok) await onChanged();
  }, [bookId, category.id, category.label, onChanged]);

  const regenerate = useCallback(async () => {
    setBusy(true);
    setStatus("generating…");
    try {
      const r = await fetch("/api/admin/generate-still", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookId, category: category.id }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || `generate failed (${r.status})`);
      }
      setStatus("regenerated");
      await onChanged();
    } catch (e) {
      setStatus(`failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [bookId, category.id, onChanged]);

  const upload = useCallback(
    async (file: File) => {
      setBusy(true);
      setStatus("uploading…");
      try {
        const form = new FormData();
        form.append("bookId", bookId);
        form.append("category", category.id);
        form.append("file", file);
        const r = await fetch("/api/admin/upload-still", {
          method: "POST",
          body: form,
        });
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          throw new Error(err.error || `upload failed (${r.status})`);
        }
        setStatus("uploaded");
        await onChanged();
      } catch (e) {
        setStatus(`failed: ${(e as Error).message}`);
      } finally {
        setBusy(false);
      }
    },
    [bookId, category.id, onChanged],
  );

  return (
    <div className="bg-bg border border-line rounded-md px-3 py-3">
      {editing ? (
        <div className="space-y-2">
          <input
            value={labelDraft}
            onChange={(e) => setLabelDraft(e.target.value)}
            className="w-full bg-bg border border-line2 rounded px-2 py-1 text-sm focus:border-ink focus:outline-none"
          />
          <textarea
            value={promptDraft}
            onChange={(e) => setPromptDraft(e.target.value)}
            rows={2}
            className="w-full bg-bg border border-line2 rounded px-2 py-1 text-sm focus:border-ink focus:outline-none resize-y"
          />
          <div className="flex gap-3 text-sm">
            <button
              onClick={save}
              disabled={busy || !labelDraft.trim() || !promptDraft.trim()}
              className="text-ink hover:text-sepia disabled:text-dim"
            >
              {busy ? "saving…" : "save"}
            </button>
            <button
              onClick={() => {
                setLabelDraft(category.label);
                setPromptDraft(category.prompt);
                setEditing(false);
              }}
              className="text-muted hover:text-ink"
            >
              cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-ink">{category.label}</span>
              <span
                className={`text-xs ${
                  hasStill ? "text-muted" : "text-red-700"
                }`}
              >
                {hasStill ? "✓ still ready" : "no still yet"}
              </span>
              <span className="text-xs text-dim">id: {category.id}</span>
            </div>
            <div className="text-sm text-muted mt-1 leading-relaxed">
              {category.prompt}
            </div>
            {status && (
              <div className="text-xs text-dim mt-1">{status}</div>
            )}
          </div>
          <div className="flex flex-col gap-1 text-sm shrink-0">
            <button
              onClick={regenerate}
              disabled={busy}
              className="text-ink hover:text-sepia disabled:text-dim text-right"
            >
              {hasStill ? "regenerate" : "generate"}
            </button>
            <label className="text-ink hover:text-sepia cursor-pointer text-right">
              upload
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void upload(f);
                  e.target.value = "";
                }}
              />
            </label>
            <button
              onClick={() => setEditing(true)}
              className="text-muted hover:text-ink text-right"
            >
              edit
            </button>
            <button
              onClick={remove}
              className="text-red-700 hover:text-red-900 text-right"
            >
              remove
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function FillerManager({
  filler,
  onChanged,
}: {
  filler: FillerStill[];
  onChanged: () => Promise<void> | void;
}) {
  const [mode, setMode] = useState<"upload" | "generate">("upload");
  const [label, setLabel] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = useCallback(async () => {
    if (!label.trim()) return;
    setBusy(true);
    setError("");
    try {
      if (mode === "upload") {
        if (!file) return;
        const form = new FormData();
        form.append("label", label.trim());
        form.append("file", file);
        const r = await fetch("/api/filler", { method: "POST", body: form });
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          throw new Error(err.error || `upload failed (${r.status})`);
        }
      } else {
        if (!prompt.trim()) return;
        const r = await fetch("/api/admin/generate-filler", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label: label.trim(), prompt: prompt.trim() }),
        });
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          throw new Error(err.error || `generate failed (${r.status})`);
        }
      }
      setLabel("");
      setFile(null);
      setPrompt("");
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [mode, label, file, prompt, onChanged]);

  return (
    <div className="space-y-5">
      <div className="bg-surface border border-line rounded-md px-4 py-4">
        <div className="flex gap-3 mb-4">
          <button
            onClick={() => setMode("upload")}
            className={`px-3 py-1.5 rounded text-sm ${
              mode === "upload"
                ? "bg-ink text-bg"
                : "border border-line2 text-muted hover:text-ink"
            }`}
          >
            Upload
          </button>
          <button
            onClick={() => setMode("generate")}
            className={`px-3 py-1.5 rounded text-sm ${
              mode === "generate"
                ? "bg-ink text-bg"
                : "border border-line2 text-muted hover:text-ink"
            }`}
          >
            Generate
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="block">
            <span className="text-xs text-muted block mb-1">Label</span>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="filler-1, candles, etc."
              className="w-full bg-bg border border-line2 rounded px-3 py-2 focus:border-ink focus:outline-none"
            />
          </label>
          {mode === "upload" ? (
            <div>
              <span className="text-xs text-muted block mb-1">Image</span>
              <label className="inline-flex items-center gap-3 cursor-pointer">
                <span className="px-3 py-2 border border-line2 rounded bg-bg text-ink hover:bg-ink hover:text-bg transition-colors">
                  {file ? "Replace image" : "Choose image"}
                </span>
                <span className="text-sm text-muted">
                  {file
                    ? `${file.name} · ${(file.size / 1024).toFixed(0)} kb`
                    : "no file chosen"}
                </span>
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </label>
            </div>
          ) : (
            <label className="block md:col-span-1">
              <span className="text-xs text-muted block mb-1">Prompt</span>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={3}
                placeholder="describe the image"
                className="w-full bg-bg border border-line2 rounded px-3 py-2 text-sm focus:border-ink focus:outline-none resize-y"
              />
            </label>
          )}
        </div>
        <div className="flex items-center gap-3 mt-4">
          <button
            onClick={submit}
            disabled={
              !label.trim() ||
              busy ||
              (mode === "upload" ? !file : !prompt.trim())
            }
            className="px-5 py-2 bg-ink text-bg rounded hover:bg-sepia transition-colors disabled:bg-line2 disabled:text-dim disabled:cursor-not-allowed"
          >
            {busy ? "working…" : mode === "upload" ? "Upload" : "Generate"}
          </button>
          {error && <span className="text-red-700 text-sm">{error}</span>}
        </div>
      </div>

      {filler.length > 0 && (
        <ul className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {filler.map((s) => (
            <li key={s.id}>
              <FillerCard still={s} onChanged={onChanged} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FillerCard({
  still,
  onChanged,
}: {
  still: FillerStill;
  onChanged: () => Promise<void> | void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [labelDraft, setLabelDraft] = useState(still.label);
  const [busy, setBusy] = useState(false);

  const saveLabel = useCallback(async () => {
    if (!labelDraft.trim() || labelDraft.trim() === still.label) {
      setRenaming(false);
      return;
    }
    setBusy(true);
    const r = await fetch(`/api/filler/${still.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: labelDraft.trim() }),
    });
    if (r.ok) await onChanged();
    setRenaming(false);
    setBusy(false);
  }, [labelDraft, still.label, still.id, onChanged]);

  const remove = useCallback(async () => {
    if (!confirm(`Remove "${still.label}"?`)) return;
    setBusy(true);
    const r = await fetch(`/api/filler/${still.id}`, { method: "DELETE" });
    if (r.ok) await onChanged();
    setBusy(false);
  }, [still.id, still.label, onChanged]);

  return (
    <div className="bg-bg border border-line rounded-md overflow-hidden">
      <img
        src={still.url}
        alt={still.label}
        className="w-full aspect-[2/3] object-cover"
      />
      <div className="px-3 py-2">
        {renaming ? (
          <input
            value={labelDraft}
            onChange={(e) => setLabelDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void saveLabel();
              if (e.key === "Escape") {
                setLabelDraft(still.label);
                setRenaming(false);
              }
            }}
            autoFocus
            className="w-full bg-bg border border-line2 rounded px-2 py-1 text-sm focus:border-ink focus:outline-none"
          />
        ) : (
          <div className="text-sm text-ink truncate">{still.label}</div>
        )}
        <div className="flex justify-between text-xs mt-1">
          <button
            onClick={() => setRenaming((v) => !v)}
            disabled={busy}
            className="text-muted hover:text-ink"
          >
            rename
          </button>
          <button
            onClick={remove}
            disabled={busy}
            className="text-red-700 hover:text-red-900"
          >
            remove
          </button>
        </div>
      </div>
    </div>
  );
}
