import ffmpegPath from "ffmpeg-static";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { put } from "@vercel/blob";
import { cutIntervalMs } from "./beat-detect";

// Server-side video renderer. Same filtergraph as the old browser-side
// version (sepia grade, drawtext with caption.ttf, concat demuxer) but
// driven by a ffmpeg-static binary on the Node runtime. Inputs are
// staged to a temp dir and the output mp4 is uploaded to Blob.

export const MAX_DURATION_SEC = 15;
const MAX_CHARS_PER_LINE = 30;

function wrapText(text: string, maxChars: number): string {
  return text
    .split("\n")
    .map((line) => {
      if (line.length <= maxChars) return line;
      const words = line.split(" ");
      const out: string[] = [];
      let cur = "";
      for (const w of words) {
        const next = cur ? `${cur} ${w}` : w;
        if (next.length <= maxChars) cur = next;
        else {
          if (cur) out.push(cur);
          cur = w;
        }
      }
      if (cur) out.push(cur);
      return out.join("\n");
    })
    .join("\n");
}

export interface StillRef {
  id: string;
  url: string;
}

export interface ServerRenderArgs {
  audioUrl: string;
  bpm: number;
  quote: string;
  stills: StillRef[];
  outputKey: string;
  // Optional: stillIds the planner forced into the first N slots. The
  // renderer respects this order before shuffling the rest.
  pinnedFirstStillIds?: string[];
}

export interface ServerRenderResult {
  blobUrl: string;
  durationSec: number;
  shotCount: number;
  stillIds: string[];
}

export async function renderServer(
  args: ServerRenderArgs,
): Promise<ServerRenderResult> {
  if (args.stills.length === 0) {
    throw new Error("renderServer: no stills available");
  }

  const work = await mkdtemp(join(tmpdir(), "aesthetic-render-"));
  try {
    // Stage audio
    const audioRes = await fetch(args.audioUrl);
    if (!audioRes.ok) {
      throw new Error(`audio fetch failed: ${audioRes.status}`);
    }
    const audioBuf = Buffer.from(await audioRes.arrayBuffer());
    await writeFile(join(work, "audio.mp3"), audioBuf);

    // We cap the output length at MAX_DURATION_SEC and let ffmpeg trim
    // shorter audio via -shortest. ffprobe isn't bundled with
    // ffmpeg-static so we pick a generous shot count and rely on -t.
    const audioDurationSec = MAX_DURATION_SEC;
    const cutSec = cutIntervalMs(args.bpm) / 1000;
    const totalCuts = Math.max(1, Math.ceil(audioDurationSec / cutSec));

    const shots = pickShotList(
      args.stills,
      totalCuts,
      args.pinnedFirstStillIds ?? [],
    );

    // Stage each still
    const concatLines: string[] = [];
    for (let i = 0; i < shots.length; i++) {
      const r = await fetch(shots[i].url);
      if (!r.ok) {
        throw new Error(`still fetch ${shots[i].id} failed: ${r.status}`);
      }
      const buf = Buffer.from(await r.arrayBuffer());
      await writeFile(join(work, `s${i}.jpg`), buf);
      concatLines.push(`file 's${i}.jpg'`);
      concatLines.push(`duration ${cutSec.toFixed(4)}`);
    }
    // FFmpeg concat quirk: repeat the last file without duration.
    concatLines.push(`file 's${shots.length - 1}.jpg'`);
    await writeFile(join(work, "concat.txt"), concatLines.join("\n"));

    // Quote (wrapped) + font
    await writeFile(join(work, "quote.txt"), wrapText(args.quote, MAX_CHARS_PER_LINE));
    const fontSrc = join(process.cwd(), "public/fonts/caption.ttf");
    await writeFile(join(work, "caption.ttf"), await readFile(fontSrc));

    const filter = [
      "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,",
      "eq=saturation=0.18:contrast=1.05:brightness=-0.04,",
      "curves=r='0/0 0.3/0.32 0.7/0.72 1/0.85':g='0/0 0.5/0.46 1/0.78':b='0/0 0.5/0.4 1/0.7',",
      "drawtext=fontfile=caption.ttf:textfile=quote.txt:fontcolor=white:fontsize=42:line_spacing=14:",
      "borderw=3:bordercolor=black:text_align=center:",
      "x=(w-text_w)/2:y=(h-text_h)/2:box=0:fix_bounds=true,",
      "format=yuv420p[v]",
    ].join("");

    const ffArgs = [
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      "concat.txt",
      "-i",
      "audio.mp3",
      "-filter_complex",
      filter,
      "-map",
      "[v]",
      "-map",
      "1:a",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-crf",
      "26",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-shortest",
      "-t",
      String(audioDurationSec),
      "out.mp4",
    ];
    await runFfmpeg(ffArgs, work);

    const outBuf = await readFile(join(work, "out.mp4"));
    const blob = await put(args.outputKey, outBuf, {
      access: "public",
      contentType: "video/mp4",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return {
      blobUrl: blob.url,
      durationSec: audioDurationSec,
      shotCount: shots.length,
      stillIds: shots.map((s) => s.id),
    };
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

function pickShotList(
  pool: StillRef[],
  count: number,
  pinnedFirstStillIds: string[],
  seed = Date.now(),
): StillRef[] {
  const byId = new Map(pool.map((s) => [s.id, s]));
  const result: StillRef[] = [];
  const used = new Set<string>();

  for (const id of pinnedFirstStillIds) {
    const s = byId.get(id);
    if (s && !used.has(id)) {
      result.push(s);
      used.add(id);
      if (result.length >= count) return result;
    }
  }

  const rng = mulberry32(seed);
  const remaining = pool.filter((s) => !used.has(s.id));
  const shuffled = [...remaining].sort(() => rng() - 0.5);

  while (result.length < count && shuffled.length > 0) {
    const s = shuffled.shift()!;
    result.push(s);
    used.add(s.id);
  }
  // If we still need more than the pool can provide, loop with offset.
  while (result.length < count && pool.length > 0) {
    result.push(pool[(result.length + 3) % pool.length]);
  }
  return result.slice(0, count);
}

function mulberry32(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function runFfmpeg(args: string[], cwd: string): Promise<void> {
  if (!ffmpegPath) {
    throw new Error("ffmpeg-static binary path unavailable on this platform");
  }
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(ffmpegPath as string, args, { cwd });
    const stderr: string[] = [];
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr.push(chunk.toString());
      if (stderr.length > 200) stderr.shift();
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) return resolve();
      const tail = stderr.join("").slice(-1500);
      reject(new Error(`ffmpeg exited ${code}: ${tail}`));
    });
  });
}
