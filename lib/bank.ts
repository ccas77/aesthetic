// The bank of stills the app generates and reuses across renders.
// Categories are derived from the reference images the user supplied
// (handwritten letters, world globes, chess boards, typewriters,
// fountain pens, clocks, black coffee, books).
//
// Each entry includes:
//   id    — slug used for the Blob filename
//   tags  — used by pickShotList to keep variety in a render
//   prompt — the natural-language brief sent to the image generator

export interface BankCategory {
  id: string;
  label: string;
  tags: string[];
  prompt: string;
}

const STYLE = [
  "Dark academia still life photography.",
  "Deep warm sepia and umber palette — chocolate browns, aged paper, candle gold.",
  "Heavy shadows with a single warm light source from the side.",
  "Soft film grain, slightly hazy atmosphere.",
  "Vertical 2:3 portrait orientation, intimate close-up framing.",
  "No text, no watermarks, no people's faces visible.",
  "Cinematic, contemplative, melancholic mood.",
].join(" ");

export const BANK: BankCategory[] = [
  {
    id: "letters",
    label: "handwritten letters",
    tags: ["paper", "writing", "intimate"],
    prompt: `${STYLE} Subject: stacks of old handwritten letters tied with twine, aged ivory paper with cursive ink writing, sitting on a wooden desk in dim light.`,
  },
  {
    id: "globe",
    label: "world globes",
    tags: ["objects", "interior", "still-life"],
    prompt: `${STYLE} Subject: an antique brass-banded world globe with weathered map detail, on a dark wooden stand, surrounded by rolled parchment maps and a small clock.`,
  },
  {
    id: "chess",
    label: "chess boards",
    tags: ["objects", "interior", "still-life"],
    prompt: `${STYLE} Subject: a marble chess board mid-game, ivory and ebony pieces, viewed from a low three-quarter angle on a polished dark wood table.`,
  },
  {
    id: "typewriter",
    label: "typewriters",
    tags: ["objects", "writing", "interior"],
    prompt: `${STYLE} Subject: a vintage black cast-iron typewriter from the 1920s with cream-colored round keys, on a worn wooden desk, with leather-bound books behind.`,
  },
  {
    id: "pen",
    label: "fountain pens",
    tags: ["writing", "paper", "intimate"],
    prompt: `${STYLE} Subject: a gold-trimmed fountain pen resting on a sheet of ivory paper covered in cursive black-ink handwriting, extreme close-up macro.`,
  },
  {
    id: "clock",
    label: "clocks",
    tags: ["objects", "still-life", "intimate"],
    prompt: `${STYLE} Subject: an antique clock face with Roman numerals, weathered patina, close-up showing minute and hour hands and faded numerals.`,
  },
  {
    id: "coffee",
    label: "black coffee",
    tags: ["objects", "still-life", "intimate"],
    prompt: `${STYLE} Subject: a top-down view of black coffee in a plain ceramic mug, sitting on a dark wooden desk next to a leather journal and an inkwell.`,
  },
  {
    id: "books",
    label: "books",
    tags: ["books", "library", "intimate"],
    prompt: `${STYLE} Subject: a hand reaching up to pull an old leather-bound book from a tall wooden library shelf packed with antique volumes, viewed from low angle.`,
  },
];
