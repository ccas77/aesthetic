// Library of stills bundled with the app.
// Currently empty — placeholder stills were removed because they were derived
// from someone else's content. Production: populate via Higgsfield-generated
// originals stored in Vercel Blob, fetched at render time.

export interface Still {
  id: string;
  url: string;
  // Subject tags so the shot picker can balance variety in a single render.
  tags: string[];
}

export const LIBRARY: Still[] = [];

// Pick a varied shot list. Prefer mixing tags so we don't get e.g. 4 book shots in a row.
export function pickShotList(library: Still[], count: number, seed = Date.now()): Still[] {
  const rng = mulberry32(seed);
  const shuffled = [...library].sort(() => rng() - 0.5);
  const result: Still[] = [];
  const usedTags = new Set<string>();

  // Greedy: take the first shot, then the next shot that shares the fewest tags with previous one
  if (shuffled.length === 0) return result;
  result.push(shuffled.shift()!);

  while (result.length < count && shuffled.length > 0) {
    const lastTags = new Set(result[result.length - 1].tags);
    shuffled.sort((a, b) => {
      const aOverlap = a.tags.filter((t) => lastTags.has(t)).length;
      const bOverlap = b.tags.filter((t) => lastTags.has(t)).length;
      return aOverlap - bOverlap;
    });
    result.push(shuffled.shift()!);
  }

  // If we need more than library has, loop (with offset so the loop isn't obvious)
  while (result.length < count) {
    result.push(library[(result.length + 3) % library.length]);
  }

  return result.slice(0, count);
}

function mulberry32(a: number) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
