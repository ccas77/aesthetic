"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import Link from "next/link";
import { renderVideo, type RenderProgress } from "@/lib/render";
import { detectTempo } from "@/lib/beat-detect";
import type { Still } from "@/lib/library";
import type { Book } from "@/lib/books-store";
import type { FillerStill } from "@/lib/filler-store";

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
  const [bookStills, setBookStills] = useState<Still[]>([]);
  const [fillerStills, setFillerStills] = useState<Still[]>([]);
  const [bookMissing, setBookMissing] = useState<string[]>([]);

  const fileRef = useRef<HTMLInputElement>(null);
  const lastPhaseRef = useRef<string>("");
  const hydratedRef = useRef<boolean>(false);

  const activeBook = useMemo(
    () => books.find((b) => b.id === activeBookId) ?? null,
    [books, activeBookId],
  );

  const combinedLibrary = useMemo(
    () => [...bookStills, ...fillerStills],
    [bookStills, fillerStills],
  );

  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch("/api/books", { cache: "no-store" });
        if (!r.ok) return;
        const data = (await r.json()) as { books?: Book[] };
        const list = data.books ?? [];
        setBooks(list);
        if (!activeBookId && list.length > 0) {
          setActiveBookId(list[0].id);
        }
      } catch {
        /* ignore */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch("/api/filler", { cache: "no-store" });
        if (!r.ok) return;
        const data = (await r.json()) as { stills?: FillerStill[] };
        const f = (data.stills ?? []).map((s) => ({
          id: `filler:${s.id}`,
          url: s.url,
          tags: [] as string[],
        }));
        setFillerStills(f);
      } catch {
        /* ignore */
      }
    })();
  }, []);

  useEffect(() => {
    if (!activeBookId) {
      setBookStills([]);
      setBookMissing([]);
      return;
    }
    void (async () => {
      try {
        const r = await fetch(
          `/api/library?bookId=${encodeURIComponent(activeBookId)}`,
          { cache: "no-store" },
        );
        if (!r.ok) return;
        const data = (await r.json()) as {
          stills?: Still[];
          missing?: string[];
        };
        setBookStills(data.stills ?? []);
        setBookMissing(data.missing ?? []);
      } catch {
        /* ignore */
      }
    })();
  }, [activeBookId]);

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
            /* ignore */
          }
        }
      } catch {
        /* ignore */
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
    if (combinedLibrary.length === 0) return;
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
        library: combinedLibrary,
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
  }, [audioFile, quote, combinedLibrary, reportProgress]);

  const reset = () => {
    setStage("idle");
    setOutputUrl(null);
    setProgress({ phase: "", pct: 0 });
    setBpm(null);
  };

  const noBooks = books.length === 0;
  const activeNoCategories = !!activeBook && activeBook.categories.length === 0;
  const renderReady = combinedLibrary.length > 0;

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

      <div className="mb-8 flex flex-wrap items-center gap-3">
        <span className="text-xs text-muted uppercase tracking-wider">book</span>
        {noBooks ? (
          <span className="text-muted text-sm">none yet</span>
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
        <Link
          href="/books"
          className="text-sm text-muted hover:text-ink underline underline-offset-4 ml-auto"
        >
          manage books →
        </Link>
      </div>

      {noBooks && (
        <section className="mb-8 bg-surface border border-line rounded-md px-4 py-5">
          <h2 className="text-lg text-ink mb-1">No books yet.</h2>
          <p className="text-sm text-muted mb-3">
            Add a book first (cover image + categories), then come back here to render a video.
          </p>
          <Link
            href="/books"
            className="inline-block px-4 py-2 bg-ink text-bg rounded hover:bg-sepia transition-colors"
          >
            go to books
          </Link>
        </section>
      )}

      {activeBook && activeNoCategories && (
        <section className="mb-8 bg-surface border border-line rounded-md px-4 py-5">
          <h2 className="text-lg text-ink mb-1">
            <span className="h-serif italic">{activeBook.title}</span> has no categories yet.
          </h2>
          <p className="text-sm text-muted mb-3">
            Add categories to the book, then generate or upload stills.
          </p>
          <Link
            href="/books"
            className="inline-block px-4 py-2 bg-ink text-bg rounded hover:bg-sepia transition-colors"
          >
            edit book
          </Link>
        </section>
      )}

      {activeBook && !activeNoCategories && bookMissing.length > 0 && (
        <section className="mb-8 bg-surface border border-line rounded-md px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-ink">
                {activeBook.title}: {bookMissing.length} categor{bookMissing.length === 1 ? "y" : "ies"} missing stills
              </h2>
              <p className="text-xs text-muted mt-1">
                Generate or upload them from the book page. Filler stills can still let you render in the meantime.
              </p>
            </div>
            <Link
              href="/books"
              className="px-3 py-1.5 border border-line2 rounded text-sm text-ink hover:bg-ink hover:text-bg transition-colors shrink-0"
            >
              fix
            </Link>
          </div>
        </section>
      )}

      {stage === "idle" && renderReady && (
        <div className="space-y-12">
          {progress.phase.startsWith("error") && (
            <div className="border border-red-700 bg-red-50 px-4 py-3 rounded">
              <div className="text-xs uppercase tracking-wider text-red-900 mb-1">
                render failed
              </div>
              <div className="text-sm break-words text-red-900">{progress.phase}</div>
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
              className="block border border-line2 rounded px-6 py-6 cursor-pointer hover:border-ink transition-colors"
            >
              {audioFile ? (
                <>
                  <div className="text-ink">{audioFile.name}</div>
                  <div className="text-xs text-dim mt-1">
                    {(audioFile.size / 1024 / 1024).toFixed(2)} mb · click to replace
                  </div>
                </>
              ) : (
                <>
                  <div className="h-serif italic text-xl text-muted">drop a track</div>
                  <div className="text-xs text-dim mt-1">
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
              placeholder={"someone once said something\nthat lived rent-free in your head\nand never left"}
              className="w-full bg-surface border border-line2 rounded px-4 py-3 text-ink placeholder:text-dim resize-none focus:border-ink focus:outline-none transition-colors leading-relaxed"
              rows={6}
            />
            <div className="text-xs text-dim mt-2 flex justify-between">
              <span>{quote.length} chars</span>
              <span>three paragraphs reads best</span>
            </div>
          </Step>

          <button
            onClick={onGenerate}
            disabled={!audioFile || !quote.trim()}
            className="w-full py-5 bg-ink text-bg h-serif text-2xl tracking-tight hover:bg-sepia transition-colors disabled:bg-line2 disabled:text-dim disabled:cursor-not-allowed rounded"
          >
            generate
          </button>
        </div>
      )}

      {(stage === "analyzing" || stage === "rendering") && (
        <div className="space-y-6 mt-8">
          <div className="text-xs uppercase tracking-wider text-muted">in progress</div>
          <div className="h-serif italic text-3xl md:text-4xl text-ink leading-tight">
            {progress.phase || "working…"}
          </div>
          <div className="h-1 bg-line rounded relative overflow-hidden">
            <div
              className="absolute inset-y-0 left-0 bg-ink transition-all duration-500"
              style={{ width: `${progress.pct}%` }}
            />
          </div>
          <div className="text-xs text-muted flex justify-between">
            <span>{Math.round(progress.pct)}% complete</span>
            {bpm && <span>{bpm} bpm detected</span>}
          </div>
          <p className="text-muted text-sm leading-relaxed pt-6 border-t border-line">
            Rendering happens on this device. Your audio never leaves the browser. 30 seconds of music ≈ 60 seconds to render.
          </p>
        </div>
      )}

      {stage === "done" && outputUrl && (
        <div className="space-y-6 mt-8">
          <div className="text-xs uppercase tracking-wider text-muted">ready</div>
          <h2 className="h-serif italic text-3xl md:text-4xl text-ink">it&rsquo;s done.</h2>
          <video
            src={outputUrl}
            controls
            className="w-full max-w-xs mx-auto border border-line2 rounded"
          />
          <div className="grid grid-cols-2 gap-3 max-w-xs mx-auto">
            <a
              href={outputUrl}
              download="aesthetic.mp4"
              className="py-3 bg-ink text-bg rounded text-center hover:bg-sepia transition-colors"
            >
              download
            </a>
            <button
              onClick={reset}
              className="py-3 border border-line2 rounded text-muted hover:border-ink hover:text-ink transition-colors"
            >
              another
            </button>
          </div>
        </div>
      )}

      <footer className="mt-24 pt-4 border-t border-line text-xs text-dim flex justify-between">
        <span>rendered on device</span>
        <span>aesthetic / 2026</span>
      </footer>
    </main>
  );
}

function Step({
  num,
  title,
  children,
}: {
  num: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid grid-cols-[2.5rem_1fr] md:grid-cols-[4rem_1fr] gap-3 md:gap-6">
      <div className="pt-1">
        <div className="h-serif italic text-3xl md:text-4xl text-sepia leading-none">{num}.</div>
      </div>
      <div>
        <h2 className="h-serif text-2xl md:text-3xl text-ink mb-3 leading-none">{title}</h2>
        {children}
      </div>
    </section>
  );
}
