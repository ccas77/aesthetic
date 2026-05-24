"use client";

import { useState, useRef, useCallback } from "react";
import { renderVideo, type RenderProgress } from "@/lib/render";
import { detectTempo } from "@/lib/beat-detect";
import { LIBRARY } from "@/lib/library";

type Stage = "idle" | "analyzing" | "rendering" | "done";

const VIBES = [
  { id: "longing",  label: "longing",  hint: "slow ache, unrequited" },
  { id: "healing",  label: "healing",  hint: "after the storm" },
  { id: "fury",     label: "fury",     hint: "controlled, quiet rage" },
  { id: "wistful",  label: "wistful",  hint: "nostalgia, soft edges" },
];

export default function Home() {
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [quote, setQuote] = useState("");
  const [vibe, setVibe] = useState("longing");
  const [stage, setStage] = useState<Stage>("idle");
  const [progress, setProgress] = useState<RenderProgress>({ phase: "", pct: 0 });
  const [bpm, setBpm] = useState<number | null>(null);
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const onGenerate = useCallback(async () => {
    if (!audioFile || !quote.trim()) return;
    try {
      setStage("analyzing");
      setProgress({ phase: "analyzing audio", pct: 5 });
      const audioBuf = await audioFile.arrayBuffer();
      const tempo = await detectTempo(audioBuf.slice(0));
      setBpm(tempo);

      setStage("rendering");
      const url = await renderVideo({
        audio: new Uint8Array(audioBuf),
        bpm: tempo,
        quote,
        vibe,
        library: LIBRARY,
        onProgress: setProgress,
      });
      setOutputUrl(url);
      setStage("done");
    } catch (e) {
      console.error(e);
      setProgress({ phase: `error: ${(e as Error).message}`, pct: 0 });
      setStage("idle");
    }
  }, [audioFile, quote, vibe]);

  const reset = () => {
    setStage("idle"); setOutputUrl(null); setProgress({ phase: "", pct: 0 });
    setAudioFile(null); setQuote(""); setBpm(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <main className="min-h-screen px-6 md:px-12 py-12 max-w-3xl mx-auto">
      {/* Masthead */}
      <header className="border-b border-umber/50 pb-8 mb-12">
        <div className="flex items-baseline justify-between">
          <h1 className="h-display text-5xl md:text-6xl tracking-tight text-bone">
            aesthetic<span className="text-taupe">.</span>
          </h1>
          <span className="h-display-italic text-sand text-sm">№ 001 · est. 2026</span>
        </div>
        <p className="mt-4 text-taupe text-sm max-w-md leading-relaxed">
          A song. A quote. A vibe. Returns a video, fit for the feed.
        </p>
      </header>

      {stage === "idle" && (
        <div className="space-y-10">
          {/* Step 1 — Music */}
          <Section number="i" title="the song">
            <input
              ref={fileRef}
              type="file"
              accept="audio/*"
              onChange={(e) => setAudioFile(e.target.files?.[0] ?? null)}
              className="hidden"
              id="audio-upload"
            />
            <label
              htmlFor="audio-upload"
              className="block border border-dashed border-umber rounded-sm px-6 py-8 cursor-pointer hover:border-sand transition-colors"
            >
              {audioFile ? (
                <div>
                  <div className="text-bone font-medium">{audioFile.name}</div>
                  <div className="text-taupe text-xs mt-1">
                    {(audioFile.size / 1024 / 1024).toFixed(2)} MB · click to change
                  </div>
                </div>
              ) : (
                <div className="text-taupe">
                  <div className="h-display-italic text-lg text-sand">drop a track</div>
                  <div className="text-xs mt-1">mp3 or wav from Suno · instrumental, 60–100 bpm preferred</div>
                </div>
              )}
            </label>
          </Section>

          {/* Step 2 — Quote */}
          <Section number="ii" title="the words">
            <textarea
              value={quote}
              onChange={(e) => setQuote(e.target.value)}
              placeholder={'someone once said\n"you could be the most beautiful shade of green, but it still wouldn\'t be enough for someone who\'s favorite color is blue"\nand that healed something in me'}
              className="w-full bg-transparent border border-umber rounded-sm px-4 py-3 text-bone placeholder:text-umber resize-none focus:border-sand focus:outline-none transition-colors"
              rows={6}
            />
            <div className="text-xs text-taupe mt-2 flex justify-between">
              <span>{quote.length} chars · 3 paragraphs reads best</span>
              <span className="h-display-italic">use \n for line breaks</span>
            </div>
          </Section>

          {/* Step 3 — Vibe */}
          <Section number="iii" title="the mood">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {VIBES.map((v) => (
                <button
                  key={v.id}
                  onClick={() => setVibe(v.id)}
                  className={`text-left px-4 py-3 border rounded-sm transition-all ${
                    vibe === v.id
                      ? "border-sand bg-bark text-bone"
                      : "border-umber text-taupe hover:border-taupe"
                  }`}
                >
                  <div className="h-display text-lg">{v.label}</div>
                  <div className="text-[10px] mt-0.5 opacity-70">{v.hint}</div>
                </button>
              ))}
            </div>
          </Section>

          {/* Generate */}
          <button
            onClick={onGenerate}
            disabled={!audioFile || !quote.trim()}
            className="w-full mt-12 py-5 bg-bone text-ink h-display text-2xl tracking-wider hover:bg-sand transition-colors disabled:bg-umber disabled:text-taupe disabled:cursor-not-allowed"
          >
            generate
          </button>
        </div>
      )}

      {(stage === "analyzing" || stage === "rendering") && (
        <div className="space-y-6 mt-16">
          <div className="h-display-italic text-3xl text-sand">{progress.phase || "working…"}</div>
          <div className="h-px bg-umber relative overflow-hidden">
            <div
              className="absolute inset-y-0 left-0 bg-bone transition-all duration-500"
              style={{ width: `${progress.pct}%` }}
            />
          </div>
          <div className="text-xs text-taupe flex justify-between">
            <span>{Math.round(progress.pct)}%</span>
            {bpm && <span>{bpm} bpm detected</span>}
          </div>
          <p className="text-taupe text-xs max-w-md leading-relaxed mt-12">
            Rendering happens on this device — nothing leaves your browser. Large
            tracks take longer; 30 seconds of music = roughly 60 seconds of render.
          </p>
        </div>
      )}

      {stage === "done" && outputUrl && (
        <div className="space-y-6 mt-8">
          <div className="h-display-italic text-3xl text-sand">ready.</div>
          <video
            src={outputUrl}
            controls
            className="w-full max-w-sm mx-auto border border-umber rounded-sm"
          />
          <div className="flex gap-3">
            <a
              href={outputUrl}
              download="aesthetic.mp4"
              className="flex-1 py-3 bg-bone text-ink h-display text-lg text-center hover:bg-sand transition-colors"
            >
              download
            </a>
            <button
              onClick={reset}
              className="flex-1 py-3 border border-umber text-taupe h-display text-lg hover:border-sand hover:text-bone transition-colors"
            >
              another
            </button>
          </div>
        </div>
      )}

      <footer className="mt-24 pt-8 border-t border-umber/30 text-xs text-umber flex justify-between">
        <span className="h-display-italic">rendered on device · no upload</span>
        <span>v0.1</span>
      </footer>
    </main>
  );
}

function Section({ number, title, children }: { number: string; title: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-baseline gap-4 mb-4">
        <span className="h-display-italic text-sand text-2xl">{number}.</span>
        <h2 className="h-display text-2xl text-bone">{title}</h2>
      </div>
      {children}
    </section>
  );
}
