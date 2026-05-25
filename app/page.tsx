"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { renderVideo, type RenderProgress } from "@/lib/render";
import { detectTempo } from "@/lib/beat-detect";
import type { Still } from "@/lib/library";
import type { Book, BookCategory } from "@/lib/books-store";

type Stage = "idle" | "analyzing" | "rendering" | "done";

export default function Home() {
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [quote, setQuote] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [progress, setProgress] = useState<RenderProgress>({ phase: "", pct: 0 });
  const [bpm, setBpm] = useState<number | null>(null);
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [persistState, setPersistState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [persistMsg, setPersistMsg] = useState<string>("");

  const [books, setBooks] = useState<Book[]>([]);
  const [activeBookId, setActiveBookId] = useState<string | null>(null);
  const [showManager, setShowManager] = useState<boolean>(false);

  const [library, setLibrary] = useState<Still[]>([]);
  const [libraryReady, setLibraryReady] = useState<boolean>(false);
  const [missingCategories, setMissingCategories] = useState<string[]>([]);
  const [generating, setGenerating] = useState<Record<string, "pending" | "ok" | "fail">>({});

  const fileRef = useRef<HTMLInputElement>(null);
  const lastPhaseRef = useRef<string>("");
  const hydratedRef = useRef<boolean>(false);

  const activeBook = useMemo(
    () => books.find((b) => b.id === activeBookId) ?? null,
    [books, activeBookId],
  );

  const refreshBooks = useCallback(async () => {
    try {
      const r = await fetch("/api/books", { cache: "no-store" });
      if (!r.ok) return [];
      const data = (await r.json()) as { books?: Book[] };
      const list = data.books ?? [];
      setBooks(list);
      return list;
    } catch {
      return [];
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const list = await refreshBooks();
      if (list.length > 0 && !activeBookId) {
        setActiveBookId(list[0].id);
      }
      if (list.length === 0) {
        setShowManager(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadLibrary = useCallback(async (bookId: string | null) => {
    if (!bookId) {
      setLibrary([]);
      setMissingCategories([]);
      setLibraryReady(true);
      return;
    }
    try {
      const r = await fetch(`/api/library?bookId=${encodeURIComponent(bookId)}`, {
        cache: "no-store",
      });
      if (!r.ok) return;
      const data = (await r.json()) as {
        configured?: boolean;
        stills?: Still[];
        missing?: string[];
      };
      setLibrary(data.stills || []);
      setMissingCategories(data.missing || []);
      setLibraryReady(true);
    } catch {
      setLibraryReady(true);
    }
  }, []);

  useEffect(() => {
    void loadLibrary(activeBookId);
  }, [activeBookId, loadLibrary]);

  const onGenerateLibrary = useCallback(async () => {
    if (!activeBook) return;
    const targets =
      missingCategories.length > 0
        ? missingCategories
        : activeBook.categories.map((c) => c.id);
    if (targets.length === 0) return;
    setGenerating(Object.fromEntries(targets.map((id) => [id, "pending"])));
    await Promise.all(
      targets.map(async (id) => {
        try {
          const r = await fetch("/api/admin/generate-still", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ bookId: activeBook.id, category: id }),
          });
          setGenerating((g) => ({ ...g, [id]: r.ok ? "ok" : "fail" }));
        } catch {
          setGenerating((g) => ({ ...g, [id]: "fail" }));
        }
      }),
    );
    await loadLibrary(activeBook.id);
  }, [activeBook, missingCategories, loadLibrary]);

  // === Persistence: load saved state on mount ===
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/state");
        if (!r.ok) return;
        const data = (await r.json()) as {
          quote?: string;
          audioUrl?: string | null;
          audioName?: string | null;
          audioSize?: number | null;
          configured?: boolean;
        };
        if (cancelled) return;
        if (data.configured === false) {
          setPersistMsg("server storage not configured, saves won't persist");
        }
        if (data.quote) setQuote(data.quote);
        if (data.audioUrl) {
          try {
            const blob = await (await fetch(data.audioUrl)).blob();
            if (cancelled) return;
            const name = data.audioName || "saved-track.mp3";
            const file = new File([blob], name, {
              type: blob.type || "audio/mpeg",
            });
            setAudioFile(file);
          } catch {
            /* couldn't refetch, user re-uploads */
          }
        }
      } catch {
        /* offline or storage not configured */
      } finally {
        hydratedRef.current = true;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydratedRef.current) return;
    const handle = setTimeout(() => {
      void (async () => {
        try {
          setPersistState("saving");
          const r = await fetch("/api/save-quote", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ quote }),
          });
          if (r.ok) {
            setPersistState("saved");
            setPersistMsg("saved");
          } else {
            const err = await r.json().catch(() => ({}));
            setPersistState("error");
            setPersistMsg(err.error || `save failed (${r.status})`);
          }
        } catch (e) {
          setPersistState("error");
          setPersistMsg((e as Error).message);
        }
      })();
    }, 800);
    return () => clearTimeout(handle);
  }, [quote]);

  const onAudioPicked = useCallback(async (file: File | null) => {
    setAudioFile(file);
    if (!file || !hydratedRef.current) return;
    try {
      setPersistState("saving");
      const form = new FormData();
      form.append("audio", file);
      const r = await fetch("/api/save-audio", { method: "POST", body: form });
      if (r.ok) {
        setPersistState("saved");
        setPersistMsg("saved");
      } else {
        const err = await r.json().catch(() => ({}));
        setPersistState("error");
        setPersistMsg(err.error || `upload failed (${r.status})`);
      }
    } catch (e) {
      setPersistState("error");
      setPersistMsg((e as Error).message);
    }
  }, []);

  function describeError(e: unknown): string {
    if (e instanceof Error) {
      return e.message || e.toString() || e.name || "Error with no details";
    }
    if (typeof e === "string") return e;
    if (e === undefined) return "thrown undefined (FFmpeg internal failure most likely)";
    if (e === null) return "thrown null";
    try {
      const s = JSON.stringify(e);
      return s === "{}" ? Object.prototype.toString.call(e) : s;
    } catch {
      return Object.prototype.toString.call(e);
    }
  }

  const reportProgress = useCallback((p: RenderProgress) => {
    lastPhaseRef.current = p.phase;
    setProgress(p);
  }, []);

  const onGenerate = useCallback(async () => {
    if (!audioFile || !quote.trim()) return;
    if (library.length === 0) return;
    try {
      setStage("analyzing");
      reportProgress({ phase: "analyzing audio", pct: 5 });
      const audioBuf = await audioFile.arrayBuffer();
      const tempo = await detectTempo(audioBuf.slice(0));
      setBpm(tempo);

      setStage("rendering");
      const url = await renderVideo({
        audio: new Uint8Array(audioBuf),
        bpm: tempo,
        quote,
        library,
        onProgress: reportProgress,
      });
      setOutputUrl(url);
      setStage("done");
    } catch (e) {
      console.error("Render failed during phase:", lastPhaseRef.current, "Error:", e);
      const msg = describeError(e);
      setProgress({
        phase: `error during "${lastPhaseRef.current || "setup"}" - ${msg}`,
        pct: 0,
      });
      setStage("idle");
    }
  }, [audioFile, quote, library, reportProgress]);

  const reset = () => {
    setStage("idle");
    setOutputUrl(null);
    setProgress({ phase: "", pct: 0 });
    setBpm(null);
  };

  const noBooks = books.length === 0;
  const activeNoCategories = !!activeBook && activeBook.categories.length === 0;
  const libraryIncomplete =
    !!activeBook && missingCategories.length > 0 && activeBook.categories.length > 0;
  const renderReady =
    !!activeBook && activeBook.categories.length > 0 && missingCategories.length === 0;

  return (
    <main className="min-h-screen px-6 md:px-16 py-6 md:py-8 max-w-4xl mx-auto">
      <header className="mb-6 flex items-baseline justify-between border-b border-line2 pb-3">
        <h1 className="h-serif text-3xl md:text-4xl text-ink leading-none tracking-tight">
          aesthetic<span className="text-sepia">.</span>
        </h1>
        {persistMsg && (
          <div
            className={`h-mono text-[10px] uppercase tracking-[0.2em] ${
              persistState === "error" ? "text-red-700" : "text-dim"
            }`}
          >
            {persistState === "saving" ? "saving…" : persistMsg}
          </div>
        )}
      </header>

      <section className="mb-12 border border-line2 px-6 py-5 bg-surface">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex-1 min-w-[16rem]">
            <div className="h-mono text-[10px] uppercase tracking-[0.2em] text-dim mb-2">
              book
            </div>
            {noBooks ? (
              <div className="h-serif-italic text-2xl text-muted">no books yet</div>
            ) : (
              <select
                value={activeBookId ?? ""}
                onChange={(e) => setActiveBookId(e.target.value || null)}
                className="w-full bg-bg border border-line2 px-4 py-3 text-ink focus:border-ink focus:outline-none h-serif text-xl"
              >
                {books.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.title}
                  </option>
                ))}
              </select>
            )}
          </div>
          <button
            onClick={() => setShowManager((v) => !v)}
            className="px-4 py-3 border border-line2 h-mono text-[11px] uppercase tracking-[0.2em] text-dim hover:text-ink hover:border-ink transition-colors"
          >
            {showManager ? "close manager" : noBooks ? "add a book" : "manage books"}
          </button>
        </div>

        {showManager && (
          <div className="mt-6 pt-6 border-t border-line2">
            <BookManager
              books={books}
              activeBookId={activeBookId}
              onBooksChanged={async () => {
                const list = await refreshBooks();
                if (activeBookId && !list.find((b) => b.id === activeBookId)) {
                  setActiveBookId(list[0]?.id ?? null);
                }
                if (list.length > 0 && !activeBookId) {
                  setActiveBookId(list[0].id);
                }
              }}
              onSelect={(id) => setActiveBookId(id)}
            />
          </div>
        )}
      </section>

      {activeBook && activeNoCategories && (
        <section className="mb-12 border border-line2 px-6 py-6 bg-surface">
          <div className="h-mono text-[10px] uppercase tracking-[0.2em] text-dim mb-2">
            setup · categories
          </div>
          <h2 className="h-serif text-3xl text-ink mb-3">
            {activeBook.title} has no categories yet.
          </h2>
          <p className="text-muted text-sm mb-4 max-w-lg leading-relaxed">
            Open the book manager above to add categories, then come back here to generate the stills bank.
          </p>
          <button
            onClick={() => setShowManager(true)}
            className="px-5 py-3 bg-ink text-bg h-serif text-lg hover:bg-sepia transition-colors"
          >
            add categories
          </button>
        </section>
      )}

      {activeBook && libraryIncomplete && libraryReady && (
        <section className="mb-12 border border-line2 px-6 py-6 bg-surface">
          <div className="h-mono text-[10px] uppercase tracking-[0.2em] text-dim mb-2">
            setup · stills bank
          </div>
          <h2 className="h-serif text-3xl text-ink mb-2">
            {library.length === 0 ? "the bank is empty." : "the bank is incomplete."}
          </h2>
          <p className="text-muted text-sm mb-5 max-w-lg leading-relaxed">
            {library.length} of {activeBook.categories.length} categories ready for{" "}
            <span className="h-serif-italic">{activeBook.title}</span>. Missing:{" "}
            <span className="h-mono text-xs">{missingCategories.join(", ")}</span>.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-5">
            {activeBook.categories.map((c) => {
              const have = library.some((s) => s.id === c.id);
              const gen = generating[c.id];
              return (
                <div
                  key={c.id}
                  className={`text-[11px] px-3 py-2 border ${
                    have
                      ? "border-line2 text-ink"
                      : gen === "pending"
                      ? "border-sepia text-sepia"
                      : gen === "fail"
                      ? "border-red-400 text-red-700"
                      : "border-line2 text-dim"
                  }`}
                >
                  <span className="h-mono text-[10px] uppercase tracking-wider">
                    {have ? "✓" : gen === "pending" ? "…" : gen === "fail" ? "✕" : "·"}
                  </span>{" "}
                  {c.label}
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={onGenerateLibrary}
              disabled={Object.values(generating).some((v) => v === "pending")}
              className="px-6 py-3 bg-ink text-bg h-serif text-lg hover:bg-sepia transition-colors disabled:bg-line2 disabled:text-dim disabled:cursor-not-allowed"
            >
              {Object.values(generating).some((v) => v === "pending")
                ? "generating…"
                : library.length === 0
                ? "generate library"
                : `generate ${missingCategories.length} missing`}
            </button>
            <a
              href="/api/auth/higgsfield"
              className="px-4 py-3 border border-line2 h-mono text-[11px] uppercase tracking-[0.2em] text-dim hover:text-ink hover:border-ink transition-colors"
            >
              connect higgsfield
            </a>
          </div>
        </section>
      )}

      {stage === "idle" && renderReady && (
        <div className="space-y-16">
          {progress.phase.startsWith("error") && (
            <div className="border border-red-700 bg-red-50 px-5 py-4 text-red-900">
              <div className="h-mono text-[10px] uppercase tracking-[0.2em] mb-1">
                render failed
              </div>
              <div className="text-sm break-words">{progress.phase}</div>
            </div>
          )}

          <Step num="i" title="the song">
            <input
              ref={fileRef}
              type="file"
              accept="audio/*"
              onChange={(e) => onAudioPicked(e.target.files?.[0] ?? null)}
              className="hidden"
              id="audio-upload"
            />
            <label
              htmlFor="audio-upload"
              className="block border border-line2 px-6 py-8 cursor-pointer hover:border-ink transition-colors group"
            >
              {audioFile ? (
                <>
                  <div className="text-ink text-lg">{audioFile.name}</div>
                  <div className="h-mono text-[10px] uppercase tracking-[0.2em] text-dim mt-2">
                    {(audioFile.size / 1024 / 1024).toFixed(2)} mb · click to replace
                  </div>
                </>
              ) : (
                <>
                  <div className="h-serif-italic text-2xl text-muted group-hover:text-ink transition-colors">
                    drop a track
                  </div>
                  <div className="h-mono text-[10px] uppercase tracking-[0.2em] text-dim mt-2">
                    mp3 or wav · instrumental · 60-100 bpm preferred
                  </div>
                </>
              )}
            </label>
          </Step>

          <Step num="ii" title="the words">
            <textarea
              value={quote}
              onChange={(e) => setQuote(e.target.value)}
              placeholder={"someone once said\nsomething that lived rent free in your head\nand never left"}
              className="w-full bg-surface border border-line2 px-5 py-4 text-ink placeholder:text-dim resize-none focus:border-ink focus:outline-none transition-colors leading-relaxed"
              rows={6}
            />
            <div className="h-mono text-[10px] uppercase tracking-[0.2em] text-dim mt-2 flex justify-between">
              <span>{quote.length} chars</span>
              <span>three paragraphs reads best</span>
            </div>
          </Step>

          <button
            onClick={onGenerate}
            disabled={!audioFile || !quote.trim()}
            className="w-full mt-8 py-6 bg-ink text-bg h-serif text-3xl tracking-tight hover:bg-sepia transition-colors disabled:bg-line2 disabled:text-dim disabled:cursor-not-allowed"
          >
            generate
          </button>
        </div>
      )}

      {(stage === "analyzing" || stage === "rendering") && (
        <div className="space-y-8 mt-12">
          <div className="h-mono text-[10px] uppercase tracking-[0.3em] text-dim">in progress</div>
          <div className="h-serif-italic text-5xl md:text-6xl text-ink leading-tight">
            {progress.phase || "working…"}
          </div>
          <div className="h-px bg-line2 relative overflow-hidden">
            <div
              className="absolute inset-y-0 left-0 bg-ink transition-all duration-500"
              style={{ width: `${progress.pct}%` }}
            />
          </div>
          <div className="h-mono text-[11px] uppercase tracking-[0.2em] text-muted flex justify-between">
            <span>{Math.round(progress.pct)}% complete</span>
            {bpm && <span>{bpm} bpm detected</span>}
          </div>
          <p className="text-muted text-sm max-w-md leading-relaxed pt-12 border-t border-line">
            Rendering happens on this device. Your audio never leaves the browser.
            30 seconds of music ≈ 60 seconds to render.
          </p>
        </div>
      )}

      {stage === "done" && outputUrl && (
        <div className="space-y-8 mt-8">
          <div className="h-mono text-[10px] uppercase tracking-[0.3em] text-dim">ready</div>
          <h2 className="h-serif-italic text-5xl md:text-6xl text-ink">it&rsquo;s done.</h2>

          <video
            src={outputUrl}
            controls
            className="w-full max-w-xs mx-auto border border-line2"
          />

          <div className="grid grid-cols-2 gap-3 max-w-xs mx-auto">
            <a
              href={outputUrl}
              download="aesthetic.mp4"
              className="py-3 bg-ink text-bg h-serif text-lg text-center hover:bg-sepia transition-colors"
            >
              download
            </a>
            <button
              onClick={reset}
              className="py-3 border border-line2 text-muted h-serif text-lg hover:border-ink hover:text-ink transition-colors"
            >
              another
            </button>
          </div>
        </div>
      )}

      <footer className="mt-32 pt-6 border-t border-line h-mono text-[10px] uppercase tracking-[0.2em] text-dim flex justify-between">
        <span>rendered on device</span>
        <span>aesthetic / 2026</span>
      </footer>
    </main>
  );
}

function Step({ num, title, children }: { num: string; title: string; children: React.ReactNode }) {
  return (
    <section className="grid grid-cols-[3rem_1fr] md:grid-cols-[5rem_1fr] gap-4 md:gap-8">
      <div className="pt-1">
        <div className="h-serif-italic text-4xl md:text-5xl text-sepia leading-none">{num}.</div>
      </div>
      <div>
        <h2 className="h-serif text-3xl md:text-4xl text-ink mb-5 leading-none">{title}</h2>
        {children}
      </div>
    </section>
  );
}

function BookManager({
  books,
  activeBookId,
  onBooksChanged,
  onSelect,
}: {
  books: Book[];
  activeBookId: string | null;
  onBooksChanged: () => Promise<void> | void;
  onSelect: (id: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newCover, setNewCover] = useState<File | null>(null);
  const [copyFromId, setCopyFromId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>("");
  const [expandedId, setExpandedId] = useState<string | null>(activeBookId);

  const submitNewBook = useCallback(async () => {
    if (!newTitle.trim() || !newCover) return;
    setSubmitting(true);
    setError("");
    try {
      const form = new FormData();
      form.append("title", newTitle.trim());
      form.append("cover", newCover);
      if (copyFromId) form.append("copyFromBookId", copyFromId);
      const r = await fetch("/api/books", { method: "POST", body: form });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || `create failed (${r.status})`);
      }
      const data = (await r.json()) as { book: Book };
      setNewTitle("");
      setNewCover(null);
      setCopyFromId("");
      setAdding(false);
      await onBooksChanged();
      onSelect(data.book.id);
      setExpandedId(data.book.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }, [newTitle, newCover, copyFromId, onBooksChanged, onSelect]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="h-mono text-[10px] uppercase tracking-[0.2em] text-dim">
          books · {books.length}
        </div>
        <button
          onClick={() => setAdding((v) => !v)}
          className="h-mono text-[11px] uppercase tracking-[0.2em] text-dim hover:text-ink transition-colors"
        >
          {adding ? "cancel" : "+ new book"}
        </button>
      </div>

      {adding && (
        <div className="border border-line2 px-5 py-5 mb-6 bg-bg">
          <div className="space-y-4">
            <div>
              <label className="h-mono text-[10px] uppercase tracking-[0.2em] text-dim block mb-2">
                title
              </label>
              <input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="book title"
                className="w-full bg-bg border border-line2 px-4 py-2 text-ink focus:border-ink focus:outline-none"
              />
            </div>
            <div>
              <label className="h-mono text-[10px] uppercase tracking-[0.2em] text-dim block mb-2">
                cover image
              </label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setNewCover(e.target.files?.[0] ?? null)}
                className="w-full text-sm text-muted file:mr-3 file:px-4 file:py-2 file:border file:border-line2 file:bg-bg file:text-ink file:h-mono file:text-[11px] file:uppercase file:tracking-[0.2em] file:cursor-pointer"
              />
              {newCover && (
                <div className="h-mono text-[10px] uppercase tracking-[0.2em] text-dim mt-1">
                  {newCover.name} · {(newCover.size / 1024).toFixed(0)} kb
                </div>
              )}
            </div>
            {books.length > 0 && (
              <div>
                <label className="h-mono text-[10px] uppercase tracking-[0.2em] text-dim block mb-2">
                  copy categories from (optional)
                </label>
                <select
                  value={copyFromId}
                  onChange={(e) => setCopyFromId(e.target.value)}
                  className="w-full bg-bg border border-line2 px-4 py-2 text-ink focus:border-ink focus:outline-none"
                >
                  <option value="">start with no categories</option>
                  {books.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.title} ({b.categories.length})
                    </option>
                  ))}
                </select>
              </div>
            )}
            {error && (
              <div className="text-red-700 text-sm border border-red-400 px-3 py-2">
                {error}
              </div>
            )}
            <button
              onClick={submitNewBook}
              disabled={!newTitle.trim() || !newCover || submitting}
              className="px-5 py-2 bg-ink text-bg h-serif text-lg hover:bg-sepia transition-colors disabled:bg-line2 disabled:text-dim disabled:cursor-not-allowed"
            >
              {submitting ? "creating…" : "create book"}
            </button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {books.map((b) => (
          <BookRow
            key={b.id}
            book={b}
            expanded={expandedId === b.id}
            isActive={b.id === activeBookId}
            onToggleExpand={() => setExpandedId(expandedId === b.id ? null : b.id)}
            onSelect={() => onSelect(b.id)}
            onChanged={onBooksChanged}
          />
        ))}
      </div>
    </div>
  );
}

function BookRow({
  book,
  expanded,
  isActive,
  onToggleExpand,
  onSelect,
  onChanged,
}: {
  book: Book;
  expanded: boolean;
  isActive: boolean;
  onToggleExpand: () => void;
  onSelect: () => void;
  onChanged: () => Promise<void> | void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState(book.title);

  const onRename = useCallback(async () => {
    if (!titleDraft.trim() || titleDraft.trim() === book.title) {
      setRenaming(false);
      return;
    }
    const r = await fetch(`/api/books/${book.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: titleDraft.trim() }),
    });
    if (r.ok) {
      await onChanged();
    }
    setRenaming(false);
  }, [titleDraft, book.title, book.id, onChanged]);

  const onDelete = useCallback(async () => {
    if (!confirm(`delete "${book.title}"? this removes its cover and all generated stills.`)) {
      return;
    }
    const r = await fetch(`/api/books/${book.id}`, { method: "DELETE" });
    if (r.ok) await onChanged();
  }, [book.id, book.title, onChanged]);

  return (
    <div className={`border ${isActive ? "border-ink" : "border-line2"} bg-bg`}>
      <div className="flex items-center gap-4 px-4 py-3">
        <img
          src={book.coverUrl}
          alt=""
          className="w-12 h-16 object-cover border border-line2"
        />
        <div className="flex-1 min-w-0">
          {renaming ? (
            <div className="flex gap-2">
              <input
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                className="flex-1 bg-bg border border-line2 px-2 py-1 text-ink text-sm focus:border-ink focus:outline-none"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") void onRename();
                  if (e.key === "Escape") {
                    setTitleDraft(book.title);
                    setRenaming(false);
                  }
                }}
              />
              <button
                onClick={onRename}
                className="h-mono text-[10px] uppercase tracking-[0.2em] text-dim hover:text-ink"
              >
                save
              </button>
            </div>
          ) : (
            <button
              onClick={() => {
                onSelect();
                onToggleExpand();
              }}
              className="text-left w-full"
            >
              <div className={`h-serif text-xl ${isActive ? "text-ink" : "text-muted"} truncate`}>
                {book.title}
              </div>
              <div className="h-mono text-[10px] uppercase tracking-[0.2em] text-dim mt-1">
                {book.categories.length} categories
                {isActive ? " · active" : ""}
              </div>
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setRenaming((v) => !v)}
            className="h-mono text-[10px] uppercase tracking-[0.2em] text-dim hover:text-ink"
          >
            rename
          </button>
          <button
            onClick={onDelete}
            className="h-mono text-[10px] uppercase tracking-[0.2em] text-red-700 hover:text-red-900"
          >
            delete
          </button>
        </div>
      </div>
      {expanded && (
        <div className="border-t border-line2 px-4 py-4">
          <CategoryEditor book={book} onChanged={onChanged} />
        </div>
      )}
    </div>
  );
}

function CategoryEditor({
  book,
  onChanged,
}: {
  book: Book;
  onChanged: () => Promise<void> | void;
}) {
  const [bulk, setBulk] = useState("");
  const [bulkError, setBulkError] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);

  const [rowLabel, setRowLabel] = useState("");
  const [rowPrompt, setRowPrompt] = useState("");
  const [rowBusy, setRowBusy] = useState(false);
  const [rowError, setRowError] = useState("");

  const submitBulk = useCallback(async () => {
    setBulkError("");
    const rows = bulk
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (rows.length === 0) return;
    const parsed: Array<{ id?: string; label: string; prompt: string }> = [];
    const malformed: number[] = [];
    rows.forEach((line, idx) => {
      // Accept "label | prompt" or "id, label, prompt" or "id | label | prompt"
      const pipeParts = line.split("|").map((s) => s.trim()).filter(Boolean);
      if (pipeParts.length === 2) {
        parsed.push({ label: pipeParts[0], prompt: pipeParts[1] });
        return;
      }
      if (pipeParts.length >= 3) {
        parsed.push({
          id: pipeParts[0],
          label: pipeParts[1],
          prompt: pipeParts.slice(2).join(" | "),
        });
        return;
      }
      const commaParts = splitFirstTwoCommas(line);
      if (commaParts.length === 3) {
        parsed.push({
          id: commaParts[0],
          label: commaParts[1],
          prompt: commaParts[2],
        });
        return;
      }
      if (commaParts.length === 2) {
        parsed.push({ label: commaParts[0], prompt: commaParts[1] });
        return;
      }
      malformed.push(idx + 1);
    });
    if (parsed.length === 0) {
      setBulkError(
        "no valid rows. use `label | prompt` per line, or `id, label, prompt`.",
      );
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
      if (malformed.length) {
        setBulkError(`skipped malformed line(s): ${malformed.join(", ")}`);
      }
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
        <div className="h-mono text-[10px] uppercase tracking-[0.2em] text-dim mb-2">
          bulk paste · one per line
        </div>
        <textarea
          value={bulk}
          onChange={(e) => setBulk(e.target.value)}
          placeholder={"books | a hand pulling a leather-bound book from a shelf, low-angle\ncoffee | a top-down ceramic mug of black coffee on a dark desk"}
          className="w-full bg-bg border border-line2 px-3 py-2 text-ink placeholder:text-dim text-sm font-mono resize-y focus:border-ink focus:outline-none"
          rows={4}
        />
        <div className="h-mono text-[10px] uppercase tracking-[0.2em] text-dim mt-1">
          format: <span className="text-ink">label | prompt</span> or{" "}
          <span className="text-ink">id, label, prompt</span>
        </div>
        {bulkError && (
          <div className="text-red-700 text-sm border border-red-400 px-3 py-2 mt-2">
            {bulkError}
          </div>
        )}
        <button
          onClick={submitBulk}
          disabled={!bulk.trim() || bulkBusy}
          className="mt-3 px-4 py-2 bg-ink text-bg h-serif text-base hover:bg-sepia transition-colors disabled:bg-line2 disabled:text-dim disabled:cursor-not-allowed"
        >
          {bulkBusy ? "adding…" : "add all"}
        </button>
      </div>

      <div className="border-t border-line2 pt-5">
        <div className="h-mono text-[10px] uppercase tracking-[0.2em] text-dim mb-2">
          add one
        </div>
        <div className="grid grid-cols-1 md:grid-cols-[10rem_1fr] gap-2">
          <input
            value={rowLabel}
            onChange={(e) => setRowLabel(e.target.value)}
            placeholder="label"
            className="bg-bg border border-line2 px-3 py-2 text-ink placeholder:text-dim focus:border-ink focus:outline-none"
          />
          <input
            value={rowPrompt}
            onChange={(e) => setRowPrompt(e.target.value)}
            placeholder="prompt"
            className="bg-bg border border-line2 px-3 py-2 text-ink placeholder:text-dim focus:border-ink focus:outline-none"
          />
        </div>
        {rowError && (
          <div className="text-red-700 text-sm border border-red-400 px-3 py-2 mt-2">
            {rowError}
          </div>
        )}
        <button
          onClick={submitRow}
          disabled={!rowLabel.trim() || !rowPrompt.trim() || rowBusy}
          className="mt-3 px-4 py-2 border border-line2 text-ink h-mono text-[11px] uppercase tracking-[0.2em] hover:bg-ink hover:text-bg transition-colors disabled:text-dim disabled:cursor-not-allowed"
        >
          {rowBusy ? "adding…" : "add"}
        </button>
      </div>

      {book.categories.length > 0 && (
        <div className="border-t border-line2 pt-5">
          <div className="h-mono text-[10px] uppercase tracking-[0.2em] text-dim mb-3">
            existing · {book.categories.length}
          </div>
          <div className="space-y-2">
            {book.categories.map((c) => (
              <CategoryRow
                key={c.id}
                bookId={book.id}
                category={c}
                onChanged={onChanged}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CategoryRow({
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
    if (!confirm(`remove "${category.label}"? this also deletes its generated still.`)) {
      return;
    }
    const r = await fetch(
      `/api/books/${bookId}/categories/${category.id}`,
      { method: "DELETE" },
    );
    if (r.ok) await onChanged();
  }, [bookId, category.id, category.label, onChanged]);

  return (
    <div className="border border-line2 px-3 py-2">
      {editing ? (
        <div className="space-y-2">
          <input
            value={labelDraft}
            onChange={(e) => setLabelDraft(e.target.value)}
            className="w-full bg-bg border border-line2 px-2 py-1 text-ink text-sm focus:border-ink focus:outline-none"
          />
          <textarea
            value={promptDraft}
            onChange={(e) => setPromptDraft(e.target.value)}
            rows={2}
            className="w-full bg-bg border border-line2 px-2 py-1 text-ink text-sm focus:border-ink focus:outline-none resize-y"
          />
          <div className="flex gap-3">
            <button
              onClick={save}
              disabled={busy || !labelDraft.trim() || !promptDraft.trim()}
              className="h-mono text-[10px] uppercase tracking-[0.2em] text-dim hover:text-ink disabled:opacity-50"
            >
              {busy ? "saving…" : "save"}
            </button>
            <button
              onClick={() => {
                setLabelDraft(category.label);
                setPromptDraft(category.prompt);
                setEditing(false);
              }}
              className="h-mono text-[10px] uppercase tracking-[0.2em] text-dim hover:text-ink"
            >
              cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-ink text-sm">{category.label}</div>
            <div className="h-mono text-[10px] text-dim mt-1">id: {category.id}</div>
            <div className="text-muted text-xs mt-1 leading-relaxed">{category.prompt}</div>
          </div>
          <div className="flex flex-col gap-2 items-end">
            <button
              onClick={() => setEditing(true)}
              className="h-mono text-[10px] uppercase tracking-[0.2em] text-dim hover:text-ink"
            >
              edit
            </button>
            <button
              onClick={remove}
              className="h-mono text-[10px] uppercase tracking-[0.2em] text-red-700 hover:text-red-900"
            >
              remove
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function splitFirstTwoCommas(s: string): string[] {
  const i = s.indexOf(",");
  if (i === -1) return [s.trim()];
  const j = s.indexOf(",", i + 1);
  if (j === -1) {
    return [s.slice(0, i).trim(), s.slice(i + 1).trim()];
  }
  return [
    s.slice(0, i).trim(),
    s.slice(i + 1, j).trim(),
    s.slice(j + 1).trim(),
  ];
}
