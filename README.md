# aesthetic

> A song. A quote. A vibe. Returns a video, fit for the feed.

Browser-based TikTok-style aesthetic video generator. Upload a Suno track, paste a quote, pick a mood — get back a 1080×1920 MP4 graded, grained, and beat-synced to your audio.

## How it works

- **No backend rendering.** Everything happens in your browser via [FFmpeg.wasm](https://ffmpegwasm.netlify.app/). Your audio never leaves the device.
- **Beat detection** runs client-side with a small autocorrelation routine over the audio envelope.
- **Stills library** ships with 11 reference frames; subdivide cuts to land in the 250–400ms sweet spot regardless of tempo.
- **Color grade** is baked into the FFmpeg filtergraph as a warm-sepia curves preset matching the reference palette: `#100B08`, `#292019`, `#4C392E`, `#6E5C4D`, `#8D7B6C`, `#BCA998`.

## Architecture

```
app/page.tsx       — single-page UI (upload, quote, vibe, render, download)
lib/render.ts      — FFmpeg.wasm pipeline: concat stills → grade → text → mux audio
lib/beat-detect.ts — onset-energy autocorrelation BPM estimator
lib/library.ts     — stills manifest + variety-balanced shot picker
public/library/    — bundled placeholder stills (v1)
```

## Roadmap

- [ ] Vercel Blob–hosted library (replace bundled stills)
- [ ] Higgsfield API route for nightly fresh-stills generation
- [ ] LLM-generated quotes from a mood prompt
- [ ] Per-vibe color presets (currently one grade)
- [ ] Save/share renders

## Development

```bash
npm install
npm run dev
```

Cross-origin isolation headers are set in `next.config.ts` because FFmpeg.wasm needs `SharedArrayBuffer`. If you proxy through another CDN, propagate the COOP/COEP headers.

## License

MIT.
