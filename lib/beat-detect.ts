// Estimate BPM from an audio buffer using an onset-energy autocorrelation method.
// Good enough for the 60–120 BPM range we target. No deps.

export async function detectTempo(buffer: ArrayBuffer): Promise<number> {
  const AudioCtx = window.OfflineAudioContext;
  const tmp = new AudioContext();
  const decoded = await tmp.decodeAudioData(buffer);
  await tmp.close();

  // Downmix to mono, downsample to 1 kHz envelope
  const sr = decoded.sampleRate;
  const ch0 = decoded.getChannelData(0);
  const len = decoded.length;
  const winSize = Math.floor(sr / 1000) * 10; // 10ms windows = 100 fps envelope
  const env: number[] = [];
  for (let i = 0; i < len; i += winSize) {
    let sum = 0;
    const end = Math.min(i + winSize, len);
    for (let j = i; j < end; j++) sum += ch0[j] * ch0[j];
    env.push(Math.sqrt(sum / (end - i)));
  }

  // Onset signal = positive first derivative of envelope (energy increases)
  const onset = new Array(env.length).fill(0);
  for (let i = 1; i < env.length; i++) {
    const d = env[i] - env[i - 1];
    onset[i] = d > 0 ? d : 0;
  }

  // Autocorrelate at lag-bins corresponding to 50–180 BPM
  // env frame rate ≈ 100 Hz, so 1 beat-period at X BPM = (60/X)*100 frames
  let bestBpm = 80;
  let bestScore = -Infinity;
  for (let bpm = 50; bpm <= 180; bpm += 0.5) {
    const lag = (60 / bpm) * 100;
    const lagInt = Math.round(lag);
    let score = 0;
    for (let i = lagInt; i < onset.length; i++) {
      score += onset[i] * onset[i - lagInt];
    }
    if (score > bestScore) { bestScore = score; bestBpm = bpm; }
  }

  return Math.round(bestBpm * 10) / 10;
}

// Convert BPM into a cut interval (ms) that lands somewhere in the 250–400ms
// sweet spot regardless of song tempo. Subdivides beat as needed.
export function cutIntervalMs(bpm: number): number {
  const beatMs = 60000 / bpm;
  // Try whole, half, quarter, eighth beats — pick the one closest to 300ms
  const subdivisions = [beatMs, beatMs / 2, beatMs / 4, beatMs / 8];
  let best = beatMs, bestDist = Math.abs(beatMs - 300);
  for (const s of subdivisions) {
    const d = Math.abs(s - 300);
    if (d < bestDist && s >= 180 && s <= 500) { best = s; bestDist = d; }
  }
  return best;
}
