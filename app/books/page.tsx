"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type {
  Book,
  BookCategory,
  Caption,
  Song,
} from "@/lib/books-store";

export default function BooksPage() {
  const [books, setBooks] = useState<Book[]>([]);
  const [stillsByBook, setStillsByBook] = useState<
    Record<string, Record<string, string>>
  >({});
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const refreshBooks = useCallback(async () => {
    const r = await fetch("/api/books", { cache: "no-store" });
    if (!r.ok) return;
    const data = (await r.json()) as { books?: Book[] };
    const list = data.books ?? [];
    setBooks(list);
    const entries = await Promise.all(
      list.map(async (b) => {
        try {
          const lr = await fetch(
            `/api/library?bookId=${encodeURIComponent(b.id)}`,
            { cache: "no-store" },
          );
          if (!lr.ok) return [b.id, {} as Record<string, string>] as const;
          const d = (await lr.json()) as {
            stills?: Array<{ id: string; url: string }>;
          };
          const byId: Record<string, string> = {};
          for (const s of d.stills ?? []) byId[s.id] = s.url;
          return [b.id, byId] as const;
        } catch {
          return [b.id, {} as Record<string, string>] as const;
        }
      }),
    );
    setStillsByBook(Object.fromEntries(entries));
  }, []);

  useEffect(() => {
    void refreshBooks();
  }, [refreshBooks]);

  return (
    <main className="max-w-5xl mx-auto px-6 md:px-12 py-8 font-sans text-ink">
      <h1 className="text-sm font-semibold uppercase tracking-wider text-muted mb-4">
        books
      </h1>

      <section className="mb-10">
        <h2 className="text-xs text-muted uppercase tracking-wider mb-2">
          add a book
        </h2>
        <AddBookForm
          books={books}
          onCreated={async (id) => {
            await refreshBooks();
            setExpandedId(id);
          }}
        />
      </section>

      <section>
        <h2 className="text-xs text-muted uppercase tracking-wider mb-2">
          your books · {books.length}
        </h2>
        {books.length === 0 ? (
          <div className="text-muted text-sm bg-surface border border-line rounded-md px-4 py-6">
            No books yet. Add one above.
          </div>
        ) : (
          <ul className="space-y-3">
            {books.map((b) => (
              <li key={b.id}>
                <BookCard
                  book={b}
                  stillsByCategory={stillsByBook[b.id] ?? {}}
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
    </main>
  );
}

function AddBookForm({
  books,
  onCreated,
}: {
  books: Book[];
  onCreated: (id: string) => void | Promise<void>;
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
            className="w-full bg-bg border border-line2 rounded px-3 py-2 focus:border-ink focus:outline-none"
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
              className="w-full bg-bg border border-line2 rounded px-3 py-2 focus:border-ink focus:outline-none"
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
          <span className="text-xs text-muted block mb-1">Style brief (optional)</span>
          <textarea
            value={stylePrompt}
            onChange={(e) => setStylePrompt(e.target.value)}
            rows={3}
            placeholder="e.g. black-dominant low-key photography, shadow-weighted exposure, suppressed midtones, near-monochromatic palette…"
            className="w-full bg-bg border border-line2 rounded px-3 py-2 text-sm focus:border-ink focus:outline-none resize-y"
          />
          <span className="text-xs text-dim block mt-1">
            Prepended to every image prompt when generating this book&rsquo;s stills.
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
  stillsByCategory,
  expanded,
  onToggle,
  onChanged,
}: {
  book: Book;
  stillsByCategory: Record<string, string>;
  expanded: boolean;
  onToggle: () => void;
  onChanged: () => Promise<void> | void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState(book.title);
  const stillCount = book.categories.filter((c) => stillsByCategory[c.id]).length;

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
        `Delete "${book.title}"? Cover and all generated stills will be removed.`,
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
                className="flex-1 bg-bg border border-line2 rounded px-2 py-1 focus:border-ink focus:outline-none"
              />
              <button onClick={saveRename} className="text-sm text-muted hover:text-ink">
                save
              </button>
            </div>
          ) : (
            <>
              <h3 className="text-lg text-ink leading-tight truncate">{book.title}</h3>
              <div className="text-xs text-muted mt-0.5">
                {(book.captions ?? []).length} captions ·{" "}
                {(book.songs ?? []).length} songs · {book.categories.length} prompts ·{" "}
                {stillCount}/{book.categories.length} stills
              </div>
            </>
          )}
        </div>
        <div className="flex items-center gap-3 text-sm">
          <button
            onClick={() => setRenaming((v) => !v)}
            className="text-muted hover:text-ink"
          >
            rename
          </button>
          <button onClick={onDelete} className="text-red-700 hover:text-red-900">
            delete
          </button>
          <button
            onClick={onToggle}
            className="px-3 py-1.5 border border-line2 rounded text-ink hover:bg-ink hover:text-bg transition-colors"
          >
            {expanded ? "close" : "edit"}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-line bg-surface px-4 py-5 space-y-8">
          <StyleEditor book={book} onChanged={onChanged} />
          <CaptionsSection book={book} onChanged={onChanged} />
          <MusicSection book={book} onChanged={onChanged} />
          <ImagePromptsSection book={book} onChanged={onChanged} />
          <LibrarySection
            book={book}
            stillsByCategory={stillsByCategory}
            onChanged={onChanged}
          />
        </div>
      )}
    </article>
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
      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">
        style brief
      </h4>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={4}
        placeholder="e.g. black-dominant low-key photography, shadow-weighted exposure, suppressed midtones…"
        className="w-full bg-bg border border-line2 rounded px-3 py-2 text-sm focus:border-ink focus:outline-none resize-y"
      />
      <div className="text-xs text-dim mt-1">
        Prepended to every image prompt for this book.
      </div>
      <div className="flex items-center gap-3 mt-2">
        <button
          onClick={save}
          disabled={busy || !dirty}
          className="px-4 py-1.5 bg-ink text-bg rounded hover:bg-sepia transition-colors disabled:bg-line2 disabled:text-dim disabled:cursor-not-allowed"
        >
          {busy ? "saving…" : "Save"}
        </button>
        {status && <span className="text-xs text-muted">{status}</span>}
      </div>
    </div>
  );
}

function CaptionsSection({
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
  const captions = book.captions ?? [];

  const addBulk = useCallback(async () => {
    setBulkError("");
    const blocks = bulk
      .split(/\n\s*\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (blocks.length === 0) return;
    setBulkBusy(true);
    try {
      const r = await fetch(`/api/books/${book.id}/captions`, {
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
      const r = await fetch(`/api/books/${book.id}/captions`, {
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
      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">
        captions · {captions.length}
      </h4>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block">
            <span className="text-xs text-muted block mb-1">Bulk paste</span>
            <textarea
              value={bulk}
              onChange={(e) => setBulk(e.target.value)}
              placeholder={"Separate each caption with a blank line.\n\nLine breaks within a caption are preserved."}
              rows={5}
              className="w-full bg-bg border border-line2 rounded px-3 py-2 text-sm focus:border-ink focus:outline-none resize-y"
            />
            <span className="text-xs text-dim block mt-1">
              One caption per blank-line-separated block.
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
              placeholder="A single caption, line breaks allowed"
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
      {captions.length > 0 && (
        <ul className="mt-5 space-y-2">
          {captions.map((c) => (
            <li key={c.id}>
              <CaptionRow bookId={book.id} caption={c} onChanged={onChanged} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CaptionRow({
  bookId,
  caption,
  onChanged,
}: {
  bookId: string;
  caption: Caption;
  onChanged: () => Promise<void> | void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(caption.text);
  const [busy, setBusy] = useState(false);

  const save = useCallback(async () => {
    if (!draft.trim() || draft.trim() === caption.text) {
      setEditing(false);
      return;
    }
    setBusy(true);
    try {
      const r = await fetch(`/api/books/${bookId}/captions/${caption.id}`, {
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
  }, [draft, caption.text, caption.id, bookId, onChanged]);

  const remove = useCallback(async () => {
    if (!confirm("Remove this caption?")) return;
    setBusy(true);
    const r = await fetch(`/api/books/${bookId}/captions/${caption.id}`, {
      method: "DELETE",
    });
    if (r.ok) await onChanged();
    setBusy(false);
  }, [bookId, caption.id, onChanged]);

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
                setDraft(caption.text);
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
            {caption.text}
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

function MusicSection({
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
      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">
        music · {songs.length}
      </h4>
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
          {song.bpm ? `${song.bpm} bpm` : ""}
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

function ImagePromptsSection({
  book,
  onChanged,
}: {
  book: Book;
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
    const rows = bulk
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    const parsed: Array<{ id?: string; label: string; prompt: string }> = [];
    for (const line of rows) {
      const parts = line.split("|").map((s) => s.trim()).filter(Boolean);
      if (parts.length === 2) parsed.push({ label: parts[0], prompt: parts[1] });
      else if (parts.length >= 3)
        parsed.push({
          id: parts[0],
          label: parts[1],
          prompt: parts.slice(2).join(" | "),
        });
    }
    if (parsed.length === 0) {
      setBulkError("Use `label | prompt` per line, or `id | label | prompt`.");
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
    <div>
      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">
        image prompts · {book.categories.length}
      </h4>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block">
            <span className="text-xs text-muted block mb-1">Bulk paste</span>
            <textarea
              value={bulk}
              onChange={(e) => setBulk(e.target.value)}
              placeholder={"candles | a single tall candle on a wooden desk\nletters | aged ivory paper tied with twine"}
              rows={4}
              className="w-full bg-bg border border-line2 rounded px-3 py-2 text-sm focus:border-ink focus:outline-none resize-y"
            />
            <span className="text-xs text-dim block mt-1">
              Format: <span className="text-ink">label | prompt</span> per line.
            </span>
          </label>
          {bulkError && <div className="text-red-700 text-sm mt-2">{bulkError}</div>}
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
          {rowError && <div className="text-red-700 text-sm mt-2">{rowError}</div>}
          <button
            onClick={submitRow}
            disabled={!rowLabel.trim() || !rowPrompt.trim() || rowBusy}
            className="mt-2 px-4 py-1.5 border border-line2 text-ink rounded hover:bg-ink hover:text-bg transition-colors disabled:text-dim disabled:cursor-not-allowed"
          >
            {rowBusy ? "adding…" : "Add"}
          </button>
        </div>
      </div>
      {book.categories.length > 0 && (
        <ul className="mt-5 space-y-2">
          {book.categories.map((c) => (
            <li key={c.id}>
              <PromptRow bookId={book.id} category={c} onChanged={onChanged} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PromptRow({
  bookId,
  category,
  onChanged,
}: {
  bookId: string;
  category: BookCategory;
  onChanged: () => Promise<void> | void;
}) {
  const [editing, setEditing] = useState(false);
  const [labelDraft, setLabelDraft] = useState(category.label);
  const [promptDraft, setPromptDraft] = useState(category.prompt);
  const [busy, setBusy] = useState(false);

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
    if (!confirm(`Remove "${category.label}" and its still?`)) return;
    setBusy(true);
    const r = await fetch(
      `/api/books/${bookId}/categories/${category.id}`,
      { method: "DELETE" },
    );
    if (r.ok) await onChanged();
    setBusy(false);
  }, [bookId, category.id, category.label, onChanged]);

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
              <span className="text-xs text-dim">id: {category.id}</span>
            </div>
            <div className="text-sm text-muted mt-1 leading-relaxed whitespace-pre-wrap">
              {category.prompt}
            </div>
          </div>
          <div className="flex flex-col gap-1 text-sm shrink-0">
            <button
              onClick={() => setEditing(true)}
              className="text-muted hover:text-ink"
            >
              edit
            </button>
            <button
              onClick={remove}
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

function LibrarySection({
  book,
  stillsByCategory,
  onChanged,
}: {
  book: Book;
  stillsByCategory: Record<string, string>;
  onChanged: () => Promise<void> | void;
}) {
  return (
    <div>
      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">
        library · {Object.keys(stillsByCategory).length}/{book.categories.length}
      </h4>
      {book.categories.length === 0 ? (
        <div className="text-sm text-muted bg-bg border border-line rounded px-3 py-3">
          Add image prompts first; this section fills as you generate or upload stills.
        </div>
      ) : (
        <ul className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {book.categories.map((c) => (
            <li key={c.id}>
              <LibrarySlot
                bookId={book.id}
                category={c}
                stillUrl={stillsByCategory[c.id]}
                onChanged={onChanged}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LibrarySlot({
  bookId,
  category,
  stillUrl,
  onChanged,
}: {
  bookId: string;
  category: BookCategory;
  stillUrl?: string;
  onChanged: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  const generate = useCallback(async () => {
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
      setStatus("");
      await onChanged();
    } catch (e) {
      setStatus((e as Error).message);
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
        setStatus("");
        await onChanged();
      } catch (e) {
        setStatus((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [bookId, category.id, onChanged],
  );

  const removeStill = useCallback(async () => {
    if (!stillUrl) return;
    if (!confirm(`Remove the still for "${category.label}"? Prompt stays.`)) return;
    setBusy(true);
    setStatus("removing…");
    try {
      const r = await fetch("/api/admin/upload-still", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookId, category: category.id }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || `remove failed (${r.status})`);
      }
      setStatus("");
      await onChanged();
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [stillUrl, bookId, category.id, category.label, onChanged]);

  return (
    <div className="bg-bg border border-line rounded-md overflow-hidden">
      {stillUrl ? (
        <img
          src={stillUrl}
          alt={category.label}
          className="w-full aspect-[2/3] object-cover"
        />
      ) : (
        <div className="w-full aspect-[2/3] bg-surface flex items-center justify-center text-xs text-dim">
          no still
        </div>
      )}
      <div className="px-2.5 py-2">
        <div className="text-sm text-ink truncate">{category.label}</div>
        {status && (
          <div className="text-xs text-muted mt-0.5 break-words">{status}</div>
        )}
        <div className="flex flex-wrap gap-2 mt-1 text-xs">
          <button
            onClick={generate}
            disabled={busy}
            className="text-ink hover:text-sepia disabled:text-dim"
          >
            {stillUrl ? "regenerate" : "generate"}
          </button>
          <label className="text-ink hover:text-sepia cursor-pointer">
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
          {stillUrl && (
            <button
              onClick={removeStill}
              disabled={busy}
              className="text-red-700 hover:text-red-900 disabled:text-dim ml-auto"
            >
              remove
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
