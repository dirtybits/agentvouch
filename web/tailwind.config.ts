import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class", // Enable class-based dark mode
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-inconsolata)", '"Inconsolata"', "monospace"],
        heading: ["var(--font-inconsolata)", '"Inconsolata"', "monospace"],
        display: ["var(--font-crimson-text)", '"Crimson Text"', "serif"],
        mono: ["var(--font-inconsolata)", '"Inconsolata"', "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
