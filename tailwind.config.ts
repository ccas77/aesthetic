import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}", "./components/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        // Interface — neutral, high contrast
        bg: "#0a0a0a",
        surface: "#141414",
        line: "#1f1f1f",
        line2: "#2e2e2e",
        ink: "#fafafa",
        muted: "#a8a8a8",
        dim: "#6e6e6e",
        // Accent — the output palette, used sparingly as a hint
        sepia: "#BCA998",
        sepiaDark: "#6E5C4D",
      },
      fontFamily: {
        display: ["var(--font-display)", "serif"],
        body: ["var(--font-body)", "sans-serif"],
        mono: ["var(--font-mono)", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config;
