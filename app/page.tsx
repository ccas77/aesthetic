"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { renderVideo, type RenderProgress } from "@/lib/render";
import { detectTempo } from "@/lib/beat-detect";
import type { Still } from "@/lib/library";
import { BANK } from "@/lib/bank";

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
  const [library, setLibrary] = useState<Still[]>([]);
  const [libraryReady, setLibraryReady] = useState<boolean>(false);
  const [missingCategories, setMissingCategories] = useState<string[]>([]);
  const [generating, setGenerating] = useState<Record<string, "pending" | "ok" | "fail">>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const lastPhaseRef = useRef<string>("");
  const hydratedRef = useRef<boolean>(false);

  // === Load the global stills bank from /api/library ===
  const loadLibrary = useCallback(async () => {
    try {
      const r = await fetch("/api/library", { cache: "no-store" });
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

  useEffect(() => { void loadLibrary(); }, [loadLibrary]);

  // === Generate any missing categories ===
  const onGenerateLibrary = useCallback(async () => {
    const targets = missingCategories.length > 0 ? missingCategories : BANK.map((c) => c.id);
    setGenerating(Object.fromEntries(targets.map((id) => [id, "pending"])));
    await Promise.all(
      targets.map(async (id) => {
        try {
          const r = await fetch("/api/admin/generate-still", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ category: id }),
          });
          setGenerating((g) => ({ ...g, [id]: r.ok ? "ok" : "fail" }));
        } catch {
          setGenerating((g) => ({ ...g, [id]: "fail" }));
        }
      }),
    );
    await loadLibrary();
  }, [missingCategories, loadLibrary]);

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
          setPersistMsg("server storage not configured — saves won't persist");
        }
        if (data.quote) setQuote(data.quote);
        if (data.audioUrl) {
          // Pull the audio back as a File so the renderer can use it unchanged
          try {
            const blob = await (await fetch(data.audioUrl)).blob();
            if (cancelled) return;
            const name = data.audioName || "saved-track.mp3";
            const file = new File([blob], name, {
              type: blob.type || "audio/mpeg",
            });
            setAudioFile(file);
          } catch {
            /* couldn't refetch — fine, user re-uploads */
          }
        }
      } catch {
        /* offline or storage not configured — silent */
      } finally {
        hydratedRef.current = true;
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // === Persistence: debounced quote save ===
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

  // === Persistence: save audio when user uploads a new file ===
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

  // Stringify any thrown value, including non-Error throws (strings, null, undefined,
  // custom objects). FFmpeg.wasm in particular sometimes rejects with non-Errors.
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

  // Wrap setProgress so we always remember the most recent phase for error reporting.
  const reportProgress = useCallback((p: RenderProgress) => {
    lastPhaseRef.current = p.phase;
    setProgress(p);
  }, []);

  const onGenerate = useCallback(async () => {
    if (!audioFile || !quote.trim()) return;
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
        phase: `error during "${lastPhaseRef.current || "setup"}" — ${msg}`,
        pct: 0,
      });
      setStage("idle");
    }
  }, [audioFile, quote, library, reportProgress]);

  const reset = () => {
    setStage("idle"); setOutputUrl(null); setProgress({ phase: "", pct: 0 });
    setBpm(null);
    // Keep audioFile + quote — they're persisted server-side and the user
    // shouldn't have to re-enter them just because they want another render.
  };

  return (
    <main className="min-h-screen px-6 md:px-16 py-10 md:py-16 max-w-4xl mx-auto">

      {/* Masthead */}
      <header className="mb-16 md:mb-24">
        <div className="flex items-baseline justify-between border-b border-line2 pb-6">
          <h1 className="h-serif text-6xl md:text-8xl text-ink leading-none tracking-tight">
            aesthetic<span className="text-sepia">.</span>
          </h1>
          <div className="text-right">
            <div className="h-mono text-[10px] uppercase tracking-[0.2em] text-dim">№ 001</div>
            <div className="h-mono text-[10px] uppercase tracking-[0.2em] text-dim mt-1">v 0.1</div>
            {persistMsg && (
              <div
                className={`h-mono text-[10px] uppercase tracking-[0.2em] mt-1 ${
                  persistState === "error" ? "text-red-700" : "text-dim"
                }`}
              >
                {persistState === "saving" ? "saving…" : persistMsg}
              </div>
            )}
          </div>
        </div>
        <p className="h-serif-italic text-2xl md:text-3xl text-muted mt-6 max-w-xl leading-tight">
          a song and a quote — returns a video, fit for the feed.
        </p>

        {/* Tiny preview chip showing the output palette */}
        <div className="mt-10 flex items-center gap-3">
          <div className="flex h-3">
            {["#100B08","#292019","#4C392E","#6E5C4D","#8D7B6C","#BCA998"].map((c) => (
              <div key={c} className="w-4 md:w-6" style={{ backgroundColor: c }} />
            ))}
          </div>
          <span className="h-mono text-[10px] uppercase tracking-[0.2em] text-dim">
            output palette · 1080×1920
          </span>
        </div>
      </header>

      {/* Library setup — visible until the bank is fully populated */}
      {libraryReady && missingCategories.length > 0 && (
        <section className="mb-16 border border-line2 px-6 py-6 bg-surface">
          <div className="h-mono text-[10px] uppercase tracking-[0.2em] text-dim mb-2">
            setup · stills bank
          </div>
          <h2 className="h-serif text-3xl text-ink mb-2">
            {library.length === 0 ? "the bank is empty." : "the bank is incomplete."}
          </h2>
          <p className="text-muted text-sm mb-5 max-w-lg leading-relaxed">
            The app generates its own stills via Higgsfield and saves them to
            your Vercel Blob storage. {library.length} of {BANK.length} categories
            are ready. Missing: <span className="h-mono text-xs">{missingCategories.join(", ")}</span>.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-5">
            {BANK.map((c) => {
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
          <p className="h-mono text-[10px] uppercase tracking-[0.2em] text-dim mt-4 leading-relaxed">
            needs ANTHROPIC_API_KEY · HIGGSFIELD_TOKEN_SECRET · BLOB_READ_WRITE_TOKEN in vercel env, then click connect higgsfield once
          </p>
        </section>
      )}

      {stage === "idle" && (
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
                    mp3 or wav · instrumental · 60–100 bpm preferred
                  </div>
                </>
              )}
            </label>
          </Step>

          <Step num="ii" title="the words">
            <textarea
              value={quote}
              onChange={(e) => setQuote(e.target.value)}
              placeholder={'someone once said\n"you could be the most beautiful shade of green,\nbut it still wouldn\'t be enough for someone\nwho\'s favorite color is blue"\nand that healed something in me'}
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
