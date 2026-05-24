import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}", "./components/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        // Palette extracted from the reference video
        ink: "#100B08",
        bark: "#292019",
        umber: "#4C392E",
        taupe: "#6E5C4D",
        sand: "#8D7B6C",
        bone: "#BCA998",
      },
      fontFamily: {
        display: ["var(--font-display)", "serif"],
        body: ["var(--font-body)", "sans-serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
