import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}", "./components/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        bg: "#ffffff",
        surface: "#fafaf9",
        line: "#e7e5e4",
        line2: "#d6d3d1",
        ink: "#0a0a0a",
        muted: "#525252",
        dim: "#a3a3a3",
        // Accent — the output palette, used as restrained editorial flourishes
        sepia: "#4C392E",
        sepiaSoft: "#8D7B6C",
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
