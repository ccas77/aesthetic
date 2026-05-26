"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Book } from "@/lib/books-store";
import type { SharedStill } from "@/lib/shared-store";

type Tab = "shared" | "by-book";

interface CategoryStill {
  id: string;
  url: string;
}

export default function LibraryPage() {
  const [tab, setTab] = useState<Tab>("shared");
  const [shared, setShared] = useState<SharedStill[]>([]);
  const [books, setBooks] = useState<Book[]>([]);
  const [activeBookId, setActiveBookId] = useState<string | null>(null);
  const [bookStills, setBookStills] = useState<CategoryStill[]>([]);

  // Shared-pool quick-add (file upload only, generation lives on the Books → Library
  // section since shared prompts are detached from any one book).
  const [addLabel, setAddLabel] = useState("");
  const [addFile, setAddFile] = useState<File | null>(null);
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState("");

  const refreshShared = useCallback(async () => {
    const r = await fetch("/api/shared", { cache: "no-store" });
    if (!r.ok) return;
    const data = (await r.json()) as { stills?: SharedStill[] };
    setShared(data.stills ?? []);
  }, []);

  const refreshBooks = useCallback(async () => {
    const r = await fetch("/api/books", { cache: "no-store" });
    if (!r.ok) return;
    const data = (await r.json()) as { books?: Book[] };
    const list = data.books ?? [];
    setBooks(list);
    if (list.length > 0 && !activeBookId) setActiveBookId(list[0].id);
  }, [activeBookId]);

  useEffect(() => {
    void refreshShared();
    void refreshBooks();
  }, [refreshShared, refreshBooks]);

  useEffect(() => {
    if (!activeBookId) {
      setBookStills([]);
      return;
    }
    void (async () => {
      const r = await fetch(
        `/api/library?bookId=${encodeURIComponent(activeBookId)}`,
        { cache: "no-store" },
      );
      if (!r.ok) return;
      const data = (await r.json()) as { stills?: CategoryStill[] };
      setBookStills(data.stills ?? []);
    })();
  }, [activeBookId]);

  const activeBook = useMemo(
    () => books.find((b) => b.id === activeBookId) ?? null,
    [books, activeBookId],
  );

  const submitShared = useCallback(async () => {
    if (!addLabel.trim() || !addFile) return;
    setAddBusy(true);
    setAddError("");
    try {
      const form = new FormData();
      form.append("label", addLabel.trim());
      form.append("file", addFile);
      const r = await fetch("/api/shared", { method: "POST", body: form });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || `upload failed (${r.status})`);
      }
      setAddLabel("");
      setAddFile(null);
      await refreshShared();
    } catch (e) {
      setAddError((e as Error).message);
    } finally {
      setAddBusy(false);
    }
  }, [addLabel, addFile, refreshShared]);

  return (
    <main className="max-w-5xl mx-auto px-6 md:px-12 py-8 font-sans text-ink">
      <h1 className="text-sm font-semibold uppercase tracking-wider text-muted mb-4">
        library
      </h1>

      <div className="flex gap-2 mb-6 border-b border-line2">
        {(
          [
            ["shared", `Shared (${shared.length})`],
            ["by-book", "By book"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={
              tab === key
                ? "px-3 py-2 text-sm font-medium border-b-2 border-ink -mb-px"
                : "px-3 py-2 text-sm text-muted hover:text-ink"
            }
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "shared" && (
        <section className="space-y-5">
          <div className="bg-surface border border-line rounded-md px-4 py-4">
            <h2 className="text-xs text-muted uppercase tracking-wider mb-2">
              add to shared
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs text-muted block mb-1">Label</span>
                <input
                  value={addLabel}
                  onChange={(e) => setAddLabel(e.target.value)}
                  placeholder="candles, embers, doorway"
                  className="w-full bg-bg border border-line2 rounded px-3 py-2 focus:border-ink focus:outline-none"
                />
              </label>
              <div>
                <span className="text-xs text-muted block mb-1">Image</span>
                <label className="inline-flex items-center gap-3 cursor-pointer">
                  <span className="px-3 py-2 border border-line2 rounded bg-bg text-ink hover:bg-ink hover:text-bg transition-colors">
                    {addFile ? "Replace image" : "Choose image"}
                  </span>
                  <span className="text-sm text-muted">
                    {addFile
                      ? `${addFile.name} · ${(addFile.size / 1024).toFixed(0)} kb`
                      : "no file chosen"}
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={(e) => setAddFile(e.target.files?.[0] ?? null)}
                  />
                </label>
              </div>
            </div>
            <div className="flex items-center gap-3 mt-3">
              <button
                onClick={submitShared}
                disabled={!addLabel.trim() || !addFile || addBusy}
                className="px-4 py-1.5 bg-ink text-bg rounded hover:bg-sepia transition-colors disabled:bg-line2 disabled:text-dim disabled:cursor-not-allowed"
              >
                {addBusy ? "uploading…" : "Upload"}
              </button>
              {addError && (
                <span className="text-sm text-red-700">{addError}</span>
              )}
              <span className="text-xs text-dim ml-auto">
                For prompt-based generation, use Books → Library on a specific book.
              </span>
            </div>
          </div>

          {shared.length === 0 ? (
            <div className="text-sm text-muted bg-surface border border-line rounded px-3 py-3">
              Shared pool is empty.
            </div>
          ) : (
            <ul className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {shared.map((s) => (
                <li key={s.id}>
                  <SharedTile still={s} onChanged={refreshShared} />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === "by-book" && (
        <section className="space-y-5">
          <label className="block max-w-md">
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
            activeBook.categories.length === 0 ? (
              <div className="text-sm text-muted bg-surface border border-line rounded px-3 py-3">
                {activeBook.title} has no image prompts yet.
              </div>
            ) : (
              <ul className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {activeBook.categories.map((c) => {
                  const url = bookStills.find((s) => s.id === c.id)?.url;
                  return (
                    <li key={c.id} className="bg-bg border border-line rounded-md overflow-hidden">
                      {url ? (
                        <img
                          src={url}
                          alt={c.label}
                          className="w-full aspect-[2/3] object-cover"
                        />
                      ) : (
                        <div className="w-full aspect-[2/3] bg-surface flex items-center justify-center text-xs text-dim">
                          no still
                        </div>
                      )}
                      <div className="px-2.5 py-2">
                        <div className="text-sm text-ink truncate">{c.label}</div>
                        <div className="text-xs text-dim truncate">id: {c.id}</div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )
          )}
        </section>
      )}
    </main>
  );
}

function SharedTile({
  still,
  onChanged,
}: {
  still: SharedStill;
  onChanged: () => Promise<void> | void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [labelDraft, setLabelDraft] = useState(still.label);
  const [busy, setBusy] = useState(false);

  const save = useCallback(async () => {
    if (!labelDraft.trim() || labelDraft.trim() === still.label) {
      setRenaming(false);
      return;
    }
    setBusy(true);
    const r = await fetch(`/api/shared/${still.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: labelDraft.trim() }),
    });
    if (r.ok) await onChanged();
    setRenaming(false);
    setBusy(false);
  }, [labelDraft, still.label, still.id, onChanged]);

  const remove = useCallback(async () => {
    if (!confirm(`Remove "${still.label}" from the shared pool?`)) return;
    setBusy(true);
    const r = await fetch(`/api/shared/${still.id}`, { method: "DELETE" });
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
      <div className="px-2.5 py-2">
        {renaming ? (
          <input
            value={labelDraft}
            onChange={(e) => setLabelDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void save();
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
