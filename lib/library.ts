// Library of stills bundled with the app. v1 ships with 11 frames pulled from
// the reference video. Production: replace with Vercel Blob URLs + a richer
// taxonomy, and let Higgsfield top up the pool nightly.

export interface Still {
  id: string;
  url: string;
  // Subject tags so the shot picker can balance variety in a single render.
  tags: string[];
}

export const LIBRARY: Still[] = [
  { id: "journal",     url: "/library/still_00.jpg", tags: ["hands", "writing", "intimate"] },
  { id: "raincoat",    url: "/library/still_01.jpg", tags: ["window", "rain", "moody"] },
  { id: "rainwindow",  url: "/library/still_02.jpg", tags: ["window", "rain", "interior"] },
  { id: "letters",     url: "/library/still_03.jpg", tags: ["hands", "books", "intimate"] },
  { id: "chess",       url: "/library/still_04.jpg", tags: ["objects", "interior", "still-life"] },
  { id: "fabric",      url: "/library/still_05.jpg", tags: ["texture", "intimate", "soft"] },
  { id: "swing",       url: "/library/still_06.jpg", tags: ["figure", "outdoor", "ethereal"] },
  { id: "castle",      url: "/library/still_07.jpg", tags: ["architecture", "outdoor", "gothic"] },
  { id: "bookshelf",   url: "/library/still_08.jpg", tags: ["hands", "books", "library"] },
  { id: "teacup",      url: "/library/still_09.jpg", tags: ["objects", "books", "still-life"] },
  { id: "stacks",      url: "/library/still_10.jpg", tags: ["hands", "books", "library"] },
];

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
