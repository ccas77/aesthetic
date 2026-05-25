// Browser-side video renderer using FFmpeg.wasm.
// Produces a 1080x1920 MP4 from: audio + stills + quote text.
//
// Pipeline:
//   1. Decode each still to a normalized frame (1080x1920, center-fit, sepia-graded)
//   2. Build a concat list with per-shot durations matched to the beat
//   3. Burn the quote text over every frame via drawtext
//   4. Mux the user's audio, encode to H.264 + AAC

import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";
import { cutIntervalMs } from "./beat-detect";
import { pickShotList, type Still } from "./library";

export interface RenderProgress {
  phase: string;
  pct: number;
}

// Output length cap. Long Suno tracks are trimmed to the first N seconds.
export const MAX_DURATION_SEC = 15;

interface RenderArgs {
  audio: Uint8Array;
  bpm: number;
  quote: string;
  library: Still[];
  onProgress: (p: RenderProgress) => void;
}

let ffmpegInstance: FFmpeg | null = null;

async function getFFmpeg(onLog?: (s: string) => void): Promise<FFmpeg> {
  if (ffmpegInstance) return ffmpegInstance;
  const ff = new FFmpeg();
  if (onLog) ff.on("log", ({ message }) => onLog(message));

  // Load the cross-origin-isolated core from unpkg
  const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd";
  await ff.load({
    coreURL: `${baseURL}/ffmpeg-core.js`,
    wasmURL: `${baseURL}/ffmpeg-core.wasm`,
  });
  ffmpegInstance = ff;
  return ff;
}

export async function renderVideo(args: RenderArgs): Promise<string> {
  const { audio, bpm, quote, library, onProgress } = args;

  onProgress({ phase: "loading renderer", pct: 10 });
  const ff = await getFFmpeg();

  // Decode audio duration, then clamp to the max output length we render.
  // Long Suno tracks get trimmed to the first MAX_DURATION_SEC seconds.
  const fullDurationSec = await getAudioDuration(audio);
  const audioDurationSec = Math.min(fullDurationSec, MAX_DURATION_SEC);
  const cutMs = cutIntervalMs(bpm);
  const cutSec = cutMs / 1000;
  const totalCuts = Math.ceil(audioDurationSec / cutSec);

  onProgress({ phase: "selecting shots", pct: 15 });
  const shots = pickShotList(library, totalCuts);

  // Write the audio in
  onProgress({ phase: "preparing audio", pct: 20 });
  await ff.writeFile("audio.mp3", audio);

  // Write each still in — progress updated per iteration so the bar moves
  // and any silent hang is visible (last-rendered number is the one that failed).
  for (let i = 0; i < shots.length; i++) {
    onProgress({
      phase: `loading stills (${i + 1}/${shots.length})`,
      pct: 25 + (i / shots.length) * 5,
    });
    const data = await fetchFile(shots[i].url);
    await ff.writeFile(`s${i}.jpg`, data);
  }

  // Build the concat demuxer file: each line says "use this image for this duration"
  const lines: string[] = [];
  for (let i = 0; i < shots.length; i++) {
    lines.push(`file 's${i}.jpg'`);
    lines.push(`duration ${cutSec.toFixed(4)}`);
  }
  // FFmpeg concat quirk: last file needs to appear twice without duration
  lines.push(`file 's${shots.length - 1}.jpg'`);
  await ff.writeFile("concat.txt", new TextEncoder().encode(lines.join("\n")));

  // Write the quote out as a textfile so drawtext can read it safely
  // (avoids needing to escape special chars in the filter string)
  await ff.writeFile("quote.txt", new TextEncoder().encode(quote));

  // Set up FFmpeg progress hook
  ff.on("progress", ({ progress }) => {
    const pct = 30 + Math.min(progress * 65, 65);
    onProgress({ phase: "rendering video", pct });
  });

  onProgress({ phase: "rendering video", pct: 30 });

  // The filtergraph:
  //  [v] = concat of stills, scaled+padded to 1080x1920, sepia-graded, with text
  //
  // - scale + pad: fit each still into 9:16 vertical with letterbox
  // - curves: warm sepia grade matching the reference palette
  // - eq:     drop saturation, lift shadows slightly
  // - drawtext: center-anchored white text reading from quote.txt
  const filter = [
    "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,",
    "eq=saturation=0.18:contrast=1.05:brightness=-0.04,",
    "curves=r='0/0 0.3/0.32 0.7/0.72 1/0.85':g='0/0 0.5/0.46 1/0.78':b='0/0 0.5/0.4 1/0.7',",
    "drawtext=textfile=quote.txt:fontcolor=white:fontsize=42:line_spacing=14:",
    "x=(w-text_w)/2:y=(h-text_h)/2:box=0:fix_bounds=true,",
    "format=yuv420p[v]",
  ].join("");

  await ff.exec([
    "-f", "concat",
    "-safe", "0",
    "-i", "concat.txt",
    "-i", "audio.mp3",
    "-filter_complex", filter,
    "-map", "[v]",
    "-map", "1:a",
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-crf", "26",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "128k",
    "-shortest",
    "-t", String(audioDurationSec),
    "out.mp4",
  ]);

  onProgress({ phase: "finalizing", pct: 98 });
  const data = (await ff.readFile("out.mp4")) as Uint8Array;
  // Copy to a fresh ArrayBuffer so Blob's strict typing is satisfied
  const buf = new Uint8Array(data.byteLength);
  buf.set(data);
  const blob = new Blob([buf.buffer], { type: "video/mp4" });
  return URL.createObjectURL(blob);
}

async function getAudioDuration(bytes: Uint8Array): Promise<number> {
  const ctx = new AudioContext();
  // copy to a new ArrayBuffer that's not detached
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const decoded = await ctx.decodeAudioData(ab);
  await ctx.close();
  return decoded.duration;
}
